import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import fetch_fundamentals as fetcher


class FundamentalsTests(unittest.TestCase):
    def test_empty_owner_response_keeps_previous_valid_owner(self):
        previous = {"owner": "省国资委", "ownerType": "province"}
        with patch.object(fetcher, "get_json", return_value={"sjkzr": []}):
            fresh = fetcher.fetch_owner("sh600000")
        merged = fetcher.merge_with_previous(fresh, previous, ("owner", "ownerType"))
        self.assertEqual(merged, previous)

    def test_empty_business_response_keeps_previous_valid_business(self):
        previous = {
            "mainItem": "化工产品",
            "mainRatio": 0.72,
            "mainBasis": "product",
            "mainDate": "2025-12-31",
        }
        with patch.object(fetcher, "get_json", return_value={"zygcfx": []}):
            fresh = fetcher.fetch_main_business("sh600000")
        merged = fetcher.merge_with_previous(
            fresh, previous, ("mainItem", "mainRatio", "mainBasis", "mainDate")
        )
        self.assertEqual(merged, previous)

    def test_fresh_non_null_fields_replace_old_values_but_nulls_do_not(self):
        previous = {"owner": "旧股东", "ownerType": "other"}
        fresh = {"owner": "新股东", "ownerType": None}
        merged = fetcher.merge_with_previous(fresh, previous, ("owner", "ownerType"))
        self.assertEqual(merged, {"owner": "新股东", "ownerType": "other"})

    def test_empty_new_data_does_not_invent_fields(self):
        self.assertEqual(fetcher.merge_with_previous({}, {}, ("owner", "ownerType")), {})


if __name__ == "__main__":
    unittest.main()
