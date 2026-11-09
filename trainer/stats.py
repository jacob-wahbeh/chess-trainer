"""Small shared calculations used by the report, comparisons and line deep-dives."""

from datetime import datetime, timezone

PHASES = ("opening", "middlegame", "endgame")
# (low, high] fraction of the starting clock left when the move was made.
# Increment can push the clock above its starting value, hence the open top.
CLOCK_BUCKETS = [
    (0.5, float("inf"), "> 50%"),
    (0.25, 0.5, "25–50%"),
    (0.10, 0.25, "10–25%"),
    (-1, 0.10, "< 10%"),
]
WINNING = 80  # win% at which a position counts as "winning"
LOSING = 20  # win% at or below which a position counts as "lost"


def date(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def pct(n, d):
    """Rounded half up, matching the report's JavaScript (Python's round() is half-even)."""
    return f"{int(100 * n / d + 0.5)}%" if d else "–"


def score(results):
    """Points percentage: win = 1, draw = 0.5."""
    total = sum(results.values())
    return 100 * (results["win"] + 0.5 * results["draw"]) / total if total else 0.0


def record(results):
    return {
        "games": sum(results.values()),
        "w": results["win"], "d": results["draw"], "l": results["loss"],
        "score": round(score(results), 1),
    }


def game_accuracy(moves):
    """Average of the arithmetic and harmonic mean of move accuracies.

    A simplified version of Lichess's game accuracy (which also weights moves by
    position volatility); the harmonic mean keeps a few blunders from being
    washed out by many easy moves.
    """
    accs = [max(1.0, m["accuracy"]) for m in moves]
    if not accs:
        return 100.0
    return (sum(accs) / len(accs) + len(accs) / sum(1 / a for a in accs)) / 2


def blunder_rate(moves):
    b = sum(m["kind"] == "blunder" for m in moves)
    return {"moves": len(moves), "blunders": b, "rate": round(100 * b / len(moves), 1) if moves else None}


def phase_rates(moves):
    return [{"name": p, **blunder_rate([m for m in moves if m["phase"] == p])} for p in PHASES]


def clock_rates(moves):
    timed = [m for m in moves if m["clock_fraction"] is not None]
    return [
        {"name": label, **blunder_rate([m for m in timed if low < m["clock_fraction"] <= high])}
        for low, high, label in CLOCK_BUCKETS
    ]


def peak_win(analysis):
    return max((m["win_before"] for m in analysis["moves"]), default=0)


def trough_win(analysis):
    return min((m["win_before"] for m in analysis["moves"]), default=100)
