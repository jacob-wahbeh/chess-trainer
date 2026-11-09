"""Side-by-side metrics for two windows of games: your peak vs. your most recent games."""

import io
from collections import Counter

import chess.pgn

from .engine import load_analysis
from .games import base_time_seconds, how_it_ended, outcome, user_color
from .stats import (
    LOSING, WINNING, clock_rates, date, game_accuracy, mean, peak_win, phase_rates, score, trough_win,
)

WINDOW = 200
# key, label, group, format, which direction is better (None = neutral)
METRICS = [
    ("rating", "Avg rating", "Context", "int", "up"),
    ("opponent", "Avg opponent rating", "Context", "int", None),
    ("score", "Score", "Context", "pct", "up"),
    ("per_day", "Games per active day", "Context", "one", None),
    ("accuracy", "Game accuracy", "Play", "pct1", "up"),
    ("blunders", "Blunders per game", "Play", "one", "down"),
    ("mistakes", "Mistakes per game", "Play", "one", "down"),
    ("converted", "Winning positions converted", "Play", "pct", "up"),
    ("saved", "Lost positions saved", "Play", "pct", "up"),
    ("clock_10", "Clock left after move 10", "Clock", "pct", None),
    ("clock_end", "Clock left at game end", "Clock", "pct", None),
    ("loss_timeout", "Losses on time", "Clock", "pct", "down"),
    ("loss_resigned", "Losses by resignation", "Endings", "pct", None),
    ("loss_checkmated", "Losses by checkmate", "Endings", "pct", None),
    ("loss_abandoned", "Losses abandoned", "Endings", "pct", "down"),
]


def clock_profile(game, user):
    """(share of base clock left after your 10th move, share left after your last move)."""
    base = base_time_seconds(game)
    if not base:
        return None, None
    pgn = chess.pgn.read_game(io.StringIO(game["pgn"]))
    is_white = user_color(game, user) == "white"
    mine = [n.clock() for n in pgn.mainline() if n.turn() != is_white and n.clock() is not None]
    if not mine:
        return None, None
    return (mine[9] / base if len(mine) >= 10 else None), mine[-1] / base


def window(games, user, data_dir, label):
    results = Counter(outcome(g, user) for g in games)
    losses = Counter(how_it_ended(g, user) for g in games if outcome(g, user) == "loss")
    n_losses = max(1, sum(losses.values()))
    clocks = [clock_profile(g, user) for g in games]
    ratings = [g[user_color(g, user)]["rating"] for g in games]

    metrics = {
        "rating": mean(ratings),
        "opponent": mean(g["black" if user_color(g, user) == "white" else "white"]["rating"] for g in games),
        "score": score(results),
        "per_day": len(games) / len({date(g["end_time"]) for g in games}),
        "clock_10": mean(100 * c[0] for c in clocks if c[0] is not None),
        "clock_end": mean(100 * c[1] for c in clocks if c[1] is not None),
        **{f"loss_{k}": 100 * losses[k] / n_losses for k in ("timeout", "resigned", "checkmated", "abandoned")},
    }

    analyzed = [(g, a) for g in games if (a := load_analysis(data_dir, user, g))]
    phase = clock = None
    # Engine metrics are only comparable when most of the window was analyzed.
    if len(analyzed) >= len(games) / 2:
        moves = [m for _, a in analyzed for m in a["moves"]]
        kinds = Counter(m["kind"] for m in moves)
        winning = [g for g, a in analyzed if peak_win(a) >= WINNING]
        losing = [g for g, a in analyzed if trough_win(a) <= LOSING]
        metrics.update({
            "accuracy": mean(game_accuracy(a["moves"]) for _, a in analyzed),
            "blunders": kinds["blunder"] / len(analyzed),
            "mistakes": kinds["mistake"] / len(analyzed),
            "converted": 100 * sum(outcome(g, user) == "win" for g in winning) / max(1, len(winning)),
            "saved": 100 * sum(outcome(g, user) != "loss" for g in losing) / max(1, len(losing)),
        })
        phase, clock = phase_rates(moves), clock_rates(moves)

    return {
        "label": label,
        "from": date(games[0]["end_time"]), "to": date(games[-1]["end_time"]),
        "n": len(games), "analyzed": len(analyzed),
        "rating_lo": min(ratings), "rating_hi": max(ratings),
        "metrics": {k: round(v, 2) for k, v in metrics.items() if v is not None},
        "phase": phase, "clock": clock,
    }


def peak_index(games, user):
    ratings = [g[user_color(g, user)]["rating"] for g in games]
    return max(range(len(ratings)), key=ratings.__getitem__)


def peak_window(games, user, size=WINDOW):
    """`size` games centered on the rating peak (centered so a hot streak alone doesn't define it)."""
    i = peak_index(games, user)
    start = max(0, min(i - size // 2, len(games) - size))
    return games[start:start + size]


def streak_into_peak(games, user, days=5):
    """Rating gained in the `days` before the peak, to show whether it was a spike."""
    i = peak_index(games, user)
    peak_ts = games[i]["end_time"]
    before = [g for g in games[:i] if g["end_time"] >= peak_ts - days * 86400]
    if not before:
        return None
    start = before[0][user_color(before[0], user)]["rating"]
    return {"gain": games[i][user_color(games[i], user)]["rating"] - start, "days": days, "games": len(before)}


def peak_vs_recent(games, user, data_dir, size=WINDOW):
    """Compare the peak window with the most recent games of one time class."""
    if len(games) < 2 * size:
        return None
    i = peak_index(games, user)
    if i >= len(games) - size:
        return None  # the peak is part of the recent games
    peak, recent = window(peak_window(games, user, size), user, data_dir, "Peak"), window(games[-size:], user, data_dir, "Now")
    top = games[i]
    return {
        "time_class": top["time_class"],
        "peak_rating": top[user_color(top, user)]["rating"],
        "peak_date": date(top["end_time"]),
        "streak": streak_into_peak(games, user),
        "metrics": [
            {"key": k, "label": label, "group": group, "format": fmt, "better": better}
            for k, label, group, fmt, better in METRICS
            if k in peak["metrics"] and k in recent["metrics"]
        ],
        "windows": [peak, recent],
    }
