#!/usr/bin/env python3
"""Download and re-check suspicious historical viscose-staple-fiber chart months.

This is an audit-only tool: it never changes the production price history.
It saves original PNGs and a comparison report for visual/manual review.
"""
from __future__ import annotations

import argparse
import json
import time
from collections import Counter
from pathlib import Path
import sys

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sunsirs_chart import DEFAULT_HEADERS, build_chart_url, fetch_chart_image
from test_sunsirs_month_start_ocr import estimate_first_price


def select_suspicious_months(points: list[dict]) -> list[tuple[dict, list[str]]]:
    counts = Counter(
        str(point.get("value")) for point in points
        if isinstance(point, dict) and point.get("value") is not None
    )
    selected = []
    for point in points:
        if not isinstance(point, dict) or not point.get("month"):
            continue
        reasons = []
        value = point.get("value")
        quality = point.get("quality") or {}
        if value is not None and counts[str(value)] > 1:
            reasons.append("重复读数")
        if quality.get("axis_tick_count") is not None and quality["axis_tick_count"] <= 4:
            reasons.append("纵轴刻度数量处于最低门槛")
        if quality.get("axis_fit_rmse") is not None and quality["axis_fit_rmse"] < 0.2:
            reasons.append("纵轴拟合误差异常偏低，需核对刻度识别")
        if quality.get("axis_rejected_count", 0) >= 2:
            reasons.append("纵轴刻度被剔除数量较多")
        if point.get("verification") == "manual":
            reasons.append("已有人工核验值，检查原图留档")
        if reasons:
            selected.append((point, reasons))
    return selected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-id", default="viscose-staple-fiber")
    parser.add_argument("--ppid", default="1017")
    parser.add_argument("--start-month", default="2020-04")
    parser.add_argument("--end-month", default="2026-11")
    parser.add_argument("--delay", type=float, default=0.6)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/viscose-audit")
    args = parser.parse_args()

    history_path = ROOT / "data" / "sunsirs-chart-monthly" / f"{args.product_id}.json"
    history = json.loads(history_path.read_text(encoding="utf-8"))
    if str(history.get("ppid")) != str(args.ppid):
        raise RuntimeError("历史文件 PPID 与审计 PPID 不一致，停止请求")
    selected = select_suspicious_months(history.get("points", []))
    start, end = args.start_month, args.end_month
    selected = [(p, why) for p, why in selected if start <= p["month"] <= end]

    report = {
        "product": args.product_id, "ppid": args.ppid,
        "scope": [start, end], "candidateCount": len(selected),
        "method": "下载原始 report.php PNG；重跑现有 OCR；保留原图供人工目视复核；不改生产数据",
        "results": []
    }
    session = requests.Session()
    session.headers.update(DEFAULT_HEADERS)
    try:
        for point, reasons in selected:
            month = point["month"]
            year, mon = map(int, month.split("-"))
            url = build_chart_url(args.ppid, year, mon)
            image_path = args.output_dir / f"{args.product_id}-{month}.png"
            row = {
                "month": month, "recordedValue": point.get("value"),
                "recordedStatus": point.get("status"),
                "recordedVerification": point.get("verification"),
                "recordedQuality": point.get("quality"),
                "recordedImageSha256": point.get("imageSha256"),
                "reasons": reasons, "url": url
            }
            try:
                fetched = fetch_chart_image(url, image_path, session=session, timeout=45)
                estimate = estimate_first_price(image_path, month)
                row.update({
                    "download": {k: v for k, v in fetched.items() if k != "path"},
                    "freshOcr": estimate,
                    "imageShaMatchesRecorded": bool(point.get("imageSha256") and point["imageSha256"] == fetched["sha256"]),
                    "difference": (
                        round(float(estimate["value"]) - float(point["value"]), 2)
                        if estimate.get("value") is not None and point.get("value") is not None else None
                    ),
                    "imageFile": image_path.name
                })
            except Exception as exc:
                row["error"] = repr(exc)
            report["results"].append(row)
            print(json.dumps({"month": month, "recorded": point.get("value"),
                              "fresh": row.get("freshOcr", {}).get("value"),
                              "error": row.get("error")}, ensure_ascii=False))
            if args.delay > 0:
                time.sleep(args.delay)
    finally:
        session.close()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "audit-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    successes = sum(1 for row in report["results"] if "freshOcr" in row)
    print(json.dumps({"candidateCount": len(selected), "downloadedAndRechecked": successes,
                      "report": str(args.output_dir / "audit-report.json")}, ensure_ascii=False))
    return 0 if successes else 1


if __name__ == "__main__":
    raise SystemExit(main())
