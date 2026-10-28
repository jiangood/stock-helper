#!/usr/bin/env python3
"""Fetch public commodity/spot-futures data for the Stock Helper business tab.

Data providers are accessed through AKShare. The script deliberately writes only
validated numeric observations and never fabricates a quote when a source fails.
"""
from __future__ import annotations

import json
import math
import os
import re
import signal
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "business-data.json"
LOOKBACK_DAYS = 120
SOURCE_TIMEOUT_SECONDS = 35

PRODUCTS = [
    {"id": "soda-ash", "name": "纯碱", "unit": "元/吨", "symbol": "SA", "aliases": ["纯碱", "SA"], "stocks": ["双环科技", "中盐化工", "三友化工"], "chain": "玻璃、光伏玻璃、日用玻璃、硅酸钠", "drivers": "重点看厂家库存、开工率、检修与新增产能；同时跟踪煤炭、合成氨成本。"},
    {"id": "urea", "name": "尿素", "unit": "元/吨", "symbol": "UR", "aliases": ["尿素", "UR"], "stocks": ["四川美丰"], "chain": "煤头/气头生产 → 农业与工业需求", "drivers": "看农业需求季节性、出口政策、日产量、企业库存和煤气成本。"},
    {"id": "methanol", "name": "甲醇", "unit": "元/吨", "symbol": "MA", "aliases": ["甲醇", "MA"], "stocks": ["双环科技"], "chain": "煤/天然气 → 甲醇 → 烯烃、甲醛等", "drivers": "看煤价、天然气、港口库存、装置检修和下游利润；公司实际业务暴露需核实。"},
    {"id": "tio2", "name": "钛白粉", "unit": "元/吨", "symbol": None, "aliases": ["钛白粉", "金红石型钛白粉"], "stocks": ["安纳达"], "chain": "钛矿/硫酸 → 钛白粉 → 涂料、塑料、造纸", "drivers": "看钛矿和硫酸成本、行业开工率、出口、库存及企业调价。"},
    {"id": "aluminium", "name": "电解铝", "unit": "元/吨", "symbol": "AL", "aliases": ["铝", "电解铝", "AL"], "stocks": ["中国铝业"], "chain": "氧化铝/电力 → 电解铝 → 加工材", "drivers": "看铝价与氧化铝、电力成本价差，关注产能约束、库存和下游需求。"},
    {"id": "coal", "name": "煤炭", "unit": "元/吨", "symbol": None, "aliases": ["动力煤", "焦煤", "煤炭", "炼焦煤"], "stocks": ["华阳股份"], "chain": "矿山供给 → 电力、钢铁、化工", "drivers": "动力煤与焦煤用途不同；要区分煤种、产地和交货口径，不能混用价格。"},
    {"id": "rubber", "name": "天然橡胶", "unit": "元/吨", "symbol": "RU", "aliases": ["天然橡胶", "RU"], "stocks": ["海南橡胶"], "chain": "天然橡胶 → 轮胎、汽车、工业制品", "drivers": "看主产区天气、割胶季、库存、轮胎开工和合成胶价差。"},
    {"id": "rare-earth", "name": "稀土（氧化镨钕）", "unit": "元/吨", "symbol": None, "aliases": ["氧化镨钕"], "stocks": ["北方稀土", "盛和资源"], "chain": "稀土矿/分离 → 磁材 → 新能源车、风电、电机", "drivers": "关注配额、分离产量、磁材需求、出口政策和上下游库存。"},
]

def call_with_timeout(seconds: int, function: Any, *args: Any, **kwargs: Any) -> Any:
    """Bound a single public-source request so a stalled provider cannot block refresh forever."""
    def alarm_handler(_signum: int, _frame: Any) -> None:
        raise TimeoutError(f"data source timed out after {seconds}s")
    previous = signal.signal(signal.SIGALRM, alarm_handler)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return function(*args, **kwargs)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)

def finite_number(value: Any) -> float | None:
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None

def date_text(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(raw[:19], fmt).date().isoformat()
        except ValueError:
            pass
    return None

def clean_series(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        day = date_text(row.get("date"))
        spot = finite_number(row.get("spot"))
        futures = finite_number(row.get("futures"))
        if not day or (spot is None and futures is None):
            continue
        item: dict[str, Any] = {"date": day}
        if spot is not None:
            item["spot"] = round(spot, 4)
        if futures is not None:
            item["futures"] = round(futures, 4)
        by_date[day] = item
    return [by_date[k] for k in sorted(by_date)][-180:]

def normalize_company_list(value: Any, limit: int = 8) -> list[str]:
    """Split source-provided company names without inventing or inferring relationships."""
    if value is None:
        return []
    if isinstance(value, float) and math.isnan(value):
        return []
    text = str(value).strip()
    if not text or text.lower() == "nan" or text in {"-", "--", "暂无", "无"}:
        return []
    names = [name.strip() for name in re.split(r"[,，、;；|]", text) if name.strip()]
    return list(dict.fromkeys(names))[:limit]


def normalize_source_monthly_prices(row: Any) -> list[dict[str, Any]]:
    """Normalize Eastmoney's five-month commodity price snapshots without guessing dates."""
    points: list[dict[str, Any]] = []
    for key, label in [
        ("近5月", "5个月前"),
        ("近4月", "4个月前"),
        ("近3月", "3个月前"),
        ("近2月", "2个月前"),
        ("近1月", "1个月前"),
        ("最新价", "最新"),
    ]:
        value = finite_number(row.get(key))
        if value is not None:
            points.append({"label": label, "value": round(value, 4)})
    return points


def normalize_inventory_frame(frame: Any) -> list[dict[str, Any]]:
    """Normalize exchange warehouse receipt/inventory data; this is not total industry inventory."""
    if frame is None or getattr(frame, "empty", True):
        return []
    rows: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        day = date_text(row.get("日期", row.get("date")))
        raw_value = row.get("库存", row.get("库存量", row.get("inventory")))
        value = finite_number(raw_value)
        if not day or value is None:
            continue
        point: dict[str, Any] = {"date": day, "value": round(value, 4)}
        raw_change = row.get("增减", row.get("change"))
        try:
            change = float(str(raw_change).replace(",", "").strip())
            if math.isfinite(change):
                point["change"] = round(change, 4)
        except (TypeError, ValueError):
            pass
        rows.append(point)
    by_date = {point["date"]: point for point in rows}
    return [by_date[k] for k in sorted(by_date)][-90:]


def normalize_daily_frame(frame: Any) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    if frame is None or getattr(frame, "empty", True):
        return result
    for _, row in frame.iterrows():
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        day = date_text(row.get("date"))
        spot = finite_number(row.get("spot_price"))
        futures = finite_number(row.get("dom_price"))
        if futures is None:
            futures = finite_number(row.get("dominant_price"))
        if futures is None:
            futures = finite_number(row.get("near_price"))
        if not day or (spot is None and futures is None):
            continue
        result.setdefault(symbol, []).append({"date": day, "spot": spot, "futures": futures})
    return {key: clean_series(value) for key, value in result.items()}

def normalize_sys_frame(frame: Any, today: date | None = None) -> list[dict[str, Any]]:
    """Normalize Business Society's compact MM-DD chart dates into a chronological series."""
    if frame is None or getattr(frame, "empty", True):
        return []
    today = today or date.today()
    raw_points: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        raw_date = str(row.get("日期", row.get("date", ""))).strip()
        day = date_text(raw_date)
        spot = finite_number(row.get("现货价格", row.get("spot")))
        futures = finite_number(row.get("主力合约", row.get("futures")))
        if futures is None:
            futures = finite_number(row.get("最近合约"))
        raw_points.append({"raw_date": raw_date, "date": day, "spot": spot, "futures": futures})
    if all(p["date"] for p in raw_points):
        return clean_series([p for p in raw_points if p["date"]])
    year = today.year
    previous: tuple[int, int] | None = None
    for point in raw_points:
        if point["date"]:
            continue
        match = re.fullmatch(r"(\d{1,2})-(\d{1,2})", point["raw_date"])
        if not match:
            continue
        month, day_num = int(match.group(1)), int(match.group(2))
        month_day = (month, day_num)
        if previous and month_day < previous:
            year += 1
        try:
            point["date"] = date(year, month, day_num).isoformat()
        except ValueError:
            continue
        previous = month_day
    dated = [p for p in raw_points if p.get("date")]
    if dated and dated[-1]["date"] > today.isoformat():
        for point in dated:
            try:
                point["date"] = date.fromisoformat(point["date"]).replace(year=date.fromisoformat(point["date"]).year - 1).isoformat()
            except ValueError:
                pass
    return clean_series(dated)


def build_payload(daily_by_symbol: dict[str, list[dict[str, Any]]], now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    items: dict[str, Any] = {}
    for product in PRODUCTS:
        series = clean_series(daily_by_symbol.get(product["symbol"], [])) if product["symbol"] else []
        latest = series[-1] if series else {}
        latest_price = latest.get("spot") or latest.get("futures")
        items[product["id"]] = {
            "id": product["id"], "name": product["name"], "unit": product["unit"],
            "symbol": product["symbol"], "series": series,
            "latest": latest_price, "latestDate": latest.get("date"),
            "latestSpot": latest.get("spot"), "latestFutures": latest.get("futures"),
            "futuresSource": "生意社主力合约参考价（历史数据）" if latest.get("futures") else None,
            "futuresSourceUrl": "https://www.100ppi.com/" if latest.get("futures") else None,
            "changePct": None,
            "inventory": None,
            "source": "生意社现货/期货基差数据（经 AKShare 获取）" if series else None,
            "sourceUrl": "https://www.100ppi.com/",
            "stocks": product["stocks"], "chain": product["chain"], "drivers": product["drivers"],
            "status": "ok" if series else "pending",
        }
    return {
        "schemaVersion": 1,
        "updatedAt": now.isoformat(timespec="seconds"),
        "timezone": "UTC",
        "provider": "AKShare; underlying source labels are shown per item",
        "items": items,
    }

def fetch_data() -> dict[str, Any]:
    try:
        import akshare as ak
    except ImportError as exc:
        raise RuntimeError("AKShare is not installed. Install it with: pip install akshare") from exc

    end_day = date.today()
    errors: list[str] = []
    existing_payload: dict[str, Any] = {}
    try:
        existing_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        if not isinstance(existing_payload, dict):
            existing_payload = {}
    except (OSError, json.JSONDecodeError):
        existing_payload = {}

    # Keep the existing history and append only new observations on scheduled runs.
    # This avoids re-downloading 120 calendar days four times a day.
    daily_by_symbol: dict[str, list[dict[str, Any]]] = {}
    old_items = existing_payload.get("items", {}) if isinstance(existing_payload.get("items"), dict) else {}
    for product in PRODUCTS:
        code = product.get("symbol")
        old_item = old_items.get(product["id"], {})
        old_series = old_item.get("series", []) if isinstance(old_item, dict) else []
        if code and isinstance(old_series, list):
            daily_by_symbol[code] = clean_series(old_series)

    core_codes = ["SA", "UR", "MA", "AL", "RU"]
    missing_history = [code for code in core_codes if len(daily_by_symbol.get(code, [])) < 5]
    fresh_data = False

    # Bootstrap history only when the cache is empty/incomplete. This source is
    # daily but makes one request per calendar day, so do not call it on every refresh.
    if missing_history:
        try:
            start_day = end_day - timedelta(days=LOOKBACK_DAYS)
            frame = call_with_timeout(150, ak.futures_spot_price_daily,
                start_day=start_day.strftime("%Y%m%d"),
                end_day=end_day.strftime("%Y%m%d"),
                vars_list=missing_history,
            )
            new_history = normalize_daily_frame(frame)
            for code, points in new_history.items():
                daily_by_symbol[code] = clean_series(daily_by_symbol.get(code, []) + points)
            if any(new_history.get(code) for code in missing_history):
                fresh_data = True
        except Exception as exc:
            errors.append("futures_spot_price_daily bootstrap: " + str(exc)[:180])

    # Refresh the latest spot/settlement snapshot from Business Society. If today is
    # not a trading day or one product is absent, try the previous few trading dates.
    observed: set[str] = set()
    mapping = {"纯碱": "SA", "尿素": "UR", "甲醇MA": "MA", "甲醇": "MA", "铝": "AL", "天然橡胶": "RU"}
    for offset in range(0, 8):
        day = end_day - timedelta(days=offset)
        try:
            frame = call_with_timeout(12, ak.futures_spot_price_previous, day.strftime("%Y%m%d"))
            if frame is None or getattr(frame, "empty", True):
                continue
            for _, row in frame.iterrows():
                label = str(row.get("商品", row.get("symbol", ""))).strip()
                code = mapping.get(label)
                if not code:
                    continue
                spot = finite_number(row.get("现货价格", row.get("spot_price")))
                fut = finite_number(row.get("主力合约价格", row.get("dominant_price")))
                if spot is None and fut is None:
                    continue
                point = {"date": day.isoformat(), "spot": spot, "futures": fut}
                daily_by_symbol[code] = clean_series(daily_by_symbol.get(code, []) + [point])
                observed.add(code)
                fresh_data = True
            if len(observed) == len(core_codes):
                break
        except Exception as exc:
            errors.append("futures_spot_price_previous: " + str(exc)[:120])

    payload = build_payload(daily_by_symbol)

    # Exchange warehouse receipts provide a useful, narrow supply-side signal.
    # They are NOT the same as total producer, port, or social inventory.
    inventory_symbols = {
        "soda-ash": "SA", "urea": "尿素", "methanol": "甲醇",
        "aluminium": "沪铝", "rubber": "橡胶",
    }
    for product_id, symbol in inventory_symbols.items():
        try:
            frame = call_with_timeout(15, ak.futures_inventory_em, symbol=symbol)
            series = normalize_inventory_frame(frame)
            if series:
                latest_point = series[-1]
                payload["items"][product_id]["inventory"] = {
                    "label": "期货仓单库存（非全行业库存）",
                    "series": series,
                    "latest": latest_point["value"],
                    "latestDate": latest_point["date"],
                    "change": latest_point.get("change"),
                    "source": "东方财富期货库存数据（经 AKShare 获取）",
                    "sourceUrl": "https://data.eastmoney.com/ifdata/kcsj.html",
                }
                fresh_data = True
        except Exception as exc:
            errors.append("futures_inventory_em/" + product_id + ": " + str(exc)[:100])
        # Keep last successful observations when the provider is unavailable.
        if payload["items"][product_id].get("inventory") is None:
            old_item = old_items.get(product_id, {})
            if isinstance(old_item, dict) and isinstance(old_item.get("inventory"), dict):
                payload["items"][product_id]["inventory"] = old_item["inventory"]

    payload["fetchErrors"] = errors[:5]

    # Add separate futures quotes where the source's product-name mapping supports them.
    for code, chinese_name in {"SA": "纯碱", "UR": "尿素"}.items():
        try:
            frame = call_with_timeout(12, ak.futures_zh_realtime, symbol=chinese_name)
            if frame is None or getattr(frame, "empty", True):
                continue
            candidates = []
            for _, row in frame.iterrows():
                contract = str(row.get("symbol", "")).strip().upper()
                name = str(row.get("name", "")).strip()
                price = finite_number(row.get("trade"))
                if price is None:
                    continue
                rank = 0 if contract == code + "0" or "连续" in name else 1
                candidates.append((rank, row, price))
            if not candidates:
                continue
            candidates.sort(key=lambda x: x[0])
            _, row, price = candidates[0]
            target = next((x for x in payload["items"].values() if x.get("symbol") == code), None)
            if target:
                target["latestFutures"] = round(price, 4)
                target["futuresDate"] = date_text(row.get("tradedate")) or date.today().isoformat()
                target["futuresTime"] = str(row.get("ticktime", "")).strip() or None
                target["futuresSource"] = "新浪财经商品期货行情（经 AKShare 获取）"
                target["futuresSourceUrl"] = "https://finance.sina.com.cn/futuremarket/"
                fresh_data = True
        except Exception as exc:
            errors.append("futures_zh_realtime/" + code + ": " + str(exc)[:100])

    # Fetch current spot prices for non-futures commodities only where cache lacks a quote.
    # These products do not have a reliable futures spot series in this pipeline,
    # so refresh their latest quote from Eastmoney on every run.
    # Pull source-reported producer/downstream links for every tracked commodity.
    # The same endpoint can also provide latest spot quotes for products without a
    # reliable daily series, but it must not overwrite the core historical price series.
    industry_categories = {
        "soda-ash": ["化工", "建材"],
        "urea": ["化工", "农副"],
        "methanol": ["能源", "化工"],
        "tio2": ["化工", "建材"],
        "aluminium": ["有色"],
        "coal": ["能源", "钢铁"],
        "rubber": ["化工", "纺织"],
        "rare-earth": ["有色"],
    }
    latest_only_products = {"tio2", "coal", "rare-earth"}
    categories = list(dict.fromkeys(
        category for values in industry_categories.values() for category in values
    ))
    spot_rows: list[dict[str, Any]] = []
    for category in categories:
        try:
            frame = call_with_timeout(15, ak.futures_spot_stock, symbol=category)
            if frame is not None and not getattr(frame, "empty", True):
                spot_rows.extend(frame.to_dict(orient="records"))
        except Exception as exc:
            errors.append("futures_spot_stock/" + category + ": " + str(exc)[:100])

    for product in PRODUCTS:
        target = payload["items"][product["id"]]
        old_item = old_items.get(product["id"], {})
        for row in spot_rows:
            name = str(row.get("商品名称", row.get("商品", row.get("名称", "")))).strip()
            if not name or name not in product["aliases"]:
                continue

            producers = normalize_company_list(row.get("生产商"))
            downstream = normalize_company_list(row.get("下游用户"))
            target["industryLinks"] = {
                "label": "数据源列示产业链企业",
                "productName": name,
                "producers": producers,
                "downstreamUsers": downstream,
                "source": "东方财富现货与股票数据（经 AKShare 获取）",
                "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
            }
            monthly_prices = normalize_source_monthly_prices(row)
            if monthly_prices:
                target["monthlyPrices"] = {
                    "label": "来源提供的近月价格快照",
                    "series": monthly_prices,
                    "source": "东方财富现货与股票数据（经 AKShare 获取）",
                    "sourceUrl": "https://data.eastmoney.com/ifdata/xhgp.html",
                }
                fresh_data = True
            elif isinstance(old_item, dict) and isinstance(old_item.get("monthlyPrices"), dict):
                target["monthlyPrices"] = old_item["monthlyPrices"]
            if product["id"] in latest_only_products:
                latest = finite_number(row.get("最新价", row.get("最新价格")))
                if latest is not None:
                    target["name"] = name
                    target["latest"] = round(latest, 4)
                    target["latestDate"] = date.today().isoformat()
                    target["latestSpot"] = round(latest, 4)
                    target["source"] = "东方财富现货与股票数据（经 AKShare 获取）"
                    target["sourceUrl"] = "https://data.eastmoney.com/ifdata/xhgp.html"
                    target["status"] = "latest-only"
                    try:
                        change = float(str(row.get("近半年涨跌幅", "")).replace("%", "").replace(",", "").strip())
                        if math.isfinite(change):
                            target["changePct"] = change
                    except (TypeError, ValueError):
                        pass
                    fresh_data = True
            break

        # Preserve previously sourced industry names when a category endpoint is down.
        if not target.get("industryLinks") and isinstance(old_item, dict) and isinstance(old_item.get("industryLinks"), dict):
            target["industryLinks"] = old_item["industryLinks"]

    # Preserve last good latest-only quotes when a provider is temporarily unavailable.
    for product in PRODUCTS:
        target = payload["items"][product["id"]]
        old_item = old_items.get(product["id"], {})
        if target.get("latest") is None and isinstance(old_item, dict) and old_item.get("latest") is not None:
            for key in ("name", "latest", "latestDate", "latestSpot", "latestFutures", "changePct", "source", "sourceUrl", "status"):
                if old_item.get(key) is not None:
                    target[key] = old_item[key]
            if not target.get("series") and isinstance(old_item.get("series"), list):
                target["series"] = old_item["series"]

    payload["fetchErrors"] = errors[:5]
    payload["hasFreshData"] = fresh_data
    return payload

def main() -> int:
    payload = fetch_data()
    fresh = bool(payload.pop("hasFreshData", False))
    successful = sum(1 for item in payload["items"].values() if item.get("latest"))
    if not fresh or successful == 0:
        raise RuntimeError("No fresh valid commodity observations were fetched; preserving the last good file.")
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name}: {successful}/{len(PRODUCTS)} products with data")
    for item in payload["items"].values():
        if item.get("latest"):
            print(f"- {item['name']}: {item['latest']} {item['unit']} ({item.get('latestDate')})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
