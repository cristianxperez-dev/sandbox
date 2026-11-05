"""Find MLB.com clips that MLB itself labels with a camera angle (High Home, alternate angles).

Same source and rules as tools/baseball-feud-discovery/vsitemap.py: MLB.com's weekly video sitemaps. A clip is
"high-home" only when MLB's own slug or title says High Home; other named angles ("Field View", "alternate angle",
"centerfield camera" …) keep MLB's own name and are never relabelled as High Home.
Usage: python3 angles.py 2024 2025 → work/angle-clips.json
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys

import mlb

# "high home" as a camera, never "a high home run" or "high home plate umpire"
HIGH_HOME = re.compile(r"\bhigh[- ]?home\b(?![- ]?(?:runs?|run's|plate|team|crowd|fans?|opener|stand|win))", re.I)
OTHER = re.compile(r"unique (?:angle|look)|different angle|another angle|new angle|high[- ]angle|high[- ](?:first|third|1st|3rd)[- ]base|center[- ]?field[- ](?:camera|cam|angle|view)|field[- ]view|isolated|all[- ]22|overhead|bird'?s[- ]eye|alternate[- ]angle|wide[- ]angle|high[- ]view|skycam|drone", re.I)
WORK = os.path.join(mlb.HERE, "work")


def unz(b: bytes) -> str:
    return gzip.decompress(b).decode("utf-8", "replace") if b[:2] == b"\x1f\x8b" else b.decode("utf-8", "replace")


def angle_of(text: str):
    if HIGH_HOME.search(text):
        return "high-home"
    m = OTHER.search(text)
    return m.group(0).lower() if m else None


def scan(years):
    _, idx = mlb.fetch("https://www.mlb.com/sitemaps/weekly-video/index.xml.gz")
    files = [f for f in re.findall(r"<loc>([^<]+)</loc>", unz(idx)) if any(f"weekly-video-{y}-" in f for y in years)]
    hits = []
    for n, f in enumerate(files):
        try:
            _, raw = mlb.fetch(f)
        except mlb.SourceError as e:
            print("skip", f, e); continue
        x = unz(raw)
        for u in re.findall(r"<url>([\s\S]*?)</url>", x):
            loc = (re.search(r"<loc>([^<]+)</loc>", u) or [None, ""])[1]
            if "/video/" not in loc or re.search(r"mlb\.com/(?:es|ja|ko)/", loc):
                continue
            title = (re.search(r"<video:title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</video:title>", u) or [None, ""])[1].strip()
            desc = (re.search(r"<video:description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</video:description>", u) or [None, ""])[1].strip()
            a = angle_of(loc + " " + title + " " + desc)
            if a:
                hits.append({"slug": loc.rstrip("/").split("/")[-1], "url": loc, "title": title, "description": desc, "angle": a,
                             "date": ((re.search(r"<video:publication_date>([^<]+)<", u) or [None, ""])[1])[:10]})
        print(f"{n + 1}/{len(files)} {f.split('/')[-1]} angle clips so far: {len(hits)}", flush=True)
    return hits


if __name__ == "__main__":
    args = sys.argv[1:]
    out_name = args[args.index("--out") + 1] if "--out" in args else "angle-clips.json"
    years = [a for a in args if a.isdigit()] or ["2025"]
    os.makedirs(WORK, exist_ok=True)
    hits = scan(years)
    json.dump(hits, open(os.path.join(WORK, out_name), "w"), indent=1)
    print("DONE", len(hits), "angle-labelled clips;", sum(h["angle"] == "high-home" for h in hits), "High Home")
