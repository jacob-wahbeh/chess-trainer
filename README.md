# chess-trainer

Download your Chess.com games, analyze them with Stockfish, and get a
single-file HTML review: what to work on, where and when you blunder, thrown
wins, your peak vs. now, a deep dive into your weakest opening lines, and an
interactive board to replay the games and solve your own blunders as puzzles.

Games come from the public [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)
(no login needed). The API doesn't expose move-by-move analysis, so moves are
evaluated locally with Stockfish using Lichess-style win-chance thresholds.

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# Stockfish: put the binary at engine/stockfish, set $STOCKFISH, or have it on $PATH.
# https://github.com/official-stockfish/Stockfish/releases
```

## Usage

```sh
.venv/bin/python -m trainer fetch                                    # download / update all archives
.venv/bin/python -m trainer analyze --time-class blitz --last 200 --peak --weak-lines 5
.venv/bin/python -m trainer report --time-class blitz                # writes reports/report.html
```

- `--user` defaults to `draco_jaco`.
- `--since YYYY-MM` limits `analyze`/`report` to recent games (default: one year ago).
- `--time-class` is repeatable (`bullet`, `blitz`, `rapid`, `daily`); default is all.
- `analyze --peak` also analyzes the 200 games around your rating peak (for "Peak vs. now");
  `--weak-lines N` analyzes every game in your N weakest opening lines (for the line deep dives).
- `analyze --depth` (default 16) and `--workers` (default CPUs - 1) trade speed for accuracy.

Everything is cached under `data/<user>/`: past months are downloaded once and
games are only re-analyzed if you ask for a greater depth.
