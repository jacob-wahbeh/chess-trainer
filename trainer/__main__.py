"""chess-trainer: download your Chess.com games, analyze them with Stockfish, and write a review.

    python -m trainer fetch
    python -m trainer analyze --time-class blitz --last 200 --peak --weak-lines 5
    python -m trainer report --time-class blitz --since 2025-11
"""

import argparse
import time

from .api import fetch_archives
from .compare import peak_window
from .engine import analyze_games
from .games import filter_games, load_games
from .lines import weakest_lines
from .report import build_report

DEFAULT_USER = "draco_jaco"


def default_since():
    """First day of the month one year ago, as YYYY-MM."""
    t = time.gmtime()
    return f"{t.tm_year - 1:04d}-{t.tm_mon:02d}"


def main():
    parser = argparse.ArgumentParser(prog="trainer", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", default=DEFAULT_USER)
    parser.add_argument("--data-dir", default="data")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("fetch", help="download / update game archives from Chess.com")

    def add_filters(p):
        p.add_argument("--time-class", action="append", choices=["bullet", "blitz", "rapid", "daily"],
                       help="repeatable; default: all")
        p.add_argument("--since", default=default_since(), help="YYYY-MM (default: one year ago)")

    analyze = sub.add_parser("analyze", help="run Stockfish over recent games")
    add_filters(analyze)
    analyze.add_argument("--last", type=int, default=200, help="analyze the N most recent matching games")
    analyze.add_argument("--peak", action="store_true", help="also analyze the 200 games around each time class's rating peak")
    analyze.add_argument("--weak-lines", type=int, default=0, metavar="N", help="also analyze every game in your N weakest opening lines")
    analyze.add_argument("--min-games", type=int, default=10, help="min games for a line to count for --weak-lines")
    analyze.add_argument("--depth", type=int, default=16)
    analyze.add_argument("--workers", type=int, help="parallel engine processes (default: CPUs - 1)")

    report = sub.add_parser("report", help="write the HTML review report")
    add_filters(report)
    report.add_argument("--min-games", type=int, default=10, help="min games for an opening to be listed")
    report.add_argument("--out", default="reports/report.html")

    args = parser.parse_args()

    if args.command == "fetch":
        fetch_archives(args.user, args.data_dir)
        return

    games = filter_games(load_games(args.user, args.data_dir), args.time_class, args.since)
    filters = f"Filters: time class = {', '.join(args.time_class or ['all'])}, since {args.since}."
    if args.command == "analyze":
        selected = {g["url"]: g for g in games[-args.last:]}
        if args.peak:
            for time_class in {g["time_class"] for g in games}:
                selected.update((g["url"], g) for g in peak_window([g for g in games if g["time_class"] == time_class], args.user))
        for _, line_games in weakest_lines(games, args.user, args.min_games, args.weak_lines):
            selected.update((g["url"], g) for g in line_games)
        analyze_games(sorted(selected.values(), key=lambda g: g["end_time"]), args.user, args.data_dir, args.depth, args.workers)
    elif args.command == "report":
        build_report(games, args.user, args.data_dir, args.out, args.min_games, filters=filters)


if __name__ == "__main__":
    main()
