#!/usr/bin/env python3
"""Build a company-product table with sourced monthly commodity price history.

Revenue shares come from Eastmoney F10 segment disclosures. Futures continuous
series are price proxies, not company realized selling prices; unsupported
products remain explicitly unavailable rather than being substituted.
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = DATA / "company-products.json"
FUNDAMENTALS = DATA / "fundamentals.json"
STOCK_PRODUCTS = DATA / "stock-products.json"
STOCKS = DATA / "stocks.json"

# Only map a product to a quoted market when the instrument is a defensible
# proxy for that product. Spot-only products intentionally have no mapping.
PRICE_CONFIG = {
    "soda-ash": {"symbol": "SA0", "unit": "元/吨", "kind": "期货主力连续"},
    "urea": {"symbol": "UR0", "unit": "元/吨", "kind": "期货主力连续"},
    "methanol": {"symbol": "MA0", "unit": "元/吨", "kind": "期货主力连续"},
    "aluminium": {"symbol": "AL0", "unit": "元/吨", "kind": "期货主力连续"},
    "rubber": {"symbol": "RU0", "unit": "元/吨", "kind": "期货主力连续"},
    "tin": {"symbol": "SN0", "unit": "元/吨", "kind": "期货主力连续"},
    "sugar": {"symbol": "SR0", "unit": "元/吨", "kind": "期货主力连续"},
    "live-hog": {"symbol": "LH0", "unit": "元/吨", "kind": "期货主力连续"},
    "corn": {"symbol": "C0", "unit": "元/吨", "kind": "期货主力连续"},
    "soybean-meal": {"symbol": "M0", "unit": "元/吨", "kind": "期货主力连续"},
    "pvc": {"symbol": "V0", "unit": "元/吨", "kind": "期货主力连续"},
    "caustic-soda": {"symbol": "SH0", "unit": "元/吨", "kind": "期货主力连续"},
    "zinc": {"symbol": "ZN0", "unit": "元/吨", "kind": "期货主力连续"},
    "copper": {"symbol": "CU0", "unit": "元/吨", "kind": "期货主力连续"},
    "lead": {"symbol": "PB0", "unit": "元/吨", "kind": "期货主力连续"},
    "nickel": {"symbol": "NI0", "unit": "元/吨", "kind": "期货主力连续"},
    "gold": {"symbol": "AU0", "unit": "元/克", "kind": "期货主力连续"},
    "silver": {"symbol": "AG0", "unit": "元/千克", "kind": "期货主力连续"},
    "iron-ore": {"symbol": "I0", "unit": "元/吨", "kind": "期货主力连续"},
    "coking-coal": {"symbol": "JM0", "unit": "元/吨", "kind": "期货主力连续"},
    "rebar": {"symbol": "RB0", "unit": "元/吨", "kind": "期货主力连续"},
    "industrial-silicon": {"symbol": "SI0", "unit": "元/吨", "kind": "期货主力连续"},
    "lithium-carbonate": {"symbol": "LC0", "unit": "元/吨", "kind": "期货主力连续"},
    "alumina": {"symbol": "AO0", "unit": "元/吨", "kind": "期货主力连续"},
}
ALIASES = {
    "soda-ash": ("纯碱", "联碱"),
    "urea": ("尿素",),
    "methanol": ("甲醇",),
    "aluminium": ("电解铝", "铝锭", "铝产品"),
    "rubber": ("天然橡胶", "橡胶产品"),
    "tin": ("锡", "锡锭"),
    "sugar": ("白砂糖", "食糖", "白糖"),
    "live-hog": ("生猪",),
    "corn": ("玉米",),
    "soybean-meal": ("豆粕",),
    "pvc": ("PVC", "聚氯乙烯"),
    "caustic-soda": ("烧碱", "片碱"),
    "zinc": ("锌锭", "精炼锌"),
    "copper": ("电解铜", "阴极铜"),
    "lead": ("铅锭", "精炼铅"),
    "nickel": ("电解镍", "镍板"),
    "gold": ("黄金",),
    "silver": ("白银",),
    "iron-ore": ("铁矿石",),
    "coking-coal": ("焦煤", "炼焦煤"),
    "rebar": ("螺纹钢",),
    "industrial-silicon": ("工业硅",),
    "lithium-carbonate": ("碳酸锂",),
    "alumina": ("氧化铝",),
    "tio2": ("钛白粉",),
    "rare-earth": ("氧化镨钕", "稀土"),
    "coal": ("煤炭", "动力煤", "无烟煤"),
}


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def finite_positive(value: Any) -> float | None:
    try:
        number = float(str(value).replace(",", "").strip())
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def normalize_ratio(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    if number > 1 and number <= 100:
        number /= 100
    return round(number, 6) if number <= 1 else None


def infer_market_item(product_name: str) -> str | None:
    name = str(product_name or "").replace(" ", "")
    # Combined segment labels (e.g. "锡/锑/锌") must not be mapped to one
    # component's quote series because that would misstate the segment price.
    if any(separator in name for separator in ("/", "、", "及", "与", "和", "，", ",")):
        return None
    for item_id, aliases in ALIASES.items():
        if any(alias.lower() in name.lower() for alias in aliases):
            return item_id
    return None


def monthly_last(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Take the last valid trading close in each calendar month."""
    by_month: dict[str, dict[str, Any]] = {}
    for row in rows:
        raw_day = str(row.get("date") or row.get("日期") or "")[:10]
        try:
            day = date.fromisoformat(raw_day)
        except ValueError:
            continue
        price = finite_positive(row.get("close", row.get("收盘价")))
        if price is None:
            price = finite_positive(row.get("settle", row.get("结算价")))
        if price is None:
            continue
        by_month[day.strftime("%Y-%m")] = {
            "month": day.strftime("%Y-%m"),
            "price": round(price, 4),
            "date": day.isoformat(),
        }
    completed_month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    return [by_month[key] for key in sorted(by_month) if key <= completed_month][-60:]


def fetch_price_histories(item_ids: set[str] | None = None) -> tuple[dict[str, list[dict[str, Any]]], dict[str, str]]:
    histories: dict[str, list[dict[str, Any]]] = {}
    errors: dict[str, str] = {}
    try:
        import akshare as ak
    except ImportError:
        return histories, {}
    end_day = date.today()
    start_day = date(end_day.year - 5, end_day.month, 1)
    for item_id, config in PRICE_CONFIG.items():
        if item_ids is not None and item_id not in item_ids:
            continue
        try:
            frame = ak.futures_main_sina(
                symbol=config["symbol"],
                start_date=start_day.strftime("%Y%m%d"),
                end_date=end_day.strftime("%Y%m%d"),
            )
            if frame is None or getattr(frame, "empty", True):
                raise RuntimeError("数据源未返回历史记录")
            rows = frame.to_dict(orient="records")
            series = monthly_last(rows)
            if not series:
                raise RuntimeError("没有可用的月度收盘/结算价")
            histories[item_id] = series
        except Exception as error:  # preserve last known-good series below
            errors[item_id] = str(error)[:180]
    return histories, errors


def build(
    fetch_prices: bool = True,
    fundamentals: dict[str, Any] | None = None,
    stock_products: dict[str, Any] | None = None,
    stocks: list[dict[str, Any]] | None = None,
    previous: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fundamentals = fundamentals if fundamentals is not None else read_json(FUNDAMENTALS, {})
    stock_products = stock_products if stock_products is not None else read_json(STOCK_PRODUCTS, {})
    stocks = stocks if stocks is not None else read_json(STOCKS, [])
    previous = previous if previous is not None else read_json(OUTPUT, {})
    fund_stocks = fundamentals.get("stocks", {}) if isinstance(fundamentals, dict) else {}
    mappings = stock_products.get("byCode", {}) if isinstance(stock_products, dict) else {}
    old_rows = previous.get("products", []) if isinstance(previous, dict) else []
    old_by_key = {
        (row.get("stockCode"), row.get("productName")): row
        for row in old_rows if isinstance(row, dict)
    }

    # Only refresh when a new completed calendar month is available or the
    # series has never been collected. This avoids re-fetching five years daily.
    target_month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    existing_latest: dict[str, str] = {}
    for old_row in old_rows:
        if not isinstance(old_row, dict) or not old_row.get("marketItemId"):
            continue
        old_series = old_row.get("priceSeries") or old_row.get("monthlyPrices") or []
        if old_series:
            latest = max((str(point.get("month") or "") for point in old_series if isinstance(point, dict)), default="")
            if latest:
                existing_latest[old_row["marketItemId"]] = max(existing_latest.get(old_row["marketItemId"], ""), latest)
    refresh_ids = {
        item_id for item_id in PRICE_CONFIG
        if existing_latest.get(item_id, "") < target_month
    }
    histories, errors = fetch_price_histories(refresh_ids) if fetch_prices and refresh_ids else ({}, {})
    products: list[dict[str, Any]] = []
    for stock in stocks if isinstance(stocks, list) else []:
        code = str(stock.get("code") or "").lower()
        fundamental = fund_stocks.get(code, {}) if isinstance(fund_stocks, dict) else {}
        mapping = mappings.get(code, {}) if isinstance(mappings, dict) else {}
        segments = fundamental.get("mainSegments")
        if not isinstance(segments, list) or not segments:
            if fundamental.get("mainItem"):
                segments = [{
                    "name": fundamental.get("mainItem"),
                    "ratio": fundamental.get("mainRatio"),
                    "basis": fundamental.get("mainBasis"),
                    "reportDate": fundamental.get("mainDate"),
                }]
            elif mapping.get("productName"):
                segments = [{
                    "name": mapping.get("productName"),
                    "ratio": None,
                    "basis": "manual-mapping",
                    "reportDate": None,
                }]
            else:
                segments = [{
                    "name": "主营产品待识别",
                    "ratio": None,
                    "basis": "unavailable",
                    "reportDate": fundamental.get("mainDate"),
                }]

        for segment in segments:
            if not isinstance(segment, dict):
                continue
            name = str(segment.get("name") or segment.get("ITEM_NAME") or "").strip()
            if not name:
                continue
            ratio = normalize_ratio(segment.get("ratio", segment.get("MBI_RATIO")))
            basis = segment.get("basis") or segment.get("MAINOP_TYPE") or fundamental.get("mainBasis")
            market_id = infer_market_item(name)
            # A manual mapping is valid only when its maintained product name
            # exactly matches the disclosed segment; never apply it to broad
            # "other", finance, logistics, or combined business categories.
            mapped_name = str(mapping.get("productName") or "").strip()
            if (
                not market_id
                and len(segments) == 1
                and mapped_name
                and name.casefold() == mapped_name.casefold()
            ):
                market_id = mapping.get("marketItemId")
            config = PRICE_CONFIG.get(market_id)
            key = (code, name)
            old = old_by_key.get(key, {})
            series = histories.get(market_id, []) if market_id else []
            if not series and isinstance(old.get("monthlyPrices"), list):
                series = old["monthlyPrices"]
            source = "新浪财经期货主力连续历史行情（AKShare）" if config and series else old.get("priceSource")
            products.append({
                "stockCode": code,
                "stockName": stock.get("name") or fundamental.get("name") or "",
                "group": stock.get("group") or "",
                "productName": name,
                "revenueRatio": ratio,
                "ratioUnit": "占主营业务收入",
                "ratioBasis": basis,
                "reportDate": segment.get("reportDate") or segment.get("REPORT_DATE") or fundamental.get("mainDate"),
                "marketItemId": market_id,
                "priceUnit": (config or {}).get("unit") or old.get("priceUnit"),
                "priceKind": (config or {}).get("kind") or old.get("priceKind"),
                "priceSource": source,
                "priceSeries": series,
                "priceStatus": "available" if series else "unavailable",
                "priceNote": (
                    "期货主力连续价格仅作行业价格代理，不等于公司实际销售均价；连续合约换月可能产生价差。"
                    if series and config else
                    "尚无已核实的同口径公开月度价格序列；不以相近商品或估算值补齐。"
                ),
            })

    updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    if previous.get("products") == products and previous.get("fetchErrors", {}) == errors:
        updated_at = previous.get("updatedAt") or updated_at
    payload = {
        "schemaVersion": 1,
        "updatedAt": updated_at,
        "source": "Eastmoney F10主营构成 + AKShare公开商品历史行情",
        "priceWindowMonths": 60,
        "stockCount": len({row["stockCode"] for row in products}),
        "productCount": len(products),
        "pricedCount": sum(1 for row in products if row["priceStatus"] == "available"),
        "fetchErrors": errors,
        "products": products,
    }
    return payload


def main() -> int:
    payload = build()
    if not payload["products"]:
        print("No company product rows found; keeping previous output.")
        return 1
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "company products: "
        f"{payload['productCount']} rows / {payload['stockCount']} stocks; "
        f"{payload['pricedCount']} rows have monthly price history"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
