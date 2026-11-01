import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sunsirs
import fetch_business_data as fetcher


PRODUCT = sunsirs.Product(
    id="demo",
    name="示例品",
    list_path="/news/list-14-1217-1-1.html",
    source="示例来源",
    price_note="示例口径",
    min_price=100.0,
    max_price=100_000.0,
)


def benchmark_row(month_day, value, *, unit="元/吨", name="示例品", title=None):
    """Build one listing row in the exact shape the public page uses."""
    month, day = month_day
    title = title or (month, day)
    return (
        f'<li><div class="pr-news-tit">[ 基准价 ] {title[0]}月{title[1]}日生意社{name}基准价为'
        f'{value}{unit}\n<span>2026-{month}-{day} 08:30</span></div></li>'
    )


class SunsirsTests(unittest.TestCase):
    def test_units_are_converted_to_yuan_per_ton_and_unknown_units_rejected(self):
        self.assertEqual(sunsirs.to_yuan_per_ton(1500, "元/吨"), 1500)
        self.assertEqual(sunsirs.to_yuan_per_ton(1.5, "元/千克"), 1500)
        self.assertIsNone(sunsirs.to_yuan_per_ton(1, None))
        self.assertIsNone(sunsirs.to_yuan_per_ton(1, "美元/吨"))

    def test_parser_keeps_rows_the_source_publishes_consistently(self):
        html = (
            benchmark_row(("10", "29"), "14260.00")
            + benchmark_row(("10", "30"), "14280.50")
        )
        points = sunsirs.parse_benchmark_page(html, PRODUCT, sunsirs.page_url(PRODUCT, 1))
        self.assertEqual([point["date"] for point in points], ["2026-10-29", "2026-10-30"])
        self.assertEqual(points[-1]["spot"], 14280.5)
        self.assertEqual(points[-1]["spec"], "示例口径")
        self.assertEqual(points[-1]["sourceUrl"],
                         "https://www.100ppi.com/news/list-14-1217-1-1.html")

    def test_parser_drops_rows_it_cannot_verify(self):
        html = (
            # Title day does not match the published day.
            benchmark_row(("10", "28"), "14260", title=("10", "27"))
            # A different commodity appears in the list.
            + benchmark_row(("10", "27"), "14260", name="别的商品")
            # Value outside the plausible range declared for this commodity.
            + benchmark_row(("10", "26"), "1.00")
            # Unit that cannot be converted to a comparable CNY/t value.
            + benchmark_row(("10", "25"), "14260", unit="美元/吨")
            # The same day published twice with different values must not be averaged.
            + benchmark_row(("10", "23"), "14260")
            + benchmark_row(("10", "23"), "14300")
        )
        self.assertEqual(sunsirs.parse_benchmark_page(html, PRODUCT, "https://example.test/"), [])

    def test_fetch_stops_at_the_end_of_the_listing_and_honours_after_date(self):
        pages = {
            1: benchmark_row(("10", "30"), "14260") + benchmark_row(("10", "29"), "14260"),
            2: benchmark_row(("10", "28"), "14260") + benchmark_row(("10", "27"), "14260"),
            3: "",
        }
        requested = []

        def read(url):
            page = int(url.rsplit("-", 1)[-1].split(".")[0])
            requested.append(page)
            return pages.get(page, "")

        points = sunsirs.fetch_benchmark_series(read, PRODUCT, delay=0)
        self.assertEqual([point["date"] for point in points],
                         ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"])
        self.assertEqual(requested, [1, 2, 3])

        requested.clear()
        fresh = sunsirs.fetch_benchmark_series(read, PRODUCT, after_date="2026-10-29", delay=0)
        self.assertEqual([point["date"] for point in fresh], ["2026-10-30"])
        self.assertEqual(requested, [1])

    def test_fetch_retries_a_failing_page_and_skips_it(self):
        calls = []

        def read(url):
            page = int(url.rsplit("-", 1)[-1].split(".")[0])
            calls.append(page)
            if page == 1 and calls.count(1) == 1:
                raise OSError("temporary reset")
            if page == 1:
                return benchmark_row(("10", "30"), "14260")
            return ""

        points = sunsirs.fetch_benchmark_series(read, PRODUCT, delay=0)
        self.assertEqual([point["date"] for point in points], ["2026-10-30"])
        self.assertEqual(calls[:2], [1, 1])

    def test_fallback_mappings_stay_inside_the_product_catalogue(self):
        products = {item["id"]: item for item in fetcher.PRODUCTS}
        self.assertTrue(fetcher.SUNSIRS_BENCHMARKS, "at least one fallback commodity must be mapped")
        for product_id, product in fetcher.SUNSIRS_BENCHMARKS.items():
            self.assertIn(product_id, products)
            self.assertEqual(product.id, product_id)
            self.assertRegex(product.list_path, r"^/news/list-\d+-\d+-\d+-1\.html$")
            self.assertLess(product.min_price, product.max_price)
            self.assertTrue(product.price_note)

    def test_benchmark_merge_keeps_quote_and_series_in_step(self):
        product = fetcher.SUNSIRS_BENCHMARKS["rare-earth"]
        previous = {"series": [
            {"date": "2026-10-29", "spot": 717500},
            {"date": "2026-10-30", "spot": 715000},
        ]}
        target = {"series": [], "latest": 1, "latestDate": "2026-10-01", "status": "latest-only"}
        fresh = fetcher.apply_sunsirs_benchmark(target, previous, [], product)
        self.assertFalse(fresh)
        self.assertEqual(target["latest"], 715000)
        self.assertEqual(target["latestDate"], "2026-10-30")
        self.assertEqual(target["status"], "ok")
        self.assertEqual(target["source"], product.source)

        fresh = fetcher.apply_sunsirs_benchmark(target, previous, [
            {"date": "2026-11-02", "spot": 720000,
             "sourceUrl": "https://www.100ppi.com/news/list-12-1217-1454-1.html"},
        ], product)
        self.assertTrue(fresh)
        self.assertEqual([point["date"] for point in target["series"]],
                         ["2026-10-29", "2026-10-30", "2026-11-02"])
        self.assertEqual(target["latest"], 720000)
        self.assertEqual(target["sourceUrl"],
                         "https://www.100ppi.com/news/list-12-1217-1454-1.html")
        self.assertEqual(target["priceMethod"], product.price_note)


if __name__ == "__main__":
    unittest.main()
