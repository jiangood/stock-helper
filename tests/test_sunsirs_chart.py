import sys
import unittest
from pathlib import Path
from unittest.mock import Mock
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sunsirs_chart
from test_sunsirs_month_start_ocr import robust_axis_fit
from collect_sunsirs_product_monthly import is_manual_override


class SunsirsChartTests(unittest.TestCase):
    def test_manual_verification_is_never_overwritten_by_ocr(self):
        # 2026-11 粘胶短纤人工复核值：价格线与网格线重叠，正确读数为 14700。
        point = {
            "month": "2026-11", "value": 14700, "status": "estimated",
            "estimated": True, "verification": "manual"
        }
        self.assertTrue(is_manual_override(point))
        self.assertTrue(is_manual_override({"status": "manual_verified", "value": 14700}))
        self.assertFalse(is_manual_override({"status": "estimated", "value": 14650}))
        self.assertFalse(is_manual_override(None))

    def test_robust_axis_fit_rejects_bad_ocr_tick(self):
        ticks = [(100.0, 18000.0, 90), (180.0, 16000.0, 90), (260.0, 14000.0, 90), (340.0, 12000.0, 90), (220.0, 99999.0, 30)]
        slope, intercept, inliers, rmse = robust_axis_fit(ticks)
        self.assertEqual(len(inliers), 4)
        self.assertAlmostEqual(slope * 220 + intercept, 15000, delta=1)
        self.assertLess(rmse, 1)

    def test_month_start_url_matches_maleic_template_for_any_ppid(self):
        self.assertEqual(
            sunsirs_chart.build_chart_url("660", 2020, 4),
            "https://www.100ppi.com/graph/report.php?btime=2020-4-1&etime=2020-4-2&f=xht_agent_price&ppid=660",
        )
        self.assertIn("ppid=1017", sunsirs_chart.build_chart_url("1017", 2026, 10))

    def test_rejects_unverified_ppid_and_invalid_month(self):
        with self.assertRaises(ValueError):
            sunsirs_chart.build_chart_url("81a", 2020, 4)
        with self.assertRaises(ValueError):
            sunsirs_chart.build_chart_url("81", 2020, 13)

    def test_fetch_rejects_non_png_and_preserves_no_fake_file(self):
        response = Mock(status_code=200, content=b"no data", url="https://example.test/")
        response.headers = {"Content-Type": "text/html"}
        client = Mock()
        client.get.return_value = response
        with TemporaryDirectory() as directory:
            output = Path(directory) / "test-no-data.png"
            with self.assertRaisesRegex(ValueError, "响应不是 PNG"):
                sunsirs_chart.fetch_chart_image("https://example.test/", output, session=client)
            self.assertFalse(output.exists())

    def test_fetch_saves_png_and_returns_provenance(self):
        body = bytes.fromhex("89504e470d0a1a0a") + b"chart"
        response = Mock(status_code=200, content=body, url="https://example.test/chart")
        response.headers = {"Content-Type": "image/png"}
        client = Mock()
        client.get.return_value = response
        with TemporaryDirectory() as directory:
            output = Path(directory) / "test-chart.png"
            result = sunsirs_chart.fetch_chart_image("https://example.test/", output, session=client)
            self.assertEqual(Path(result["path"]).read_bytes(), body)
            self.assertEqual(result["content_type"], "image/png")


if __name__ == "__main__":
    unittest.main()
