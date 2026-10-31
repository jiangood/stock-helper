import importlib.util
import unittest
from datetime import date
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_company_products.py"
SPEC = importlib.util.spec_from_file_location("build_company_products", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompanyProductDatabaseTests(unittest.TestCase):
    def test_normalize_ratio_accepts_fraction_and_percent(self):
        self.assertEqual(MODULE.normalize_ratio(0.4567), 0.4567)
        self.assertEqual(MODULE.normalize_ratio(45.67), 0.4567)
        self.assertIsNone(MODULE.normalize_ratio(-1))
        self.assertIsNone(MODULE.normalize_ratio("invalid"))

    def test_combined_product_names_are_not_mapped_to_one_commodity(self):
        self.assertIsNone(MODULE.infer_market_item("锡/锑/锌"))
        self.assertIsNone(MODULE.infer_market_item("PVC、烧碱"))
        self.assertIsNone(MODULE.infer_market_item("铅锑精矿"))
        self.assertIsNone(MODULE.infer_market_item("车用尿素"))
        self.assertEqual(MODULE.infer_market_item("铅"), "lead")
        self.assertEqual(MODULE.infer_market_item("锌产品"), "zinc")

    def test_unrelated_segment_does_not_inherit_manual_commodity_mapping(self):
        result = MODULE.build(
            fetch_prices=False,
            fundamentals={"stocks": {"sh600000": {
                "mainItem": "其他(补充)",
                "mainRatio": 0.2,
                "mainBasis": "product",
            }}},
            stock_products={"byCode": {"sh600000": {
                "productName": "甲醇",
                "marketItemId": "methanol",
            }}},
            stocks=[{"code": "sh600000", "name": "测试公司"}],
            previous={},
        )
        row = result["products"][0]
        self.assertEqual(row["productName"], "其他(补充)")
        self.assertIsNone(row["marketItemId"])
        self.assertEqual(row["priceStatus"], "unavailable")

    def test_month_end_is_included_as_completed_month(self):
        self.assertEqual(MODULE.latest_completed_month(date(2026, 10, 31)), "2026-10")
        self.assertEqual(MODULE.latest_completed_month(date(2026, 10, 30)), "2026-09")

    def test_monthly_last_uses_last_valid_close_per_month(self):
        rows = [
            {"date": "2025-01-03", "close": 100},
            {"date": "2025-01-31", "close": 108},
            {"date": "2025-02-03", "close": 110},
            {"date": "2025-02-28", "close": None, "settle": 112},
            {"date": "invalid", "close": 120},
        ]
        self.assertEqual(
            MODULE.monthly_last(rows),
            [
                {"month": "2025-01", "price": 108.0, "date": "2025-01-31"},
                {"month": "2025-02", "price": 112.0, "date": "2025-02-28"},
            ],
        )

    def test_build_expands_segments_and_preserves_old_price_history(self):
        old_series = [{"month": "2025-01", "price": 1234.0, "date": "2025-01-31"}]
        result = MODULE.build(
            fetch_prices=False,
            fundamentals={
                "stocks": {
                    "sh600000": {
                        "mainSegments": [
                            {"name": "甲醇", "ratio": 0.45, "basis": "product", "reportDate": "2025-12-31"},
                            {"name": "纯碱", "ratio": 0.3, "basis": "product", "reportDate": "2025-12-31"},
                        ]
                    }
                }
            },
            stock_products={"byCode": {}},
            stocks=[{"code": "sh600000", "name": "测试公司", "group": "化工"}],
            previous={
                "products": [{
                    "stockCode": "sh600000",
                    "productName": "甲醇",
                    "marketItemId": "methanol",
                    "priceSeries": old_series,
                    "priceUnit": "元/吨",
                    "priceSource": "历史来源",
                }]
            },
        )
        self.assertEqual(len(result["products"]), 2)
        methanol = result["products"][0]
        self.assertEqual(methanol["revenueRatio"], 0.45)
        self.assertEqual(methanol["marketItemId"], "methanol")
        self.assertEqual(methanol["priceSeries"], old_series)
        self.assertEqual(methanol["priceStatus"], "available")
        self.assertEqual(result["stockCount"], 1)
        self.assertEqual(result["pricedCount"], 1)


if __name__ == "__main__":
    unittest.main()
