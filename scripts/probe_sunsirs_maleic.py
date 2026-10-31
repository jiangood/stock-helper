#!/usr/bin/env python3
"""One-off, low-rate read-only probe of Sunsirs public maleic-anhydride price-news pages.

This script deliberately does not persist or publish scraped price records.
It checks robots.txt, fetches only the five public pagination pages, and prints
aggregate parsing diagnostics (never the collected values).
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
DATE_RE = re.compile(r"20\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?")
PRICE_RE = re.compile(r"(?<![\d.])\d{3,6}(?:\.\d+)?(?![\d.])")


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


def extract_candidates(html: str) -> dict[str, set[float]]:
    parser = TextExtractor()
    parser.feed(html)
    text = parser.text()
    found: dict[str, set[float]] = defaultdict(set)
    for match in DATE_RE.finditer(text):
        raw_date = match.group(0)
        date = re.sub(r"[年月/.日]", "-", raw_date).strip("-")
        date = re.sub(r"-+", "-", date)
        if len(date.split("-")) != 3:
            continue
        start = max(0, match.start() - 100)
        end = min(len(text), match.end() + 180)
        snippet = text[start:end]
        if "顺酐" not in snippet and "参考价" not in snippet:
            continue
        snippet = DATE_RE.sub(" ", snippet)
        prices = {
            float(value)
            for value in PRICE_RE.findall(snippet)
            if 1000 <= float(value) <= 50000
        }
        if prices:
            found[date].update(prices)
    return found


def main() -> int:
    if not robots_allows():
        print("Probe stopped: robots.txt disallows the requested pages or could not be checked.")
        return 2

    merged: dict[str, set[float]] = defaultdict(set)
    successful_pages = 0
    for index, path in enumerate(PAGES):
        url = urljoin(BASE, path)
        try:
            status, html = read_url(url)
            candidates = extract_candidates(html)
            for date, values in candidates.items():
                merged[date].update(values)
            successful_pages += 1
            print(
                f"page={index + 1} http={status} bytes={len(html.encode('utf-8'))} "
                f"candidate_dates={len(candidates)}"
            )
        except HTTPError as exc:
            print(f"page={index + 1} http={exc.code} candidate_dates=0")
        except (URLError, TimeoutError, UnicodeError, RuntimeError) as exc:
            print(f"page={index + 1} error={type(exc).__name__} candidate_dates=0")
        if index < len(PAGES) - 1:
            time.sleep(2)

    dates = sorted(merged)
    conflicts = sum(1 for values in merged.values() if len(values) > 1)
    print(
        f"SUMMARY pages_ok={successful_pages}/{len(PAGES)} "
        f"unique_candidate_dates={len(dates)} conflicting_dates={conflicts} "
        f"earliest={dates[0] if dates else 'none'} latest={dates[-1] if dates else 'none'}"
    )
    print("No price values were printed or saved; this is a technical parsing probe only.")
    return 0 if successful_pages == len(PAGES) and dates and conflicts == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
