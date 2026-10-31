#!/usr/bin/env python3
"""Fetch fundamentals used by the research score (owner / core business / deducted profit).

Three public Eastmoney F10 endpoints, one request each per stock:

* ShareholderResearch  -> 实际控制人（判断央企 / 省国资 / 地市国资 / 其他）
* BusinessAnalysis     -> 最新报告期主营构成（取占比最大的品类，产品口径优先）
* RPT_F10_FINANCE_GINCOME -> 扣非净利润与同比（保留最近若干个年报，用于「持续」判断）

Only validated numeric observations are written; a failed request keeps the
previous snapshot for that stock instead of inventing a value.
"""
from __future__ import annotations

import concurrent.futures
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STOCKS_FILE = ROOT / "data" / "stocks.json"
OUTPUT = ROOT / "data" / "fundamentals.json"
SURVEY_URL = "https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code={code}"
BUSINESS_URL = "https://emweb.securities.eastmoney.com/PC_HSF10/BusinessAnalysis/PageAjax?code={code}"
FINANCE_URL = (
    "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_GINCOME"
    "&columns=REPORT_DATE,REPORT_DATE_NAME,DEDUCT_PARENT_NETPROFIT,DEDUCT_PARENT_NETPROFIT_YOY"
    "&filter=(SECUCODE%3D%22{suffix}%22)&pageSize=24&sortColumns=REPORT_DATE&sortTypes=-1"
)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Referer": "https://emweb.securities.eastmoney.com/",
    "Accept": "application/json, text/plain, */*",
}
TIMEOUT = 15
SLEEP = 0.25
MAX_ANNUAL = 6
WORKERS = 4


def get_json(url: str, attempts: int = 2) -> dict:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8", "ignore"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            last_error = error
            time.sleep(0.8)
    raise RuntimeError(f"request failed: {last_error}")


PROVINCES = (
    "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江",
    "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "海南", "四川", "贵州",
    "云南", "陕西", "甘肃", "青海", "台湾", "内蒙古", "广西", "西藏", "宁夏", "新疆"
)

# 名称里没有地域或「中国」字样、但实际是国资的少数情况
OWNER_OVERRIDES = {
    "华鲁控股集团有限公司": "province",
    "陕西有色金属控股集团有限责任公司": "province",
    "上海地产(集团)有限公司": "province",
    "新疆生产建设兵团国有资产经营有限责任公司": "province",
    "中粮集团有限公司": "central",
    "鞍钢集团有限公司": "central",
    "中国化工集团有限公司": "central",
    "中国化学工程集团有限公司": "central"
}


def owner_type(name: str | None) -> str | None:
    if not name:
        return None
    text = name.replace(" ", "")
    if text in OWNER_OVERRIDES:
        return OWNER_OVERRIDES[text]
    if "国务院国有资产监督管理委员会" in text or "中华人民共和国财政部" in text:
        return "central"
    if "中央" in text and ("企业" in text or "集团" in text):
        return "central"
    # 央企常见形态：中国XX集团 / 中国XX研究院
    if text.startswith("中国") or "中国" in text[:4]:
        return "central"
    if "兵团" in text:
        return "province"
    if "自治区" in text or "省" in text:
        return "province"
    if any(text.startswith(province) for province in PROVINCES) and ("国资" in text or "财政" in text or "人民政府" in text or "集团" in text or "控股" in text):
        return "province"          # 含直辖市在内的省级国资
    if "市" in text or "县" in text or "区" in text:
        return "city"
    if "国资" in text or "财政" in text:
        return "city"
    return "other"


def fetch_owner(code: str) -> dict:
    payload = get_json(SURVEY_URL.format(code=code.upper()))
    rows = payload.get("sjkzr") or []
    name = rows[0].get("HOLDER_NAME") if rows else None
    return {"owner": name, "ownerType": owner_type(name)}


def fetch_main_business(code: str) -> dict:
    payload = get_json(BUSINESS_URL.format(code=code.upper()))
    rows = payload.get("zygcfx") or []
    if not rows:
        return {}
    dates = sorted({str(row.get("REPORT_DATE") or "") for row in rows if row.get("REPORT_DATE")}, reverse=True)
    if not dates:
        return {}
    latest = dates[0]
    def pick(mainop_type: str) -> list[dict]:
        return [row for row in rows if row.get("REPORT_DATE") == latest and row.get("MAINOP_TYPE") == mainop_type]
    products = pick("2")
    industries = pick("1")
    basis = "product" if products else "industry"
    candidates = products or industries
    if not candidates:
        return {}
    top = max(candidates, key=lambda row: float(row.get("MBI_RATIO") or 0))
    return {
        "mainItem": top.get("ITEM_NAME"),
        "mainRatio": round(float(top.get("MBI_RATIO") or 0), 4),
        "mainBasis": basis,
        "mainDate": latest[:10]
    }


def fetch_profit(code: str) -> list[dict]:
    suffix = code[2:].upper() + "." + code[:2].upper()
    payload = get_json(FINANCE_URL.format(suffix=suffix))
    result = (payload or {}).get("result") or {}
    rows = result.get("data") or []
    annual = []
    for row in rows:
        date = str(row.get("REPORT_DATE") or "")[:10]
        if not date.endswith("12-31"):
            continue
        yoy = row.get("DEDUCT_PARENT_NETPROFIT_YOY")
        value = row.get("DEDUCT_PARENT_NETPROFIT")
        if yoy is None and value is None:
            continue
        annual.append({
            "date": date,
            "yoy": None if yoy is None else round(float(yoy), 2),
            "value": None if value is None else round(float(value), 2)
        })
        if len(annual) >= MAX_ANNUAL:
            break
    return annual


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def merge_with_previous(fresh: dict, previous: dict, fields: tuple[str, ...]) -> dict:
    """Keep the last known-good field when a provider returns an empty/null value."""
    merged = {}
    for key in fields:
        value = fresh.get(key)
        if value is None:
            value = previous.get(key)
        if value is not None:
            merged[key] = value
    return merged


def main() -> int:
    stocks = read_json(STOCKS_FILE, [])
    if not isinstance(stocks, list) or not stocks:
        print("data/stocks.json missing or invalid", file=sys.stderr)
        return 1
    previous = read_json(OUTPUT, {}).get("stocks", {})
    codes = []
    for stock in stocks:
        code = str(stock.get("code") or "").strip().lower()
        if code.startswith(("sh", "sz")) and len(code) == 8:
            codes.append((code, stock.get("name")))

    results: dict[str, dict] = {}
    failures = 0
    lock = threading.Lock()

    def work(item):
        nonlocal failures
        code, name = item
        keep = dict(previous.get(code) or {})
        entry = {"name": name}
        local_failures = 0

        try:
            fresh_owner = fetch_owner(code)
            entry.update(merge_with_previous(fresh_owner, keep, ("owner", "ownerType")))
        except Exception as error:
            local_failures += 1
            print(f"{code}: owner unavailable ({error})", file=sys.stderr)
            entry.update(merge_with_previous({}, keep, ("owner", "ownerType")))
        try:
            fresh_business = fetch_main_business(code)
            entry.update(merge_with_previous(
                fresh_business, keep, ("mainItem", "mainRatio", "mainBasis", "mainDate")
            ))
        except Exception as error:
            local_failures += 1
            print(f"{code}: main business unavailable ({error})", file=sys.stderr)
            entry.update(merge_with_previous(
                {}, keep, ("mainItem", "mainRatio", "mainBasis", "mainDate")
            ))
        try:
            entry["annual"] = fetch_profit(code) or keep.get("annual") or []
        except Exception as error:
            local_failures += 1
            print(f"{code}: deducted profit unavailable ({error})", file=sys.stderr)
            entry["annual"] = keep.get("annual") or []

        with lock:
            failures += local_failures
            if entry.get("owner") or entry.get("mainRatio") is not None or entry.get("annual"):
                results[code] = entry

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(work, codes))

    if not results:
        print("no fundamentals collected; keeping previous file", file=sys.stderr)
        return 1

    payload = {
        "schemaVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": "Eastmoney F10 via GitHub Actions",
        "note": "实际控制人 / 主营构成 / 扣非净利润，供研报评分使用；请求失败的股票保留上一次有效值",
        "stocks": results
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"fundamentals: {len(results)}/{len(stocks)} stocks; {failures} request failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
