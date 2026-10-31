import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_business_data as fetcher


class BusinessDataTests(unittest.TestCase):
    def test_clean_series_sorts_dates_and_drops_invalid_points(self):
        series = fetcher.clean_series([
            {"date": "2026-10-27", "spot": 101, "futures": None},
            {"date": "not-a-date", "spot": 102, "futures": 103},
            {"date": "2026-10-26", "spot": 100, "futures": 99},
            {"date": "2026-10-28", "spot": -1, "futures": 104},
        ])
        self.assertEqual([x["date"] for x in series], ["2026-10-26", "2026-10-27", "2026-10-28"])
        self.assertEqual(series[0]["spot"], 100)
        self.assertNotIn("spot", series[-1])
        self.assertEqual(series[-1]["futures"], 104)

    def test_feed_cost_commodities_are_tracked_for_tiankang(self):
        products = {item["id"]: item for item in fetcher.PRODUCTS}
        self.assertEqual(products["corn"]["symbol"], "C")
        self.assertEqual(products["soybean-meal"]["symbol"], "M")
        self.assertIn("玉米", products["corn"]["aliases"])
        self.assertIn("豆粕", products["soybean-meal"]["aliases"])
        payload = fetcher.build_payload({})
        self.assertEqual(payload["items"]["corn"]["name"], "玉米")
        self.assertEqual(payload["items"]["soybean-meal"]["name"], "豆粕")
        self.assertIsNone(payload["items"]["corn"]["latest"])
        self.assertIsNone(payload["items"]["soybean-meal"]["latest"])

    def test_live_hog_is_tracked_and_mapped_to_tiankang_biology(self):
        product = next(item for item in fetcher.PRODUCTS if item["id"] == "live-hog")
        self.assertEqual(product["name"], "生猪")
        self.assertIn("生猪", product["aliases"])
        self.assertIn("天康生物", product["stocks"])
        payload = fetcher.build_payload({})
        self.assertEqual(payload["items"]["live-hog"]["name"], "生猪")
        self.assertIsNone(payload["items"]["live-hog"]["latest"])
        self.assertEqual(payload["items"]["live-hog"]["status"], "pending")

    def test_maleic_anhydride_is_tracked_as_a_separate_commodity(self):
        product = next(item for item in fetcher.PRODUCTS if item["id"] == "maleic-anhydride")
        self.assertEqual(product["name"], "顺酐")
        self.assertIn("顺酐", product["aliases"])
        self.assertIn("齐翔腾达", product["stocks"])
        payload = fetcher.build_payload({})
        self.assertEqual(payload["items"]["maleic-anhydride"]["name"], "顺酐")
        self.assertIsNone(payload["items"]["maleic-anhydride"]["latest"])
        self.assertEqual(payload["items"]["maleic-anhydride"]["status"], "pending")

    def test_build_payload_does_not_fabricate_missing_quotes(self):
        payload = fetcher.build_payload({
            "SA": [
                {"date": "2026-10-27", "spot": 1200, "futures": 1210},
                {"date": "2026-10-28", "spot": 1230, "futures": 1240},
            ]
        })
        soda = payload["items"]["soda-ash"]
        missing = payload["items"]["tio2"]
        self.assertEqual(soda["latest"], 1230)
        self.assertEqual(soda["latestDate"], "2026-10-28")
        self.assertEqual(soda["status"], "ok")
        self.assertIsNone(missing["latest"])
        self.assertEqual(missing["status"], "pending")

    def test_normalize_source_monthly_prices_keeps_source_order_and_omits_missing(self):
        points = fetcher.normalize_source_monthly_prices({
            "近5月": 1000, "近4月": 1050, "近3月": None,
            "近2月": "1,100", "近1月": "-", "最新价": 1125,
        })
        self.assertEqual(points, [
            {"label": "5个月前", "value": 1000},
            {"label": "4个月前", "value": 1050},
            {"label": "2个月前", "value": 1100},
            {"label": "最新", "value": 1125},
        ])
        dated = fetcher.normalize_source_monthly_prices({
            "商品名称": "动力煤", "2026-08-01": 900, "2026-09-01": 950,
            "2026-10-01": 1000, "最新价": 1050,
        })
        self.assertEqual(
            [(point.get("date"), point["value"]) for point in dated if point.get("date")],
            [("2026-08-01", 900), ("2026-09-01", 950), ("2026-10-01", 1000)],
        )

    def test_normalize_company_list_splits_names_deduplicates_and_ignores_placeholders(self):
        self.assertEqual(
            fetcher.normalize_company_list("甲公司,乙公司，甲公司;丙公司"),
            ["甲公司", "乙公司", "丙公司"],
        )
        self.assertEqual(fetcher.normalize_company_list("-"), [])
        self.assertEqual(fetcher.normalize_company_list(None), [])
        self.assertEqual(fetcher.normalize_company_list(float("nan")), [])

    def test_normalize_inventory_frame_preserves_date_value_and_signed_change(self):
        class FakeFrame:
            empty = False
            def iterrows(self):
                return iter(enumerate([
                    {"日期": "2026-10-27", "库存": 1200, "增减": -25},
                    {"日期": "2026-10-28", "库存": 1175, "增减": -25},
                    {"日期": "invalid", "库存": 1000, "增减": 10},
                    {"日期": "2026-10-29", "库存": 0, "增减": 0},
                ]))
        series = fetcher.normalize_inventory_frame(FakeFrame())
        self.assertEqual(len(series), 2)
        self.assertEqual(series[-1]["date"], "2026-10-28")
        self.assertEqual(series[-1]["value"], 1175)
        self.assertEqual(series[-1]["change"], -25)

    def test_compact_chart_dates_roll_over_year_correctly(self):
        class FakeFrame:
            empty = False
            def iterrows(self):
                return iter(enumerate([
                    {"日期": "11-26", "现货价格": 100, "主力合约": 101},
                    {"日期": "12-05", "现货价格": 102, "主力合约": 103},
                    {"日期": "01-10", "现货价格": 98, "主力合约": 99},
                    {"日期": "10-28", "现货价格": 110, "主力合约": 111},
                ]))
        series = fetcher.normalize_sys_frame(FakeFrame(), today=fetcher.date(2026, 10, 28))
        self.assertEqual(series[0]["date"], "2025-11-26")
        self.assertEqual(series[-1]["date"], "2026-10-28")
        self.assertEqual(series[-1]["spot"], 110)

    def test_finite_number_rejects_zero_nan_and_text(self):
        self.assertIsNone(fetcher.finite_number(0))
        self.assertIsNone(fetcher.finite_number(float("nan")))
        self.assertIsNone(fetcher.finite_number("unavailable"))
        self.assertEqual(fetcher.finite_number("123.4"), 123.4)


if __name__ == "__main__":
    unittest.main()
