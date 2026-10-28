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

    def test_finite_number_rejects_zero_nan_and_text(self):
        self.assertIsNone(fetcher.finite_number(0))
        self.assertIsNone(fetcher.finite_number(float("nan")))
        self.assertIsNone(fetcher.finite_number("unavailable"))
        self.assertEqual(fetcher.finite_number("123.4"), 123.4)


if __name__ == "__main__":
    unittest.main()
