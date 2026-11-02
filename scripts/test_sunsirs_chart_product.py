#!/usr/bin/env python3
"""Validate a candidate Sunsirs PPID over multiple years using the generic chart method."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from sunsirs_chart import SunsirsChartProduct, build_chart_url, fetch_chart_image
from test_sunsirs_month_start_ocr import estimate_first_price


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ppid", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--start-month", default="2020-04")
    parser.add_argument("--end-month", default="2026-10")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts/sunsirs-chart-validation")
    args = parser.parse_args()
    product = SunsirsChartProduct("tio2", args.name, args.ppid)
    start_y, start_m = map(int, args.start_month.split("-"))
    end_y, end_m = map(int, args.end_month.split("-"))
    samples = [(start_y, start_m)]
    if (end_y, end_m) != (start_y, start_m):
        samples.append((end_y, end_m))
    # Include an intermediate historical year to avoid accepting a one-off image.
    middle = (start_y + end_y) // 2, 4
    if middle not in samples and (start_y, start_m) < middle < (end_y, end_m):
        samples.insert(1, middle)

    report = {
        "product": product.__dict__,
        "method": "report.php month-start chart; OCR is image-derived estimate only",
        "samples": [],
    }
    failed = False
    for year, month in samples:
        month_text = f"{year:04d}-{month:02d}"
        url = build_chart_url(product.ppid, year, month)
        image_path = args.output_dir / f"{product.product_id}-{month_text}.png"
        row = {"month": month_text, "url": url}
        try:
            fetched = fetch_chart_image(url, image_path)
            row.update(fetched)
            estimate = estimate_first_price(image_path, month_text)
            row["ocr"] = estimate
            row["status"] = estimate["status"]
            if estimate["status"] != "estimated":
                failed = True
        except Exception as exc:  # report all samples, don't hide partial failures
            row.update({"status": "failed", "error": str(exc)})
            failed = True
        report["samples"].append(row)
        print(json.dumps(row, ensure_ascii=False))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
