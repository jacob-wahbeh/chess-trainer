"""Download a player's game archives from the Chess.com Published-Data API.

Docs: https://www.chess.com/news/view/published-data-api
Requests are made serially (parallel requests can be rate limited) and every
month is cached on disk. A month is only re-downloaded if it was last fetched
before the month (plus the API's ~24h cache window) was over.
"""

import calendar
import gzip
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

import truststore

# Verify TLS against the OS certificate store; some Python builds ship without CA certs.
truststore.inject_into_ssl()

BASE = "https://api.chess.com/pub"
USER_AGENT = "chess-trainer/0.1 (personal game review script)"
CACHE_GRACE_SECONDS = 2 * 24 * 3600


def get_json(url, retries=5):
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"}
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError(f"giving up on {url}")


def month_end_ts(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return calendar.timegm((year, month, last_day, 23, 59, 59))


def archive_dir(data_dir, user):
    return Path(data_dir) / user.lower() / "archives"


def fetch_archives(user, data_dir):
    out = archive_dir(data_dir, user)
    out.mkdir(parents=True, exist_ok=True)
    months = get_json(f"{BASE}/player/{user.lower()}/games/archives")["archives"]

    downloaded = 0
    for url in months:
        year, month = (int(p) for p in url.rstrip("/").split("/")[-2:])
        path = out / f"{year:04d}-{month:02d}.json"
        if path.exists():
            fetched_at = json.loads(path.read_text()).get("fetched_at", 0)
            if fetched_at > month_end_ts(year, month) + CACHE_GRACE_SECONDS:
                continue
        games = get_json(url)["games"]
        path.write_text(json.dumps({"fetched_at": int(time.time()), "games": games}))
        downloaded += 1
        print(f"  {year:04d}-{month:02d}: {len(games)} games")

    print(f"{len(months)} months on record, {downloaded} downloaded, rest cached in {out}")
