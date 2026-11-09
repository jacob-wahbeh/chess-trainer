"""Loading cached games and small helpers for interpreting them."""

import calendar
import json

from .api import archive_dir

DRAW_RESULTS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
FAMILY_ENDINGS = {"Defense", "Opening", "Game", "Gambit", "Attack", "System"}


def load_games(user, data_dir):
    games = []
    for path in sorted(archive_dir(data_dir, user).glob("*.json")):
        games.extend(json.loads(path.read_text())["games"])
    games.sort(key=lambda g: g["end_time"])
    return games


def user_color(game, user):
    return "white" if game["white"]["username"].lower() == user.lower() else "black"


def opponent_color(color):
    return "black" if color == "white" else "white"


def outcome(game, user):
    """'win', 'draw' or 'loss' from the user's point of view."""
    result = game[user_color(game, user)]["result"]
    if result == "win":
        return "win"
    if result in DRAW_RESULTS:
        return "draw"
    return "loss"


def how_it_ended(game, user):
    """The result code of the losing side (or the draw reason), e.g. 'resigned', 'timeout'."""
    me = game[user_color(game, user)]["result"]
    them = game[opponent_color(user_color(game, user))]["result"]
    return them if me == "win" else me


def opening_name(game):
    """Opening name from the ECO URL with trailing move notation removed.

    'Sicilian-Defense-Old-Sicilian-Variation-3.d4-cxd4' -> 'Sicilian Defense Old Sicilian Variation'
    'London-System...4.e3-Bf5' -> 'London System'
    """
    slug = game.get("eco", "").rstrip("/").split("/")[-1]
    words = []
    for token in slug.split("-"):
        word = token.split("...")[0]
        if word and not word[0].isdigit():
            words.append(word)
        if not word or word != token or word[0].isdigit():
            break
    return " ".join(words) or "Unknown"


def opening_family(game):
    """Broad opening family, e.g. 'Sicilian Defense', 'Queens Pawn Opening'."""
    words = opening_name(game).split()
    for i, word in enumerate(words):
        if word in FAMILY_ENDINGS:
            return " ".join(words[: i + 1])
    return " ".join(words[:3]) or "Unknown"


def base_time_seconds(game):
    """Starting clock in seconds, or None for daily games."""
    tc = game.get("time_control", "")
    if "/" in tc or not tc:
        return None
    return int(tc.split("+")[0])


def month_start_ts(yyyy_mm):
    year, month = (int(p) for p in yyyy_mm.split("-"))
    return calendar.timegm((year, month, 1, 0, 0, 0))


def filter_games(games, time_classes=None, since=None, rules="chess"):
    since_ts = month_start_ts(since) if since else 0
    return [
        g for g in games
        if g.get("rules") == rules
        and g["end_time"] >= since_ts
        and (not time_classes or g.get("time_class") in time_classes)
    ]
