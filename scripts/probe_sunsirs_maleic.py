#!/usr/bin/env python3
"""Low-rate, read-only parser validation for public Sunsirs maleic price-news pages.

The probe checks robots.txt, fetches only five public pagination pages, and
prints aggregate diagnostics. It does not save or publish scraped price data.
"""
from __future__ import annotations

import re
import sys
import time
from collections import defaultdict
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser
from urllib.request import Request, urlopen

BASE = "https://ma.100ppi.com"
PAGES = ["/kx/"] + [f"/kx/list---{n}.html" for n in range(2, 6)]
USER_AGENT = "StockHelperPersonalResearchProbe/1.0 (low-rate; contact: repository owner)"
ENTRY_RE = re.compile(
    r"\[\s*顺酐\s*\]\s*(\d{1,2})月(\d{1,2})日顺酐为"
    r"(\d{4,6}(?:\.\d+)?)\s+(20\d{2})-(\d{2})-(\d{2})"
    r"\s+\d{2}:\d{2}:\d{2}\s+\d{1,2}月\d{1,2}日[，,]\s*顺酐参考价为"
    r"(\d{4,6}(?:\.\d+)?)"
)


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"script", "style", "noscript"}:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self.skip:
            self.skip -= 1
        if not self.skip and tag in {"li", "tr", "p", "br", "div"}:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self.skip and data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts))


def read_url(url: str) -> tuple[int, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urlopen(request, timeout=20) as response:
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type.lower():
            raise RuntimeError(f"Unexpected content type for {url}: {content_type}")
        body = response.read(2_000_000)
        return response.status, body.decode(response.headers.get_content_charset() or "utf-8", errors="replace")


def robots_allows() -> bool:
    robots_url = urljoin(BASE, "/robots.txt")
    try:
        status, content = read_url(robots_url)
    except HTTPError as exc:
        if exc.code == 404:
            print("robots.txt: 404 (no published rules found); proceeding cautiously")
            return True
        print(f"robots.txt request failed: HTTP {exc.code}")
        return False
    except (URLError, TimeoutError, RuntimeError) as exc:
        print(f"robots.txt request failed: {type(exc).__name__}")
        return False
    parser = RobotFileParser()
    parser.set_url(robots_url)
    parser.parse(content.splitlines())
    allowed = all(parser.can_fetch(USER_AGENT, urljoin(BASE, path)) for path in PAGES)
    print(f"robots.txt: HTTP {status}; all_target_pages_allowed={allowed}")
    return allowed


def extract_candidates(html: str) -> tuple[dict[str, set[float]], int, int]:
    parser = TextExtractor()
    parser.feed(html)
    text = parser.text()
    found: dict[str, set[float]] = defaultdict(set)
    accepted = 0
    rejected = 0
    for match in ENTRY_RE.finditer(text):
        title_month, title_day = int(match.group(1)), int(match.group(2))
        headline_price = float(match.group(3))
        year, month, day = int(match.group(4)), int(match.group(5)), int(match.group(6))
        detail_price = float(match.group(7))
        if (title_month, title_day) != (month, day):
            rejected += 1
            continue
        if not (1000 <= headline_price <= 50000) or abs(headline_price - detail_price) > 0.001:
            rejected += 1
            continue
        date = f"{year:04d}-{month:02d}-{day:02d}"
        found[date].add(headline_price)
        accepted += 1
    return found, accepted, rejected


def main() -> int:
    if not robots_allows():
        print("Probe stopped: robots.txt disallows the requested pages or could not be checked.")
        return 2

    merged: dict[str, set[float]] = defaultdict(set)
    successful_pages = 0
    total_records = 0
    for index, path in enumerate(PAGES):
        url = urljoin(BASE, path)
        try:
            status, html = read_url(url)
            candidates, accepted, rejected = extract_candidates(html)
            for date, values in candidates.items():
                merged[date].update(values)
            successful_pages += 1
            total_records += accepted
            page_dates = sorted(candidates)
            print(
                f"page={index + 1} http={status} bytes={len(html.encode('utf-8'))} "
                f"records={accepted} unique_dates={len(candidates)} rejected={rejected} "
                f"range={page_dates[0] if page_dates else 'none'}..{page_dates[-1] if page_dates else 'none'}"
            )
        except HTTPError as exc:
            print(f"page={index + 1} http={exc.code} records=0")
        except (URLError, TimeoutError, UnicodeError, RuntimeError) as exc:
            print(f"page={index + 1} error={type(exc).__name__} records=0")
        if index < len(PAGES) - 1:
            time.sleep(2)

    dates = sorted(merged)
    conflicts = sum(1 for values in merged.values() if len(values) > 1)
    print(
        f"SUMMARY pages_ok={successful_pages}/{len(PAGES)} records={total_records} "
        f"unique_dates={len(dates)} duplicate_rows={total_records - len(dates)} "
        f"conflicting_dates={conflicts} "
        f"earliest={dates[0] if dates else 'none'} latest={dates[-1] if dates else 'none'}"
    )
    print("No price values were printed or saved; this is a technical parser probe only.")
    return 0 if successful_pages == len(PAGES) and total_records > 0 and conflicts == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
