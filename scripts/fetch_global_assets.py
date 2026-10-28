#!/usr/bin/env python3
"""Fetch global asset quotes from Yahoo Finance chart endpoints without inventing values."""
from __future__ import annotations

import json
import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "global-assets-data.json"
SOURCE = "Yahoo Finance public chart endpoint"
ASSETS = [
    {"id": "gold", "name": "黄金", "symbols": ["XAUUSD=X", "GC=F"], "currency": "USD/盎司", "unit": "贵金属"},
    {"id": "bitcoin", "name": "比特币", "symbols": ["BTC-USD"], "currency": "USD", "unit": "加密资产"},
    {"id": "ethereum", "name": "以太坊", "symbols": ["ETH-USD"], "currency": "USD", "unit": "加密资产"},
    {"id": "nikkei225", "name": "日经 225", "symbols": ["^N225"], "currency": "指数点", "unit": "海外指数"},
    {"id": "nasdaq100", "name": "纳斯达克 100", "symbols": ["^NDX"], "currency": "指数点", "unit": "海外指数"},
    {"id": "sp500", "name": "标普 500", "symbols": ["^GSPC"], "currency": "指数点", "unit": "海外指数"},
]

def finite(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None

def fetch_symbol(symbol: str) -> dict[str, Any]:
    encoded = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=5d&interval=1d"
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; StockHelper/1.0; +https://jiangood.github.io/stock-helper/)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(str(chart["error"]))
    results = chart.get("result") or []
    if not results:
        raise RuntimeError("provider returned no chart result")
    result = results[0]
    meta = result.get("meta") or {}
    price = finite(meta.get("regularMarketPrice"))
    timestamps = result.get("timestamp") or []
    indicators = (result.get("indicators") or {}).get("quote") or [{}]
    closes = (indicators[0] or {}).get("close") or []
    last_timestamp = None
    if timestamps:
        for index in range(min(len(timestamps), len(closes)) - 1, -1, -1):
            close = finite(closes[index])
            if close is not None:
                if price is None:
                    price = close
                last_timestamp = timestamps[index]
                break
    if price is None:
        raise RuntimeError("provider returned no valid price")
    previous = finite(meta.get("chartPreviousClose")) or finite(meta.get("previousClose"))
    if previous is None:
        valid_closes = [finite(v) for v in closes]
        valid_closes = [v for v in valid_closes if v is not None]
        if len(valid_closes) >= 2:
            previous = valid_closes[-2]
    change = price - previous if previous else None
    change_pct = (change / previous * 100) if previous and change is not None else None
    timestamp = meta.get("regularMarketTime") or last_timestamp
    quote_time = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z") if timestamp else None
    return {
        "sourceSymbol": symbol,
        "price": round(price, 8),
        "prevClose": round(previous, 8) if previous else None,
        "change": round(change, 8) if change is not None else None,
        "changePct": round(change_pct, 6) if change_pct is not None else None,
        "quoteTime": quote_time,
        "currency": meta.get("currency") or None,
        "status": "已更新",
        "sourceUrl": "https://finance.yahoo.com/quote/" + urllib.parse.quote(symbol, safe=""),
    }

def main() -> int:
    try:
        previous_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        previous_payload = {}
    previous_assets = {
        item.get("id"): item for item in previous_payload.get("assets", [])
        if isinstance(item, dict) and item.get("id")
    }
    results = []
    errors = []
    for meta in ASSETS:
        old = previous_assets.get(meta["id"], {})
        result = {
            "id": meta["id"], "name": meta["name"],
            "currency": meta["currency"], "status": "等待可靠报价",
            "price": None, "prevClose": None, "change": None,
            "changePct": None, "quoteTime": None,
            "sourceSymbol": meta["symbols"][0],
            "sourceUrl": "https://finance.yahoo.com/",
        }
        for symbol in meta["symbols"]:
            try:
                quote = fetch_symbol(symbol)
                result.update(quote)
                break
            except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError) as error:
                errors.append(f"{meta['id']} ({symbol}): {error}")
        if result["price"] is None and finite(old.get("price")):
            result.update({key: old.get(key) for key in (
                "sourceSymbol", "price", "prevClose", "change", "changePct",
                "quoteTime", "sourceUrl"
            ) if key in old})
            result["status"] = "缓存（本次未刷新）"
        elif result["price"] is not None:
            result["status"] = "已更新"
        results.append(result)
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": SOURCE,
        "assets": results,
    }
    if errors:
        payload["error"] = True
        payload["errors"] = errors
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {sum(1 for item in results if item.get('status') == '已更新')}/{len(results)} global assets.")
    if errors:
        print("\n".join(errors))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
