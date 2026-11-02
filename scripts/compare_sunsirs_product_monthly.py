#!/usr/bin/env python3
"""Compare monthly Sunsirs product history before and after a collection run."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"points": []}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-id", required=True)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    before = load(args.before)
    after_path = Path("data/sunsirs-chart-monthly") / f"{args.product_id}.json"
    after = load(after_path)
    old = {p["month"]: p for p in before.get("points", []) if p.get("month")}
    new = {p["month"]: p for p in after.get("points", []) if p.get("month")}
    rows = []
    for month in sorted(set(old) | set(new)):
        a, b = old.get(month, {}), new.get(month, {})
        av, bv = a.get("value"), b.get("value")
        delta = round(bv - av, 2) if isinstance(av, (int, float)) and isinstance(bv, (int, float)) else None
        rows.append({
            "month": month, "old_value": av, "old_status": a.get("status"),
            "new_value": bv, "new_status": b.get("status"), "delta": delta,
            "changed": a.get("status") != b.get("status") or av != bv,
        })
    report = {
        "product": args.product_id, "ppid": after.get("ppid"),
        "old_months": len(old), "new_months": len(new),
        "changed_months": sum(row["changed"] for row in rows),
        "estimated_months": sum(p.get("status") == "estimated" and p.get("value") is not None for p in new.values()),
        "no_data_months": sum(p.get("status") == "no_data" for p in new.values()),
        "unavailable_months": sum(p.get("status") == "unavailable" for p in new.values()),
        "refresh_errors": after.get("refreshErrors", []),
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
