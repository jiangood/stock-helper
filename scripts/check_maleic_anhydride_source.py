#!/usr/bin/env python3
"""Probe a documented free spot-data interface; never synthesize a maleic quote."""
import json
from datetime import datetime, timezone
from pathlib import Path

import akshare as ak

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "business-data.json"
PROVIDER = "99期货公开现货走势（经 AKShare spot_price_qh 获取）"
SOURCE_URL = "https://www.99qh.com/"


def normalize(frame):
    if frame is None or getattr(frame, "empty", True):
        return []
    points = {}
    for _, row in frame.iterrows():
        raw_date = str(row.get("日期", row.get("date", ""))).strip()
        raw_price = row.get("现货价格", row.get("spot"))
        try:
            day = datetime.strptime(raw_date[:10], "%Y-%m-%d").date().isoformat()
            price = float(raw_price)
        except (TypeError, ValueError):
            continue
        if price > 0 and price < float("inf"):
            points[day] = {"date": day, "spot": round(price, 4), "sourceUrl": SOURCE_URL}
    return [points[key] for key in sorted(points)][-200:]


def main():
    payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
    checked = datetime.now(timezone.utc).isoformat(timespec="seconds")
    health = {"provider": PROVIDER, "sourceUrl": SOURCE_URL, "checkedAt": checked,
              "status": "unavailable", "observationCount": 0,
              "reason": "接口未返回可验证的顺酐现货报价"}
    try:
        points = normalize(ak.spot_price_qh(symbol="顺酐"))
        if points:
            item = payload["items"]["maleic-anhydride"]
            item.update({"series": points, "latest": points[-1]["spot"],
                         "latestSpot": points[-1]["spot"], "latestDate": points[-1]["date"],
                         "source": PROVIDER, "sourceUrl": SOURCE_URL, "status": "ok"})
            health.update({"status": "available", "observationCount": len(points),
                           "latestDate": points[-1]["date"], "reason": None})
        else:
            health["reason"] = "接口可访问，但没有返回带日期的正数现货报价"
    except Exception as exc:
        health.update({"status": "error", "reason": str(exc)[:180]})
    payload["maleicAnhydrideSourceCheck"] = health
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(health, ensure_ascii=False))


if __name__ == "__main__":
    main()
