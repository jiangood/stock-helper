#!/usr/bin/env python3
"""Read Business Society (生意社) public benchmark prices.

Business Society publishes one benchmark price per commodity each trading day at
08:30 on a public "基准价" news list. Each list keeps about three pages, roughly
six months of daily values, and every row carries the commodity name, the value,
the unit and the publish time, which is enough to verify a row before accepting
it.

This module only reads those pages. It never derives a price from an index, never
interpolates a missing day and never substitutes a related commodity.
"""
from __future__ import annotations

import http.cookiejar
import re
import sys
import time
from dataclasses import dataclass
from datetime import date
from typing import Callable
from urllib.parse import urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

ORIGIN = "https://www.100ppi.com"
REQUEST_TIMEOUT_SECONDS = 20
PAGE_DELAY_SECONDS = 1.5
MAX_PAGES = 4
USER_AGENT = "Mozilla/5.0 (compatible; StockHelperCommodityBot/1.0)"

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept-Encoding": "identity",
    "Connection": "keep-alive",
}

# The row is repeated verbatim on the commodity page and on the paginated list,
# so the title date, the published date, the commodity name and the unit all act
# as cross-checks before a value is accepted.
BENCHMARK_ROW = re.compile(
    r"\[\s*基准价\s*\]\s*(\d{1,2})月(\d{1,2})日生意社(.{1,24}?)基准价为\s*"
    r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*"
    r"(元/吨|元/千克|元/克|美元/吨)?\s*"
    r"(20\d{2})-(\d{2})-(\d{2})\s+\d{2}:\d{2}(?::\d{2})?"
)

_UNIT_TO_YUAN_PER_TON = {
    "元/吨": 1.0,
    "元/千克": 1000.0,
    "元/克": 1_000_000.0,
}


@dataclass(frozen=True)
class Product:
    """One commodity that maps to a verified Business Society benchmark list."""

    id: str
    name: str
    list_path: str
    source: str
    price_note: str
    min_price: float
    max_price: float


def to_yuan_per_ton(value: float, unit: str | None) -> float | None:
    """Convert a published value to CNY/t, or reject an unknown unit outright."""
    factor = _UNIT_TO_YUAN_PER_TON.get((unit or "").strip())
    if factor is None:
        return None
    return value * factor


def session(delay: float = PAGE_DELAY_SECONDS) -> Callable[[str], str]:
    """Return a reader that answers the short HW_CHECK browser check once per run.

    The site may serve a ~700 byte page that only sets an HW_CHECK cookie and
    reloads. Replaying that cookie keeps the collector on the public HTML pages
    without executing any script from the source. One session covers every page
    of a run, so the challenge is not repeated per request.
    """
    jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(jar))

    def read(url: str) -> str:
        def request() -> str:
            with opener.open(Request(url, headers=HEADERS), timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return response.read().decode("utf-8", errors="replace")

        html = request()
        if len(html) < 3000 and "HW_CHECK" in html:
            token = re.search(r'_0x2\s*=\s*"([0-9a-f]{8,})"', html)
            if token:
                jar.set_cookie(http.cookiejar.Cookie(
                    0, "HW_CHECK", token.group(1), None, False,
                    urlparse(url).hostname or "", False, False,
                    "/", True, False, None, False, None, None, {},
                ))
                html = request()
        return html

    return read


def page_text(html: str) -> str:
    """Reduce a page to readable text so row matching ignores the markup."""
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def parse_benchmark_page(html: str, product: Product, page_url: str) -> list[dict]:
    """Extract verified daily benchmark prices from one listing page.

    Rows are dropped rather than guessed: the commodity name must match, the
    title month/day must equal the published date, the unit must be known, and
    the converted value must stay inside the range declared for the commodity.
    A date published twice with different values is dropped, never averaged.
    """
    text = page_text(html)
    found: dict[str, set[float]] = {}
    for match in BENCHMARK_ROW.finditer(text):
        title_month, title_day = int(match.group(1)), int(match.group(2))
        name = match.group(3).strip()
        value_text = match.group(4).replace(",", "")
        unit = match.group(5)
        year, month, day = int(match.group(6)), int(match.group(7)), int(match.group(8))
        if name != product.name:
            continue
        if (title_month, title_day) != (month, day):
            continue
        try:
            value = float(value_text)
        except ValueError:
            continue
        converted = to_yuan_per_ton(value, unit)
        if converted is None:
            continue
        if not product.min_price <= converted <= product.max_price:
            continue
        try:
            observed = date(year, month, day).isoformat()
        except ValueError:
            continue
        found.setdefault(observed, set()).add(round(converted, 2))
    return [
        {
            "date": observed,
            "spot": values.pop(),
            "spec": product.price_note,
            "sourceUrl": page_url,
        }
        for observed, values in sorted(found.items())
        if len(values) == 1
    ]


def page_url(product: Product, page: int) -> str:
    path = re.sub(r"-\d+\.html$", f"-{page}.html", product.list_path)
    return ORIGIN + path


def fetch_benchmark_series(
    read: Callable[[str], str],
    product: Product,
    *,
    max_pages: int = MAX_PAGES,
    after_date: str | None = None,
    delay: float = PAGE_DELAY_SECONDS,
) -> list[dict]:
    """Collect the recent daily benchmark prices of one commodity.

    The listing keeps only a few pages, so the repository accumulates history
    across runs: pass the newest stored date as ``after_date`` to stop paging as
    soon as the already-known days are reached.
    """
    observed: dict[str, dict] = {}
    for page in range(1, max_pages + 1):
        url = page_url(product, page)
        points: list[dict] | None = None
        for attempt in range(2):
            try:
                points = parse_benchmark_page(read(url), product, url)
                break
            except Exception as exc:  # noqa: BLE001 - a single page must not stop the run
                if attempt == 0:
                    time.sleep(delay)
                    continue
                print(f"{product.name} benchmark page skipped ({url}): {str(exc)[:140]}", file=sys.stderr)
        if points is None:
            # The page failed twice; older pages are still worth trying.
            if page < max_pages:
                time.sleep(delay)
            continue
        if not points:
            # The listing is exhausted; older pages add nothing.
            break
        for point in points:
            if after_date and point["date"] <= after_date:
                continue
            observed.setdefault(point["date"], point)
        if after_date and points[0]["date"] <= after_date:
            break
        if page < max_pages:
            time.sleep(delay)
    return [observed[day] for day in sorted(observed)]
