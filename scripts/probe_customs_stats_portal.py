#!/usr/bin/env python3
"""Read-only inspection of the public Customs statistics portal frontend.

Fetches the landing page and a small number of same-origin JavaScript assets.
It does not submit a query, download statistics, solve a CAPTCHA, or persist data.
"""
from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

BASE = "https://stats.customs.gov.cn/"
UA = "StockHelperCustomsPortalProbe/1.0 (read-only public frontend inspection)"
MAX_ASSETS = 8
MAX_BYTES = 3_000_000


class Scripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() == "script":
            src = dict(attrs).get("src")
            if src:
                self.sources.append(src)


def fetch(url: str) -> tuple[int, str, str]:
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/javascript,*/*"})
    with urlopen(req, timeout=25) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise RuntimeError("response exceeds inspection size limit")
        charset = response.headers.get_content_charset() or "utf-8"
        return response.status, response.headers.get("Content-Type", ""), body.decode(charset, "replace")


def main() -> int:
    try:
        status, content_type, html = fetch(BASE)
    except Exception as exc:
        print(f"portal_fetch=failed error={type(exc).__name__}")
        return 1

    print(f"portal_fetch=ok http={status} content_type={content_type} html_chars={len(html)}")
    parser = Scripts()
    parser.feed(html)
    candidates: list[str] = []
    for src in parser.sources:
        absolute = urljoin(BASE, src)
        parsed = urlparse(absolute)
        if parsed.scheme == "https" and parsed.netloc == urlparse(BASE).netloc and absolute not in candidates:
            candidates.append(absolute)

    print(f"same_origin_script_count={len(candidates)}")
    inspected = 0
    endpoint_hits: set[str] = set()
    captcha_hits: set[str] = set()
    for asset_url in candidates[:MAX_ASSETS]:
        try:
            code_status, code_type, code = fetch(asset_url)
            inspected += 1
            path = urlparse(asset_url).path
            print(f"asset={path} http={code_status} content_type={code_type} chars={len(code)}")
            for match in re.findall(r"""["']([^"'\s]{1,180}(?:/api/|\.do(?:\?|$)|\.action(?:\?|$)|/query|/export)[^"'\s]{0,180})["']""", code, re.I):
                endpoint_hits.add(match[:220])
            for term in re.findall(r"captcha|滑块|拼图|verify|verification|geetest|validate", code, re.I):
                captcha_hits.add(term.lower())
        except Exception as exc:
            print(f"asset_fetch=failed path={urlparse(asset_url).path} error={type(exc).__name__}")

    print(f"assets_inspected={inspected}")
    print(f"endpoint_string_candidates={len(endpoint_hits)}")
    for item in sorted(endpoint_hits)[:12]:
        print(f"endpoint_candidate={item}")
    print(f"captcha_related_terms={','.join(sorted(captcha_hits)) if captcha_hits else 'none_detected'}")
    print("No query form was submitted; no CAPTCHA was attempted or bypassed; no statistics were downloaded or saved.")
    return 0 if inspected else 2


if __name__ == "__main__":
    sys.exit(main())
