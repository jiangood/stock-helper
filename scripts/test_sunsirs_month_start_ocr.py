#!/usr/bin/env python3
"""Estimate the first-day Sunsirs maleic-anhydride price from a 2-day chart.

This is an image-derived estimate for validation only. It is deliberately not
wired into business-data.json or the production commodity builder.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
from itertools import combinations
import subprocess
from pathlib import Path

import cv2
import numpy as np


PLOT_LEFT = 60
PLOT_RIGHT = 760
AXIS_CROP_BOTTOM = 435
AXIS_CROP_TOP = 75
SCALE = 4


def _normalise_tick(text: str) -> float | None:
    value = re.sub(r"[^0-9.]", "", text)
    if "." not in value and len(value) == 7:
        value = value[:5] + "." + value[5:]
    elif "." not in value and len(value) == 6:
        value = value[:4] + "." + value[4:]
    if not re.fullmatch(r"\d{4,5}(?:\.\d{1,2})?", value):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if 500 <= number <= 1000000 else None


def detect_blue_line_y(image: np.ndarray) -> float | None:
    """Record the target blue trace before colored traces are removed."""
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([95, 100, 100], np.uint8), np.array([135, 255, 255], np.uint8))
    ys = np.where(mask[80:430, PLOT_LEFT:min(PLOT_LEFT + 12, PLOT_RIGHT)] > 0)[0] + 80
    return float(np.median(ys)) if len(ys) >= 3 else None


def read_axis_ticks(image: np.ndarray) -> list[tuple[float, float, float]]:
    # Remove saturated chart traces after blue-line position has been recorded.
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    colored = cv2.inRange(hsv, np.array([0, 35, 45], np.uint8), np.array([179, 255, 255], np.uint8))
    cleaned = image.copy()
    cleaned[colored > 0] = (255, 255, 255)
    gray = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)
    plot = gray[AXIS_CROP_TOP:AXIS_CROP_BOTTOM, PLOT_LEFT:PLOT_RIGHT]
    binary = cv2.threshold(plot, 220, 255, cv2.THRESH_BINARY_INV)[1]
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (80, 1)))
    projection = np.count_nonzero(horizontal, axis=1)
    candidates = np.where(projection >= int(plot.shape[1] * 0.12))[0] + AXIS_CROP_TOP
    clusters: list[list[int]] = []
    for y in candidates.tolist():
        if not clusters or y > clusters[-1][-1] + 2:
            clusters.append([y])
        else:
            clusters[-1].append(y)
    rows = [int(round(float(np.mean(group)))) for group in clusters]
    if len(rows) != 7:
        raise ValueError(f"预期识别到7条水平刻度线，实际识别到{len(rows)}条")
    ticks: list[tuple[float, float, float]] = []
    for y in rows:
        roi = cleaned[max(0, y - 13):min(image.shape[0], y + 14), 0:PLOT_LEFT]
        enlarged = cv2.resize(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), None, fx=5, fy=5, interpolation=cv2.INTER_CUBIC)
        _, binary_roi = cv2.threshold(enlarged, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        ok, encoded = cv2.imencode(".png", binary_roi)
        if not ok:
            continue
        output = subprocess.check_output(["tesseract", "stdin", "stdout", "tsv", "--psm", "7"], input=encoded.tobytes(), stderr=subprocess.DEVNULL).decode("utf-8", errors="replace")
        for row in csv.DictReader(io.StringIO(output), delimiter="\t"):
            value = _normalise_tick(row.get("text", "").strip())
            confidence = float(row.get("conf", "-1"))
            if value is not None and confidence >= 25:
                ticks.append((float(y), value, confidence))
                break
    return sorted(ticks)

def robust_axis_fit(ticks: list[tuple[float, float, float]]) -> tuple[float, float, list[int], float]:
    if len(ticks) < 4:
        raise ValueError(f"纵轴刻度识别不足：{len(ticks)} 个")
    ys = np.array([item[0] for item in ticks], dtype=float)
    values = np.array([item[1] for item in ticks], dtype=float)
    best, best_error = [], float("inf")
    for i, j in combinations(range(len(ticks)), 2):
        if abs(ys[j] - ys[i]) < 18:
            continue
        slope = (values[j] - values[i]) / (ys[j] - ys[i])
        intercept = values[i] - slope * ys[i]
        residuals = np.abs(values - (slope * ys + intercept))
        inliers = np.where(residuals <= 18)[0].tolist()
        error = float(np.median(residuals[inliers])) if inliers else float("inf")
        if len(inliers) > len(best) or (len(inliers) == len(best) and error < best_error):
            best, best_error = inliers, error
    if len(best) < 4:
        raise ValueError(f"纵轴有效刻度不足：仅 {len(best)} 个一致刻度")
    iy, iv = ys[best], values[best]
    if float(np.ptp(iy)) < 80:
        raise ValueError("纵轴有效刻度分布范围不足")
    slope, intercept = np.polyfit(iy, iv, 1)
    rmse = float(np.sqrt(np.mean((iv - (slope * iy + intercept)) ** 2)))
    if rmse > 8:
        raise ValueError(f"纵轴刻度稳健拟合误差仍过大：{rmse:.2f}")
    return float(slope), float(intercept), best, rmse


def estimate_first_price(image_path: Path, month: str) -> dict:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"无法读取图片：{image_path}")
    if image.shape[1] < 700 or image.shape[0] < 400:
        raise ValueError(f"图表尺寸异常：{image.shape[1]}x{image.shape[0]}")

    # Record the blue target-line coordinate before suppressing colored traces.
    first_y = detect_blue_line_y(image)
    # No blue curve means the provider returned its explicit no-data chart.
    if first_y is None:
        return {
            "month": month,
            "date_rule": "每月1日至2日图表最左侧蓝色价格线",
            "value": None,
            "unit": "元/吨",
            "status": "no_data",
            "estimated": True,
            "method": "图表无价格曲线，保留空值",
            "source_image": image_path.name,
        }

    ticks = read_axis_ticks(image)
    slope, intercept, inlier_indices, rmse = robust_axis_fit(ticks)

    price = float(slope * first_y + intercept)
    if not np.isfinite(price) or price <= 0:
        raise ValueError("换算得到的价格无效")

    return {
        "month": month,
        "date_rule": "每月1日至2日图表最左侧蓝色价格线",
        "value": round(price, 2),
        "unit": "元/吨",
        "status": "estimated",
        "method": "图像估算：OCR纵轴刻度线性拟合 + 蓝线像素定位",
        "estimated": True,
        "quality": {
            "axis_tick_count": len(ticks),
            "axis_inlier_count": len(inlier_indices),
            "axis_rejected_count": len(ticks) - len(inlier_indices),
            "axis_fit_rmse": round(rmse, 3),
            "blue_pixels_sampled": int(len(ys)),
            "first_line_y": round(first_y, 2),
        },
        "source_image": image_path.name,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--month", required=True, help="YYYY-MM")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = estimate_first_price(args.image, args.month)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
