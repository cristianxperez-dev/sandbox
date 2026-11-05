"""One command for a bulk, incremental import: discover → curate → publish → re-verify.

    python3 pipeline.py --total 300 2025-05-01:2025-05-31 2025-07-04
    python3 pipeline.py --total 300            # no new dates: curate from games already scanned
    python3 pipeline.py --total 300 --bundle new.json   # import file for the app's review queue instead of publishing

Everything is incremental and safe to re-run:
- discover.py skips games already in work/records.jsonl; every source response is cached in cache/.
- curate.py keeps every published play, counts it toward its category, never re-picks a published event or a clip
  already in use, and caches each video check (work/video-checks.json) so an interrupted run resumes.
- publish.py never overwrites a published play (unless --refresh) and rewrites VALIDATION.md from all published data.
- If MLB.com throttles (509/503), curate stops with exit code 3; run the same command again later.

Spacing between live requests is MLBPLAYS_GAP seconds (default 0.35; use 1–2 for a large import).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "../../apps/play-repository"))


def run(*args) -> int:
    print("\n$ python3", " ".join(args), flush=True)
    return subprocess.call([sys.executable, *args], cwd=HERE)


def main(argv: list[str]) -> int:
    total = argv[argv.index("--total") + 1] if "--total" in argv else None
    bundle = argv[argv.index("--bundle") + 1] if "--bundle" in argv else None
    skip = {total, bundle}
    dates = [a for a in argv if re.match(r"^\d{4}-\d{2}-\d{2}(:\d{4}-\d{2}-\d{2})?$", a) and a not in skip]
    if dates and run("discover.py", *dates):
        return 1
    if run("curate.py", "--app", APP, *(["--total", total] if total else [])):
        print("curate stopped early — re-run this command to resume (checks are cached)")
        return 3
    if run("publish.py", APP, *(["--bundle", bundle] if bundle else [])):
        return 1
    if not bundle and run("verify_published.py", APP):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
