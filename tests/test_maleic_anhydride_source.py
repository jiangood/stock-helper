import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_maleic_anhydride_source as checker


class FakeFrame:
    empty = False

    def iterrows(self):
        return iter(enumerate([
            {"日期": "2026-10-29", "现货价格": 10000},
            {"日期": "2026-10-30", "现货价格": 0},
            {"日期": "invalid", "现货价格": 10100},
            {"日期": "2026-10-31 00:00:00", "现货价格": "10050"},
            {"日期": "2026-11-01", "现货价格": float("nan")},
        ]))


class MaleicSourceTests(unittest.TestCase):
    def test_only_dated_positive_spot_prices_are_accepted(self):
        points = checker.normalize(FakeFrame())
        self.assertEqual(points, [
            {"date": "2026-10-29", "spot": 10000.0, "sourceUrl": checker.SOURCE_URL},
            {"date": "2026-10-31", "spot": 10050.0, "sourceUrl": checker.SOURCE_URL},
        ])

    def test_empty_or_missing_frame_produces_no_observations(self):
        self.assertEqual(checker.normalize(None), [])
        class EmptyFrame:
            empty = True
        self.assertEqual(checker.normalize(EmptyFrame()), [])


if __name__ == "__main__":
    unittest.main()
