#!/usr/bin/env python3
"""Backfill one verified Sunsirs report.php commodity chart as monthly OCR estimates."""
from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "scripts"))
from sunsirs_chart import DEFAULT_HEADERS, build_chart_url, fetch_chart_image
from test_sunsirs_month_start_ocr import estimate_first_price


def month_iter(start: str, end: str):
    year, month = map(int, start.split("-"))
    end_year, end_month = map(int, end.split("-"))
    while (year, month) <= (end_year, end_month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month == 13:
            year, month = year + 1, 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-id", required=True)
    parser.add_argument("--start-month", default="2020-01")
    parser.add_argument("--end-month", default=date.today().strftime("%Y-%m"))
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()

    products = json.loads((ROOT / "data" / "business-data.json").read_text(encoding="utf-8"))["items"]
    product = products.get(args.product_id)
    if not isinstance(product, dict) or not str(product.get("sunsirsPpid", "")).isdigit():
        raise RuntimeError(f"{args.product_id} 未配置已核实的生意社 PPID，拒绝采集")
    ppid = str(product["sunsirsPpid"])
    name = product.get("name") or args.product_id
    unit = product.get("unit") or "元/吨"
    output = ROOT / "data" / "sunsirs-chart-monthly" / f"{args.product_id}.json"
    payload = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {
        "schemaVersion": 1, "id": args.product_id, "name": name, "unit": unit,
        "ppid": ppid, "source": "生意社 report.php 商品价格走势图（图像估算）",
        "sourceUrl": "https://www.100ppi.com/graph/report.php",
        "methodNote": "每月1日至2日图表最左侧蓝色价格线；OCR纵轴刻度线性拟合与蓝线像素定位，属于图像估算值，不是生意社原始报价。缺失月份留空，不插值。",
        "dateRule": "每月1日至2日图表最左侧蓝色价格线", "points": []
    }
    if payload.get("ppid") != ppid:
        raise RuntimeError("商品 PPID 与历史文件不一致；为避免串品种，停止覆盖")
    known = {point.get("month"): point for point in payload.get("points", []) if point.get("month")}
    fetched = failed = 0
    current_month = date.today().strftime("%Y-%m")
    for month in month_iter(args.start_month, args.end_month):
        if month in known and month != current_month and known[month].get("status") in ("estimated", "no_data"):
            continue
        year, mon = map(int, month.split("-"))
        url = build_chart_url(ppid, year, mon)
        image_path = ROOT / "artifacts" / "sunsirs-chart-monthly" / f"{args.product_id}-{month}.png"
        try:
            image = None
            last_error = None
            # Rotate sessions and back off when Sunsirs serves browser-check HTML.
            for attempt in range(3):
                session = requests.Session()
                session.headers.update(DEFAULT_HEADERS)
                try:
                    image = fetch_chart_image(url, image_path, session=session, timeout=40)
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt < 2:
                        time.sleep(2 + attempt * 3)
                finally:
                    session.close()
            if image is None:
                raise RuntimeError(str(last_error or "图表请求失败"))
            estimate = estimate_first_price(image_path, month)
            point = {
                "month": month, "value": estimate.get("value"),
                "status": estimate.get("status"), "estimated": True,
                "observedDate": f"{month}-01", "unit": unit,
                "sourceImageUrl": image["url"], "imageSha256": image["sha256"]
            }
            if estimate.get("quality"):
                point["quality"] = estimate["quality"]
            if estimate.get("status") == "no_data":
                point["value"] = None
            known[month] = point
            fetched += 1
            print(json.dumps({"month": month, "status": point["status"], "value": point["value"]}, ensure_ascii=False))
        except Exception as exc:
            failed += 1
            # Keep the month explicit but empty; never interpolate OCR/request failures.
            known[month] = {
                "month": month, "value": None, "status": "unavailable",
                "estimated": True, "observedDate": f"{month}-01", "unit": unit,
                "error": str(exc)[:300]
            }
            print(json.dumps({"month": month, "status": "unavailable", "error": str(exc)}, ensure_ascii=False))
        if args.delay > 0:
            time.sleep(args.delay)

    payload.update({
        "schemaVersion": 1, "id": args.product_id, "name": name, "unit": unit,
        "ppid": ppid, "updatedAt": date.today().isoformat(),
        "points": [known[key] for key in sorted(known)]
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(output)
    valid = sum(1 for point in payload["points"] if point.get("status") == "estimated" and point.get("value") is not None)
    print(json.dumps({"product": args.product_id, "ppid": ppid, "fetched": fetched, "failed": failed, "total": len(known), "valid": valid}, ensure_ascii=False))
    # Partial histories are useful when failed months remain explicitly null.
    # Fail only when the run produced no usable estimates at all.
    return 1 if valid == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
