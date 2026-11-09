"""Stockfish analysis of the user's moves.

Each position is evaluated once; a move's quality is the drop in the mover's
winning chances between the position before and after it. Thresholds and the
accuracy formula follow Lichess:
https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala
"""

import io
import json
import math
import os
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import chess
import chess.engine
import chess.pgn

from .games import base_time_seconds, user_color

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PIECE_VALUES = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
# Thresholds on the mover's win-chance drop, in percentage points (0-100 scale).
BLUNDER, MISTAKE, INACCURACY = 15, 10, 5


def find_stockfish():
    candidates = [os.environ.get("STOCKFISH"), str(PROJECT_ROOT / "engine" / "stockfish"), shutil.which("stockfish")]
    for path in candidates:
        if path and Path(path).is_file():
            return path
    raise SystemExit("Stockfish not found: put it at engine/stockfish or set $STOCKFISH")


def win_percent(cp):
    cp = max(-1000, min(1000, cp))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(win_before, win_after):
    if win_after >= win_before:
        return 100.0
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * (win_before - win_after)) - 3.1669))


def classify(drop):
    if drop >= BLUNDER:
        return "blunder"
    if drop >= MISTAKE:
        return "mistake"
    if drop >= INACCURACY:
        return "inaccuracy"
    return None


def phase(board):
    material = sum(
        len(board.pieces(piece, color)) * value
        for piece, value in PIECE_VALUES.items()
        for color in chess.COLORS
    )
    if material <= 26:
        return "endgame"
    if board.fullmove_number <= 12:
        return "opening"
    return "middlegame"


def white_cp(info):
    return info["score"].white().score(mate_score=100000)


def game_id(game):
    return game["url"].rstrip("/").split("/")[-1]


def analyze_game(engine, game, user, depth):
    pgn = chess.pgn.read_game(io.StringIO(game["pgn"]))
    board = pgn.board()
    me = chess.WHITE if user_color(game, user) == "white" else chess.BLACK
    base = base_time_seconds(game)
    limit = chess.engine.Limit(depth=depth)

    info = engine.analyse(board, limit)
    cp_before, best = white_cp(info), info.get("pv", [None])[0]
    moves = []
    for node in pgn.mainline():
        move, mover = node.move, board.turn
        ply_phase, fen_before, number = phase(board), board.fen(), board.fullmove_number
        san, best_san = board.san(move), (board.san(best) if best else None)
        board.push(move)

        if board.is_checkmate():
            cp_after, next_best = (100000 if mover == chess.WHITE else -100000), None
        elif board.is_game_over():
            cp_after, next_best = 0, None
        else:
            info = engine.analyse(board, limit)
            cp_after, next_best = white_cp(info), info.get("pv", [None])[0]

        if mover == me:
            sign = 1 if me == chess.WHITE else -1
            win_before, win_after = win_percent(sign * cp_before), win_percent(sign * cp_after)
            drop = win_before - win_after
            clock = node.clock()
            moves.append({
                "move_number": number,
                "san": san,
                "best": best_san,
                "fen": fen_before,
                "phase": ply_phase,
                "cp_before": sign * cp_before,
                "cp_after": sign * cp_after,
                "win_before": round(win_before, 1),
                "win_after": round(win_after, 1),
                "drop": round(drop, 1),
                "accuracy": round(move_accuracy(win_before, win_after), 1),
                "kind": classify(drop) if move != best else None,
                "clock": clock,
                "clock_fraction": round(clock / base, 3) if clock is not None and base else None,
            })
        cp_before, best = cp_after, next_best

    return {"id": game_id(game), "url": game["url"], "depth": depth, "moves": moves}


def analysis_dir(data_dir, user):
    return Path(data_dir) / user.lower() / "analysis"


def load_analysis(data_dir, user, game):
    path = analysis_dir(data_dir, user) / f"{game_id(game)}.json"
    return json.loads(path.read_text()) if path.exists() else None


def analyze_games(games, user, data_dir, depth, workers=None):
    out = analysis_dir(data_dir, user)
    out.mkdir(parents=True, exist_ok=True)
    todo = [g for g in games if (load_analysis(data_dir, user, g) or {}).get("depth", 0) < depth]
    print(f"{len(games) - len(todo)} of {len(games)} games already analyzed at depth >= {depth}")
    if not todo:
        return

    stockfish = find_stockfish()
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    engines = [chess.engine.SimpleEngine.popen_uci(stockfish) for _ in range(workers)]
    for engine in engines:
        engine.configure({"Threads": 1, "Hash": 64})
    free = list(engines)

    def run(game):
        engine = free.pop()
        try:
            result = analyze_game(engine, game, user, depth)
        finally:
            free.append(engine)
        (out / f"{result['id']}.json").write_text(json.dumps(result))
        return game

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(run, g) for g in todo]
            for done, future in enumerate(as_completed(futures), 1):
                game = future.result()
                print(f"  [{done}/{len(todo)}] {game['url']}")
    finally:
        for engine in engines:
            engine.quit()
