#!/usr/bin/env python3
"""Backfill the approved maleic-anhydride month-start chart-image series."""
from __future__ import annotations
import argparse
import calendar
import json
import time
from datetime import date
from pathlib import Path
import requests
from test_sunsirs_month_start_ocr import estimate_first_price

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "maleic-anhydride-monthly.json"
SOURCE = "生意社顺酐现货均价图表（图像估算）"
BASE_URL = "https://www.100ppi.com/graph/report.php"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.100ppi.com/",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "same-site",
}
METHOD_NOTE = "每月1日至2日图表最左侧蓝色价格线；OCR纵轴刻度线性拟合与蓝线像素定位，属于图像估算值，不是生意社原始报价。缺失月份留空，不插值。"

def month_iter(start: str, end: str):
    year, month = map(int, start.split("-"))
    end_year, end_month = map(int, end.split("-"))
    while (year, month) <= (end_year, end_month):
        yield f"{year:04d}-{month:02d}"
        month += 1
        if month == 13:
            year, month = year + 1, 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-month", default="2010-05")
    parser.add_argument("--end-month", default=date.today().strftime("%Y-%m"))
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()
    payload = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {
        "schemaVersion": 1, "id": "maleic-anhydride", "name": "顺酐", "unit": "元/吨",
        "source": SOURCE, "sourceUrl": BASE_URL + "?btime=YYYY-M-1&etime=YYYY-M-2&f=xht_agent_price&ppid=660",
        "dateRule": "每月1日至2日图表最左侧蓝色价格线", "methodNote": METHOD_NOTE,
        "startMonth": args.start_month, "points": []
    }
    known = {p.get("month"): p for p in payload.get("points", []) if p.get("month")}
    session = requests.Session()
    session.headers.update(HEADERS)
    fetched = updated = failed = 0
    current_month = date.today().strftime("%Y-%m")
    for month in month_iter(args.start_month, args.end_month):
        # Keep established historical observations; always refresh the current month.
        if month in known and month != current_month:
            continue
        year, mon = map(int, month.split("-"))
        url = BASE_URL
        params = {"btime": f"{year}-{mon}-1", "etime": f"{year}-{mon}-2", "f": "xht_agent_price", "ppid": "660"}
        try:
            response = session.get(url, params=params, timeout=40)
            response.raise_for_status()
            content = response.content
            if not content.startswith(bytes.fromhex("89504e470d0a1a0a")):
                raise ValueError(f"response is not PNG (content-type={response.headers.get('Content-Type')})")
            image_path = ROOT / "artifacts" / f"maleic-{month}.png"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(content)
            result = estimate_first_price(image_path, month)
            point = {
                "month": month, "value": result.get("value"),
                "status": result.get("status"), "estimated": True,
                "observedDate": f"{month}-01", "unit": "元/吨",
                "sourceImageUrl": response.url,
                "imageSha256": __import__("hashlib").sha256(content).hexdigest()
            }
            if result.get("quality"):
                point["quality"] = result["quality"]
            if result.get("status") == "no_data":
                point["value"] = None
            known[month] = point
            fetched += 1
            print(json.dumps({"month": month, "status": point["status"], "value": point["value"]}, ensure_ascii=False))
        except Exception as exc:
            failed += 1
            print(json.dumps({"month": month, "error": str(exc)}, ensure_ascii=False))
        if args.delay > 0:
            time.sleep(args.delay)
    payload.update({
        "schemaVersion": 1, "id": "maleic-anhydride", "name": "顺酐", "unit": "元/吨",
        "source": SOURCE, "methodNote": METHOD_NOTE, "updatedAt": date.today().isoformat(),
        "points": [known[key] for key in sorted(known)]
    })
    temp = DATA.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(DATA)
    valid = sum(1 for p in payload["points"] if p.get("status") == "estimated" and p.get("value") is not None)
    print(json.dumps({"fetched": fetched, "failed": failed, "total": len(known), "valid": valid}, ensure_ascii=False))
if __name__ == "__main__":
    main()
