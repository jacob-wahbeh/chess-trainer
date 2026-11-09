"""Build a self-contained HTML review report from cached games and engine analysis.

Python computes every number; `report_template.html` draws the charts and the
interactive board from the JSON blob injected into it, so the report is a
single file that opens offline.
"""

import json
import time
from collections import Counter, defaultdict
from pathlib import Path

import chess
import chess.svg

from .compare import peak_vs_recent
from .engine import load_analysis
from .games import how_it_ended, opening_family, opening_name, outcome, user_color
from .lines import problem_lines
from .stats import (
    WINNING, clock_rates, date, game_accuracy, pct, peak_win, phase_rates, record,
)
from .viewer import ViewerGames, critical_ply, ply_index

TEMPLATE = Path(__file__).with_name("report_template.html")


def lichess_link(fen):
    return f"https://lichess.org/analysis/standard/{fen.replace(' ', '_')}"


def piece_defs():
    """python-chess's piece artwork, referenced by the board as <use href="#white-knight">."""
    return "".join(chess.svg.PIECES.values())


def results_data(games, user):
    by_class = defaultdict(list)
    for g in games:
        by_class[g["time_class"]].append(g)

    classes, rating_series = [], {}
    for time_class, gs in sorted(by_class.items(), key=lambda kv: -len(kv[1])):
        ratings = [g[user_color(g, user)]["rating"] for g in gs]
        classes.append({
            "name": time_class,
            **record(Counter(outcome(g, user) for g in gs)),
            "start": ratings[0], "now": ratings[-1], "peak": max(ratings),
        })
        daily = {}
        for g, r in zip(gs, ratings):
            daily[date(g["end_time"])] = r  # last rating of each day
        rating_series[time_class] = [[d, r] for d, r in daily.items()]

    endings = {
        label: Counter(how_it_ended(g, user) for g in games if outcome(g, user) == label).most_common()
        for label in ("loss", "win")
    }
    return {"classes": classes, "rating_series": rating_series, "endings": endings}


def openings_data(games, user, min_games):
    families = {}
    for color in ("white", "black"):
        counts = defaultdict(Counter)
        for g in games:
            if user_color(g, user) == color:
                counts[opening_family(g)][outcome(g, user)] += 1
        rows = [{"name": name, **record(r)} for name, r in counts.items() if sum(r.values()) >= min_games]
        rows.sort(key=lambda r: -r["games"])
        families[color] = rows[:10]

    lines = defaultdict(Counter)
    for g in games:
        lines[(user_color(g, user), opening_name(g))][outcome(g, user)] += 1
    weakest = [
        {"color": color, "name": name, **record(r)}
        for (color, name), r in lines.items() if sum(r.values()) >= min_games
    ]
    weakest.sort(key=lambda r: r["score"])
    return {"families": families, "weakest_lines": weakest[:8]}


def engine_data(games, user, data_dir, viewer, top_blunders, recent):
    """Engine stats over the analyzed games among the most recent `recent`.

    Older analyzed games (peak window, weak lines) are deliberately left out so
    these numbers describe how you play now.
    """
    analyzed = [(g, a) for g in games[-recent:] if (a := load_analysis(data_dir, user, g))]
    if not analyzed:
        return None

    n = len(analyzed)
    all_moves = [m for _, a in analyzed for m in a["moves"]]
    kinds = Counter(m["kind"] for m in all_moves)
    accuracies = [game_accuracy(a["moves"]) for _, a in analyzed]
    by_result = defaultdict(list)
    for (g, _), acc in zip(analyzed, accuracies):
        by_result[outcome(g, user)].append(acc)

    thrown = [(g, peak_win(a)) for g, a in analyzed if peak_win(a) >= WINNING and outcome(g, user) != "win"]
    recent_thrown = []
    for g, peak in thrown[-10:][::-1]:
        vg = viewer.add(g)
        recent_thrown.append({
            "date": date(g["end_time"]), "result": outcome(g, user), "ended": how_it_ended(g, user),
            "peak": round(peak), "opponent": vg["opponent"], "game_id": vg["id"], "ply": critical_ply(vg),
        })

    blunders = [(g, m) for g, a in analyzed for m in a["moves"] if m["kind"] == "blunder"]
    blunders.sort(key=lambda gm: -gm[1]["drop"])
    top = []
    for g, m in blunders[:top_blunders]:
        vg = viewer.add(g)
        top.append({
            "game_id": vg["id"], "ply": ply_index(vg, m["fen"].split()[0]),
            "move": f"{m['move_number']}{'.' if vg['color'] == 'white' else '…'} {m['san']}",
            "best": m["best"], "win_before": round(m["win_before"]), "win_after": round(m["win_after"]),
            "phase": m["phase"], "clock": m["clock"], "date": date(g["end_time"]), "lichess": lichess_link(m["fen"]),
        })

    return {
        "n": n, "from": date(analyzed[0][0]["end_time"]), "to": date(analyzed[-1][0]["end_time"]),
        "accuracy": round(sum(accuracies) / n, 1),
        "per_game": {k: round(kinds[k] / n, 1) for k in ("blunder", "mistake", "inaccuracy")},
        "accuracy_by_result": {k: round(sum(v) / len(v), 1) for k, v in by_result.items()},
        "accuracy_trend": [[date(g["end_time"]), round(acc, 1)] for (g, _), acc in zip(analyzed, accuracies)],
        "phase": phase_rates(all_moves), "clock": clock_rates(all_moves),
        "thrown": {
            "count": len(thrown), "n": n,
            "by_ending": Counter(how_it_ended(g, user) for g, _ in thrown).most_common(),
            "recent": recent_thrown,
        },
        "blunders": top,
    }


def focus_areas(results, openings, engine, lines, min_games):
    """Rule-based priorities, most impactful first."""
    focus = []
    if engine:
        thrown = engine["thrown"]
        if thrown["count"] / thrown["n"] >= 0.15:
            on_time = dict(thrown["by_ending"]).get("timeout", 0)
            focus.append({
                "title": "Convert winning positions",
                "metric": pct(thrown["count"], thrown["n"]), "metric_label": "of games thrown",
                "finding": f"Winning (≥{WINNING}%) but didn't win in {thrown['count']} of {thrown['n']} games"
                           + (f"; {on_time} lost on time." if on_time else "."),
                "action": "When ahead, trade pieces, kill counterplay, and keep a clock buffer.",
                "link": "thrown",
            })
        worst = max(engine["phase"], key=lambda p: p["rate"] or 0)
        best = min(engine["phase"], key=lambda p: p["rate"] or 0)
        if best["rate"] and worst["rate"] >= 1.5 * best["rate"]:
            focus.append({
                "title": f"{worst['name'].capitalize()} tactics",
                "metric": f"{worst['rate']}", "metric_label": "blunders / 100 moves",
                "finding": f"{worst['rate'] / best['rate']:.1f}× your {best['name']} rate ({best['rate']}).",
                "action": "Daily tactics; before each move check their checks, captures and threats.",
                "link": "mistakes",
            })

    if lines:
        line = lines[0]
        first = max(line["first_error"], key=lambda kv: kv[1])[0]
        pos = next((p for ln in lines for p in ln["positions"]), None)
        action = f"Replay your losses from moves {first}, where these games turn."
        if pos:
            action += f" And: move {pos['move_number']}, play {pos['best']}, not {pos['usual']}."
        short = line["name"].replace(line["family"], "").strip() or line["name"]
        focus.append({
            "title": f"{line['family']}: {short} as {line['color']}",
            "metric": pct(line["score"], 100), "metric_label": f"over {line['games']} games",
            "finding": f"Your weakest {'lines' if len(lines) > 1 else 'line'}: "
                       + ", ".join(f"{pct(ln['score'], 100)} in {ln['name'].replace(ln['family'], '').strip()}" for ln in lines) + ".",
            "action": action,
            "link": "lines",
        })
    else:
        weak = [(c, r) for c, rows in openings["families"].items() for r in rows
                if r["games"] >= 2 * min_games and r["score"] < 45]
        if weak:
            color, row = max(weak, key=lambda cr: cr[1]["games"] * (50 - cr[1]["score"]))
            focus.append({
                "title": f"Repair the {row['name']} as {color}",
                "metric": pct(row["score"], 100), "metric_label": f"over {row['games']} games",
                "finding": "Your most costly opening family.",
                "action": "Learn the main line 6–8 moves deep; review losses to see where you leave it.",
                "link": "openings",
            })

    losses = dict(results["endings"]["loss"])
    total = sum(losses.values())
    if total and losses.get("timeout", 0) / total >= 0.25:
        focus.append({
            "title": "Clock management",
            "metric": pct(losses["timeout"], total), "metric_label": "of losses on time",
            "finding": f"{losses['timeout']} of {total} losses.",
            "action": "Play the opening from memory; under 30s, make safe, quick moves.",
            "link": "mistakes",
        })
    if total and losses.get("abandoned", 0) / total >= 0.08:
        focus.append({
            "title": "Stop abandoning games",
            "metric": pct(losses["abandoned"], total), "metric_label": "of losses abandoned",
            "finding": f"{losses['abandoned']} losses from leaving the game.",
            "action": "Resign or play on: opponents throw wins too.",
            "link": "results",
        })
    return focus


def build_report(games, user, data_dir, out_path, min_games=10, top_blunders=12, filters=""):
    if not games:
        raise SystemExit("No games match these filters. Run `python -m trainer fetch` first?")
    viewer = ViewerGames(user, data_dir, load_analysis)
    results = results_data(games, user)
    main_class = results["classes"][0]["name"]
    main_games = [g for g in games if g["time_class"] == main_class]

    openings = openings_data(games, user, min_games)
    engine = engine_data(main_games, user, data_dir, viewer, top_blunders, recent=200)
    lines = problem_lines(games, user, data_dir, load_analysis, viewer, min_games)
    data = {
        "user": user,
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "filters": filters,
        "n_games": len(games),
        "from": date(games[0]["end_time"]), "to": date(games[-1]["end_time"]),
        "main_class": main_class,
        "results": results,
        "openings": openings,
        "engine": engine,
        "peak": peak_vs_recent(main_games, user, data_dir),
        "lines": lines,
        "focus": focus_areas(results, openings, engine, lines, min_games),
        "games": viewer.games,
    }
    # "</" inside a <script> block would end it early.
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    html = (TEMPLATE.read_text()
            .replace("<!--PIECES-->", piece_defs())
            .replace("/*REPORT_DATA*/null", blob))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    print(f"Report written to {out_path} ({len(html) // 1024} KB, {len(viewer.games)} games in the board viewer)")
