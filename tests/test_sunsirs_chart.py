import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sunsirs_chart


class SunsirsChartTests(unittest.TestCase):
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
        output = Path("artifacts/test-no-data.png")
        output.unlink(missing_ok=True)
        with self.assertRaisesRegex(ValueError, "响应不是 PNG"):
            sunsirs_chart.fetch_chart_image("https://example.test/", output, session=client)
        self.assertFalse(output.exists())

    def test_fetch_saves_png_and_returns_provenance(self):
        body = bytes.fromhex("89504e470d0a1a0a") + b"chart"
        response = Mock(status_code=200, content=body, url="https://example.test/chart")
        response.headers = {"Content-Type": "image/png"}
        client = Mock()
        client.get.return_value = response
        output = Path("artifacts/test-chart.png")
        result = sunsirs_chart.fetch_chart_image("https://example.test/", output, session=client)
        self.assertEqual(Path(result["path"]).read_bytes(), body)
        self.assertEqual(result["content_type"], "image/png")
        output.unlink()
        output.parent.rmdir()


if __name__ == "__main__":
    unittest.main()
