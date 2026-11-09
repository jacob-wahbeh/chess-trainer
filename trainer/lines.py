"""Deep dive into the opening lines you score worst in: where the games turn, and what to change."""

from collections import Counter, defaultdict

import chess

from .games import how_it_ended, opening_family, opening_name, outcome, user_color
from .stats import mean, record
from .viewer import ply_index

MIN_ANALYZED_SHARE = 0.6
TRAJECTORY_MOVES = range(4, 31, 2)
CLEARLY_WORSE = 35  # win% below which you're clearly worse
REPEATED_MIN = 3


def weakest_lines(games, user, min_games, limit):
    lines = defaultdict(list)
    for g in games:
        lines[(user_color(g, user), opening_name(g))].append(g)
    rows = [(key, gs) for key, gs in lines.items() if len(gs) >= min_games]
    rows.sort(key=lambda kv: record(Counter(outcome(g, user) for g in kv[1]))["score"])
    return rows[:limit]


def win_after_move(analysis, move_number):
    return next((m["win_after"] for m in analysis["moves"] if m["move_number"] >= move_number), None)


def costly_positions(analyzed, limit=2):
    """Positions you reached several times where your usual move wasn't the engine's choice."""
    seen = defaultdict(list)
    for g, a in analyzed:
        for m in a["moves"]:
            if m["move_number"] <= 15:
                seen[" ".join(m["fen"].split()[:4])].append((g, m))
    out = []
    for key, hits in seen.items():
        if len(hits) < REPEATED_MIN:
            continue
        played = Counter(m["san"] for _, m in hits)
        best = Counter(m["best"] for _, m in hits).most_common(1)[0][0]
        usual, usual_n = played.most_common(1)[0]
        drop = mean(m["drop"] for _, m in hits)
        if usual == best or drop < 2:
            continue
        g, m = max(hits, key=lambda gm: gm[1]["drop"])
        board = chess.Board(m["fen"])
        out.append({
            "move_number": m["move_number"], "seen": len(hits), "usual": usual, "usual_n": usual_n,
            "best": best, "avg_drop": round(drop, 1), "total_drop": drop * len(hits),
            "usual_uci": board.parse_san(usual).uci(), "best_uci": board.parse_san(best).uci(),
            "game": g, "fen": m["fen"],
        })
    out.sort(key=lambda p: -p["total_drop"])
    return out[:limit]


def problem_lines(games, user, data_dir, load_analysis, viewer, min_games=10, limit=3):
    """Weakest lines with enough engine coverage to say where they go wrong."""
    family_lines = defaultdict(lambda: defaultdict(Counter))
    for g in games:
        family_lines[(user_color(g, user), opening_family(g))][opening_name(g)][outcome(g, user)] += 1

    result = []
    for (color, name), gs in weakest_lines(games, user, min_games, limit * 3):
        analyzed = [(g, a) for g in gs if (a := load_analysis(data_dir, user, g))]
        if len(analyzed) < MIN_ANALYZED_SHARE * len(gs):
            continue
        losses = Counter(how_it_ended(g, user) for g in gs if outcome(g, user) == "loss")

        trajectory = []
        for mv in TRAJECTORY_MOVES:
            ws = [w for _, a in analyzed if (w := win_after_move(a, mv)) is not None]
            if len(ws) < 5:
                break
            trajectory.append({"move": mv, "win": round(mean(ws), 1), "worse": sum(w < CLEARLY_WORSE for w in ws), "n": len(ws)})

        first_error = Counter()
        for _, a in analyzed:
            m = next((m for m in a["moves"] if m["kind"] in ("blunder", "mistake")), None)
            if m:
                first_error["1–9" if m["move_number"] < 10 else "10–19" if m["move_number"] < 20 else "20–29" if m["move_number"] < 30 else "30+"] += 1

        positions = []
        for p in costly_positions(analyzed):
            vg = viewer.add(p["game"])
            positions.append({k: v for k, v in p.items() if k not in ("game", "total_drop")} | {
                "game_id": vg["id"], "ply": ply_index(vg, p["fen"].split()[0]),
            })

        family = opening_family(gs[0])
        siblings = [
            {"name": line, **record(r)}
            for line, r in family_lines[(color, family)].items()
            if line != name and sum(r.values()) >= min_games and record(r)["score"] >= 55
        ]
        siblings.sort(key=lambda s: -s["score"])

        result.append({
            "color": color, "name": name, "family": family,
            **record(Counter(outcome(g, user) for g in gs)),
            "analyzed": len(analyzed),
            "loss_timeout": round(100 * losses["timeout"] / max(1, sum(losses.values()))),
            "trajectory": trajectory,
            "first_error": [[k, first_error[k]] for k in ("1–9", "10–19", "20–29", "30+")],
            "positions": positions,
            "siblings": siblings[:3],
        })
        if len(result) == limit:
            break
    return result
