"""Per-game data for the report's interactive board: positions, moves and evals."""

import io

import chess
import chess.pgn

from .games import how_it_ended, opening_name, outcome, user_color
from .stats import WINNING, date


def viewer_game(game, analysis, user):
    """Every position of the game plus engine annotations on the user's moves.

    positions[i] is the board before ply i (positions[-1] is the final board);
    wins[i] is the user's win chance in positions[i].
    """
    pgn = chess.pgn.read_game(io.StringIO(game["pgn"]))
    board = pgn.board()
    by_fen = {m["fen"]: m for m in analysis["moves"]} if analysis else {}
    positions, plies = [board.board_fen()], []
    for node in pgn.mainline():
        a = by_fen.get(board.fen())
        ply = {"san": board.san(node.move), "uci": node.move.uci()}
        if a:
            best = board.parse_san(a["best"]) if a["best"] else None
            ply.update({
                "kind": a["kind"], "best": a["best"], "best_uci": best.uci() if best else None,
                "wb": a["win_before"], "wa": a["win_after"], "clock": a["clock"],
            })
        board.push(node.move)
        positions.append(board.board_fen())
        plies.append(ply)

    wins, last = [], 50.0
    for i in range(len(positions)):
        if i < len(plies) and "wb" in plies[i]:
            last = plies[i]["wb"]
        elif i > 0 and "wa" in plies[i - 1]:
            last = plies[i - 1]["wa"]
        wins.append(last)

    color = user_color(game, user)
    opponent = game["black" if color == "white" else "white"]
    return {
        "id": game["url"].rstrip("/").split("/")[-1],
        "url": game["url"],
        "date": date(game["end_time"]),
        "color": color,
        "opponent": opponent["username"],
        "opponent_rating": opponent["rating"],
        "rating": game[color]["rating"],
        "result": outcome(game, user),
        "ended": how_it_ended(game, user),
        "opening": opening_name(game),
        "white_first": pgn.board().turn == chess.WHITE,
        "positions": positions,
        "plies": plies,
        "wins": wins,
    }


def ply_index(game_data, fen_board, after=0):
    """Index of the first position matching a board FEN at or after `after`."""
    for i in range(after, len(game_data["positions"])):
        if game_data["positions"][i] == fen_board:
            return i
    return 0


def critical_ply(game_data):
    """The user's costliest move after first reaching a winning position."""
    reached, best_i, best_drop = False, 0, -1
    for i, p in enumerate(game_data["plies"]):
        if "wb" not in p:
            continue
        reached = reached or p["wb"] >= WINNING
        if reached and p["wb"] - p["wa"] > best_drop:
            best_i, best_drop = i, p["wb"] - p["wa"]
    return best_i


class ViewerGames:
    """Collects the games the report links into the board viewer, without duplicates."""

    def __init__(self, user, data_dir, load_analysis):
        self.user, self.data_dir, self.load_analysis = user, data_dir, load_analysis
        self.games = {}

    def add(self, game):
        gid = game["url"].rstrip("/").split("/")[-1]
        if gid not in self.games:
            self.games[gid] = viewer_game(game, self.load_analysis(self.data_dir, self.user, game), self.user)
        return self.games[gid]
