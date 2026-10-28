#!/usr/bin/env python3
"""Fetch public commodity/spot-futures data for the Stock Helper business tab.

Data providers are accessed through AKShare. The script deliberately writes only
validated numeric observations and never fabricates a quote when a source fails.
"""
from __future__ import annotations

import json
import math
import os
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
    {"id": "rare-earth", "name": "稀土（氧化镨钕）", "unit": "元/吨", "symbol": None, "aliases": ["氧化镨钕", "稀土"], "stocks": ["北方稀土", "盛和资源"], "chain": "稀土矿/分离 → 磁材 → 新能源车、风电、电机", "drivers": "关注配额、分离产量、磁材需求、出口政策和上下游库存。"},
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
            "changePct": None,
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
    start_day = end_day - timedelta(days=LOOKBACK_DAYS)
    daily_by_symbol: dict[str, list[dict[str, Any]]] = {}
    errors: list[str] = []

    # Business Society spot/futures basis data; exact dates allow a real trend chart.
    try:
        frame = call_with_timeout(SOURCE_TIMEOUT_SECONDS, ak.futures_spot_price_daily,
            start_day=start_day.strftime("%Y%m%d"),
            end_day=end_day.strftime("%Y%m%d"),
            vars_list=["SA", "UR", "MA", "AL", "RU"],
        )
        daily_by_symbol = normalize_daily_frame(frame)
    except Exception as exc:  # network/source outages must not crash UI data silently
        errors.append("futures_spot_price_daily: " + str(exc)[:180])

    # Fill the latest observation from the most recent available trading day if daily
    # history is temporarily empty for a product. Do not invent a date or a price.
    if not daily_by_symbol or any(not daily_by_symbol.get(code) for code in ("SA", "UR", "MA", "AL", "RU")):
        for offset in range(0, 8):
            day = end_day - timedelta(days=offset)
            try:
                frame = call_with_timeout(15, ak.futures_spot_price_previous, day.strftime("%Y%m%d"))
                if frame is None or getattr(frame, "empty", True):
                    continue
                for _, row in frame.iterrows():
                    label = str(row.get("商品", row.get("symbol", ""))).strip()
                    mapping = {"纯碱": "SA", "尿素": "UR", "甲醇MA": "MA", "甲醇": "MA", "铝": "AL", "天然橡胶": "RU"}
                    code = mapping.get(label)
                    if not code:
                        continue
                    spot = finite_number(row.get("现货价格", row.get("spot_price")))
                    fut = finite_number(row.get("主力合约价格", row.get("dominant_price")))
                    point = {"date": day.isoformat(), "spot": spot, "futures": fut}
                    daily_by_symbol.setdefault(code, []).append(point)
                if any(daily_by_symbol.get(code) for code in ("SA", "UR", "MA", "AL", "RU")):
                    break
            except Exception as exc:
                errors.append("futures_spot_price_previous: " + str(exc)[:120])
                continue

    payload = build_payload(daily_by_symbol)
    payload["fetchErrors"] = errors[:5]

    # Add a separate automatically fetched futures quote, clearly distinguished from spot.
    realtime_names = {"SA": "纯碱", "UR": "尿素", "MA": "甲醇", "AL": "铝", "RU": "天然橡胶"}
    for code, chinese_name in realtime_names.items():
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
                if not target.get("latest"):
                    target["latest"] = round(price, 4)
                    target["latestDate"] = target["futuresDate"]
                    target["status"] = "latest-only"
                    target["source"] = target["futuresSource"]
                    target["sourceUrl"] = target["futuresSourceUrl"]
        except Exception as exc:
            errors.append("futures_zh_realtime/" + code + ": " + str(exc)[:100])
    payload["fetchErrors"] = errors[:5]

    # For products without futures basis series, pull the latest public spot quote
    # from Eastmoney's commodity/stock mapping endpoint if an exact product row exists.
    try:
        categories = ["能源", "化工", "塑料", "纺织", "有色", "钢铁", "建材", "农副"]
        spot_rows: list[dict[str, Any]] = []
        for category in categories:
            try:
                frame = call_with_timeout(15, ak.futures_spot_stock, symbol=category)
                if frame is None or getattr(frame, "empty", True):
                    continue
                spot_rows.extend(frame.to_dict(orient="records"))
            except Exception as exc:
                errors.append("futures_spot_stock/" + category + ": " + str(exc)[:100])
        for product in PRODUCTS:
            target = payload["items"][product["id"]]
            if target.get("latest"):
                continue
            for row in spot_rows:
                name = str(row.get("商品名称", row.get("商品", row.get("名称", "")))).strip()
                if not name or not any(alias in name for alias in product["aliases"]):
                    continue
                latest = finite_number(row.get("最新价", row.get("最新价格")))
                if latest is None:
                    continue
                target["latest"] = round(latest, 4)
                target["latestDate"] = date.today().isoformat()
                target["latestSpot"] = round(latest, 4)
                target["source"] = "东方财富现货与股票数据（经 AKShare 获取）"
                target["sourceUrl"] = "https://data.eastmoney.com/ifdata/xhgp.html"
                target["status"] = "latest-only"
                try:
                    change = float(str(row.get("近半年涨跌幅", "")).replace("%", "").strip())
                    if math.isfinite(change):
                        target["changePct"] = change
                except (TypeError, ValueError):
                    pass
                break
        payload["fetchErrors"] = errors[:5]
    except Exception as exc:
        payload["fetchErrors"] = (errors + ["futures_spot_stock: " + str(exc)[:180]])[:5]

    return payload

def main() -> int:
    payload = fetch_data()
    successful = sum(1 for item in payload["items"].values() if item.get("latest"))
    if successful == 0:
        raise RuntimeError("No valid commodity observations were fetched; refusing to overwrite the last good file.")
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name}: {successful}/{len(PRODUCTS)} products with data")
    for item in payload["items"].values():
        if item.get("latest"):
            print(f"- {item['name']}: {item['latest']} {item['unit']} ({item.get('latestDate')})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
