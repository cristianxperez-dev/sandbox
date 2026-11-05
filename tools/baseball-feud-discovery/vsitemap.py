"""Inventory MLB.com video clips that MLB itself labels as High Home (or another isolated camera angle).

Source: MLB.com's weekly video sitemaps, listed in https://www.mlb.com/robots.txt
(https://www.mlb.com/sitemaps/weekly-video/index.xml.gz → one file per week). Each entry is a public MLB.com clip URL with
its video title / description where the sitemap gives them. Writes vids-angle.json: every clip whose URL slug or title
names a camera angle (high home, high first / third, centerfield, isolated, all-22, overhead, high angle …).
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(HERE, "cache", "vsm")
os.makedirs(C, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 cpbaseball-research"}
ANGLE = re.compile(r"high[- ]home|high[- ]angle|high[- ](first|third|1st|3rd)[- ]base|center[- ]?field[- ](camera|cam|angle|view)|isolated|all[- ]22|overhead|bird'?s[- ]eye|alternate[- ]angle|wide[- ]angle|high[- ]view", re.I)


def get(url, name):
    fp = os.path.join(C, name)
    if os.path.exists(fp):
        return open(fp, "rb").read()
    for i in range(3):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            open(fp, "wb").write(b)
            return b
        except Exception as e:  # noqa: BLE001
            err = e; time.sleep(2 + 2 * i)
    raise err


def unz(b):
    return gzip.decompress(b).decode("utf-8", "replace") if b[:2] == b"\x1f\x8b" else b.decode("utf-8", "replace")


def main():
    since = sys.argv[1] if len(sys.argv) > 1 else "2023"
    idx = unz(get("https://www.mlb.com/sitemaps/weekly-video/index.xml.gz", "index.xml.gz"))
    files = re.findall(r"<loc>([^<]+)</loc>", idx)
    files = [f for f in files if re.search(r"weekly-video-(\d{4})-", f) and re.search(r"weekly-video-(\d{4})-", f).group(1) >= since]
    print(len(files), "weekly files since", since, flush=True)
    hits, total, alltags = [], 0, {}
    for n, f in enumerate(files):
        try:
            x = unz(get(f, re.sub(r"[^\w.-]", "_", f.split("/sitemaps/")[-1])))
        except Exception as e:  # noqa: BLE001
            print("ERR", f, e); continue
        for u in re.findall(r"<url>([\s\S]*?)</url>", x):
            total += 1
            loc = (re.search(r"<loc>([^<]+)</loc>", u) or [None, ""])[1]
            title = (re.search(r"<video:title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</video:title>", u) or [None, ""])[1]
            desc = (re.search(r"<video:description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</video:description>", u) or [None, ""])[1]
            tags = re.findall(r"<video:tag>([^<]+)</video:tag>", u)
            date = (re.search(r"<(?:video:publication_date|lastmod)>([^<]+)<", u) or [None, ""])[1]
            if "/es/" in loc:
                continue
            for t in tags:
                alltags[t] = alltags.get(t, 0) + 1
            if ANGLE.search(loc) or ANGLE.search(title) or ANGLE.search(desc) or any(ANGLE.search(t) for t in tags):
                hits.append({"url": loc, "title": title.strip(), "description": desc.strip(), "date": date[:10], "tags": tags})
        if n % 25 == 0:
            print(n, len(files), "urls", total, "hits", len(hits), flush=True)
    json.dump({"files": len(files), "urls": total, "hits": hits, "tags": dict(sorted(alltags.items(), key=lambda kv: -kv[1])[:400])}, open(os.path.join(HERE, "vids-angle.json"), "w"), indent=1)
    print("DONE urls", total, "angle-labelled", len(hits))


if __name__ == "__main__":
    main()
