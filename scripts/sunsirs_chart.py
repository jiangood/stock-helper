#!/usr/bin/env python3
"""Reusable Sunsirs (生意社) report.php chart downloader.

The caller must supply a PPID verified from the actual Sunsirs chart request.
This module only retrieves and validates the chart image; it never guesses IDs,
substitutes another price source, or treats a non-chart response as valid data.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import requests

BASE_URL = "https://www.100ppi.com/graph/report.php"
PNG_SIGNATURE = bytes.fromhex("89504e470d0a1a0a")
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.100ppi.com/",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "same-site",
}


@dataclass(frozen=True)
class SunsirsChartProduct:
    product_id: str
    name: str
    ppid: str
    unit: str = "元/吨"
    specification: str = ""


def build_chart_url(ppid: str, year: int, month: int) -> str:
    """Build the exact month-start report.php request used by maleic anhydride."""
    if not str(ppid).isdigit():
        raise ValueError("PPID 必须是从生意社真实图表请求中确认的数字")
    if not 1 <= month <= 12:
        raise ValueError(f"无效月份：{month}")
    params = {
        "btime": f"{year}-{month}-1",
        "etime": f"{year}-{month}-2",
        "f": "xht_agent_price",
        "ppid": str(ppid),
    }
    return f"{BASE_URL}?{urlencode(params)}"


def fetch_chart_image(
    url: str,
    output_path: Path,
    *,
    session: requests.Session | None = None,
    timeout: int = 40,
) -> dict:
    """Download a real PNG chart; reject HTML, no-data text, and other payloads."""
    client = session or requests.Session()
    if session is None:
        client.headers.update(DEFAULT_HEADERS)
    response = client.get(url, timeout=timeout)
    response.raise_for_status()
    body = response.content
    if not body.startswith(PNG_SIGNATURE):
        preview = body[:120].decode("utf-8", errors="replace").replace("\n", " ")
        raise ValueError(
            f"响应不是 PNG 图表 (content-type={response.headers.get('Content-Type')}, "
            f"bytes={len(body)}, preview={preview!r})"
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(body)
    return {
        "url": response.url,
        "status_code": response.status_code,
        "content_type": response.headers.get("Content-Type", ""),
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "path": str(output_path),
    }
