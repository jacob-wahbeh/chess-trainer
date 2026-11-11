# Drill on iPhone: tap precision review and layout plan

The step-by-step plan for doing these fixes is in [fix-plan.md](fix-plan.md). The raw evidence is in `evidence.json`, and the before measurements are in `baseline-2026-11-10.json`. To re-measure, use `web/scripts/ux-probe/` (the `/tmp/ux-probe` paths below are where it writes its output).

Scope: the drill (`web/src/routes/drill/+page.svelte`) in the Home Screen app on a 393x852 CSS px iPhone (safe areas 59 top, 34 bottom), then the other screens. Priority order, from your note: tap-target size, spacing, how precise a tap must be, and what a wrong tap costs; thumb reach second.

Evidence used, and how to read the tags:

- **Live**: the app rendered in WebKit at 393x852 with the app's own safe-area variables set to 59/34, your games imported, one Petrov card (taught move 3.Nxe5, habit 3.Bc4). Data and screenshots are in `/tmp/ux-probe/`. Caveats: macOS WebKit at DPR 2, mouse input rather than touch, one card's copy.
- **Device**: your screenshots in `debug_photos/` (divide pixel values by 3 to get CSS px).
- **Code**: my reading of the working tree, including the uncommitted drill edits. Line numbers are current.

Claims about touch on the board come from reading chessground 9.2.1's source. Nobody has tested them on a touch device.

Unit conversion for this phone: 1 CSS px = 1 pt = 0.166 mm, so 44 px = 7.3 mm, 34 px = 5.6 mm, 30 px = 4.9 mm, and 1 px = 0.17 mm.

## Summary

- **Too many small targets.** The answered drill screen has 15 to 19 targets. In the Live run, 12 to 15 of them are under 44 px, and 11 or 12 are less than 8 px from a neighbour. The worst row is the move pills: 29.8 px tall, 1 px apart, between 34x34 arrows that are 2 px away, with Play 6 px from ›. Hitting the wrong one usually just moves you to a different move. That is cheap, but it happens all the time.
- **The two costliest wrong taps are elsewhere:**
  - A finger roll on the board becomes a graded wrong answer. It resets the streak and is saved immediately, with no undo (Code).
  - "Stop drilling this" is one stray tap away. It sits in a popover whose trigger is 8 px above Continue. The tap is permanent, with no undo (Live and Code).
- **The screen fits only by luck.**
  - "Correct" has 1.7 px to spare.
  - "Good move" overflows by 17 px and "Not quite" by 3 px.
  - After Show answer it overflows by 63 px, and the answer sentence sits under the sticky footer (Live).
  - Once the page scrolls, every small target moves. In the 5:02 PM Device shot the page is scrolled 68 px, with the board under the clock.
- **The plan: one fixed-height phone layout with three groups of large targets, separated by things you can't tap.**
  - Under the board, a nav row: ‹ and › at 60x48, Play at 80x48.
  - Then the line chips: 44 px tall, 8 px apart.
  - At the bottom, a two-button bar: 142x48 and 227x48. Each slot always does the same kind of job.
  - The move strip becomes plain, read-only text.
  - The colored box keeps its colors and says one thing: the verdict plus one short line, in a fixed 68 px.
  - Fixed content totals 838 px, leaving 14 px of slack on an 852 px screen. The board stays at 381 px.
- **Order of work.** Quick wins first:
  - a real drag threshold on the board;
  - skip the replay on any touch;
  - free 48 px of height, then grow the targets to 44 px;
  - fixed footer slots with a 400 ms double-tap guard;
  - an undoable "stop drilling".

  Then the bigger changes: the fixed layout, hold-to-repeat arrows, a Why panel that opens in place, and forgiveness for slips on the board.

## The worst problems, measured

Only confirmed issues are listed. The count for "Correct" (Live): 16 targets, 13 under 44 px, 11 with a gap under 8 px.

| # | Control | Where | Size (px) | Gap | How often | What a wrong tap costs |
|---|---|---|---|---|---|---|
| 1 | Board, when you drag to answer | `lib/ui/Board.svelte:86`; chessground `dist/state.js:45-46`, `dist/drag.js:45`, `:159-165` | Squares 47.3-47.6 | 0 between squares. If your last move was a drag, the next touch on a piece drags from the first pixel (`started: autoDistance && stats.dragged`). A tap-tap move commits the moment the second touch starts, so you can't slide off. (Code) | Every card | A roll across a square edge onto a legal square is a move. It is graded as a miss, sets the streak to 0 (`lib/drill/cards.ts:104-106`), and is saved at once (`+page.svelte:560-566`). No undo. |
| 2 | "Tap the board to skip" | `+page.svelte:892` (`onclick`); chessground `drag.js:23-25` | Looks like 381x381 | — | Every card. The replay is up to 8 plies, about 5.8 s at Normal speed. | Chessground cancels `touchstart` on or within one square of any piece, so no click fires. Only about 40% of the board responds in the start position, and touching a piece never skips. It fails silently. (Code) |
| 3 | Move pills `.mv` | `:940-962`; CSS `:1439-1460` | 29.8 tall x 25-65 wide (Live) | 1 between pills, 2 to ‹ ›. A half-clipped pill shows 3-26 px, 2 px from › (Live). | Occasional while answering, often in review | Jumps to the wrong move. While answering it also leaves the drill position, and the board then refuses moves without saying why (`dests`, `:367-369`). The only labelled way back is a 19.6 px text link (`:1007`). |
| 4 | ‹ › arrows | `:939`, `:965`; CSS `:1407-1411` | 34x34; the chevron itself is about 4.5x9 (Live) | 2 to pills; › is 6 from Play (Live) | Often, tapped repeatedly | Wrong step, or autoplay starts. When the answer lands, › also moves 86 px left and 46 px down: x 353→267, y 512→558 (Live). |
| 5 | Play | `:966-979`; CSS `:1414-1421` | 80x38 (Live) | 6 to › (Live) | Often | Autoplay starts instead of a single step. |
| 6 | Line chips (Reset + lines) | `:907-934`; CSS `:1321-1327`, `:1334-1342` | 36 tall x 83-111 (Live) | 5 (Live). The last chip is cut off with no fade. After a try, Reset scrolls out of view (Code). | Often | Previews the wrong line, which is cheap. But Reset (or ‹) is needed before every move you try on the board. |
| 7 | ⋯ → "I play X on purpose · stop drilling this" | `:1099-1106`, `skipForGood` `:698-703`; CSS `:1890-1918`; `lib/worker/data.worker.ts:362-363` | Trigger 33.8x28; item 254x40.6 (Live) | Trigger is 8 above Continue. The popover covers the result box and an outside tap doesn't close it (Live and Code). | Rare | The card is suspended for good and the next one loads. There is no confirm and no undo; the only way back is Settings → reset all drill progress. |
| 8 | Footer buttons change meaning | `:1092-1117` | Miss: Try again / Show answer, 185.5x44 each. Revealed: 106 / 106 / 148 x44 (Live) | 10 | Every miss | Continue (x 238.6-387) covers 80% of where Show answer was (x 201.5-387), at the same height (Live). A double tap on Show answer skips the answer you just asked for. |
| 9 | "show it" | `:1069-1073`; CSS `:1530-1537` | 45.8x20.3 inline link (Live) | Inside a sentence | Every "Good move" | It is the only way to reveal the move. When the page overflows, the sticky footer covers part of it. |
| 10 | Why sheet: head and step row | `:1146-1182`; CSS `:1949-1954`, `:1966-1972`, `:2004-2014` | Expand and Close 44x44; Next 44x44; Play 40x40 (Live) | Expand to Close 4; Next to Play 2 (Live). Expand sits 4 px above Next (Code). | Every visit to Why | Close loses your place; Expand covers the board; Play starts autoplay. |
| 11 | Page height | Phone CSS `:2119-2179`; `.foot` `:1855-1864` | Correct 850.3 of 852; Good move 869; Not quite 855; after Show answer 915 (Live) | — | Any answer with more than a line of text | The page scrolls and every target moves. The footer hides "The thematic move here is 3.Nxe5" (Live, after Show answer). In the 5:02 PM Device shot the page is scrolled about 68 px. |
| 12 | End session ✕ | `:843`; CSS `:2137-2140` | 36x36 (Live) | 24 to the board (Live) | Once per session | A miss does nothing. Low priority. |

## What the research and Chess.com / Lichess / learning apps show

**Size and spacing**

- **Apple**: targets 44x44 pt, 28 pt absolute minimum. Leave about 12 pt around controls with a visible shape and about 24 pt around icon-only or text-only ones. "Consider spacing between controls as important as size." ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility))
- **WCAG 2.2**: 24x24 px is the AA floor (2.5.8) and 44x44 px the AAA target (2.5.5). W3C notes that touch research supports sizes larger than the floor. ([2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html))
- **Google**: 48 dp targets, at least 8 dp apart. ([Android accessibility](https://support.google.com/accessibility/android/answer/7101858))

**How accurate thumbs are**

- **Hoober**: catching 95% of taps takes about 7 mm (42 pt) at the centre of the screen and about 12 mm (72 pt) at the corners. Keep at least 8 mm (48 pt) centre to centre between targets. Bars at the top or bottom of the screen should hold at most about 4 items on iOS. People shift grip constantly (49% one hand, 36% cradled, 15% two hands) and prefer tapping the middle of the screen. ([UXmatters 2017](https://www.uxmatters.com/mt/archives/2017/07/design-for-fingers-touch-and-people-part-3.php), [2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php))
- **Parhi et al. (2006)**: with one thumb, aim for 9.2 mm targets for single taps and 9.6 mm for repeated taps. ([PDF](http://www.cs.umd.edu/hcil/trs/2006-11/2006-11.pdf))
- **Bi, Li and Zhai (FFitts, 2013)**: in 2D tasks, error rates were about 25% for 4.8 mm targets and about 7% for 7.2 mm. Below about 8 mm, misses are built in, and users compensate by slowing down and aiming. ([Google Research](https://research.google/pubs/ffitts-law-modeling-finger-touch-with-fitts-law/))
- **Tappy model (an estimate, optimistic, no neighbours)**: per-tap success is 94.0% at 34 pt, 98.4% at 44 pt and 99.0% at 48 pt. Over 20 taps, the chance of at least one miss is 71%, 28% and 18%. ([arXiv 2403.03097](https://arxiv.org/abs/2403.03097))
- **Size versus gap**: once targets are about 10 mm, extra gap makes no measurable difference ([Colle & Hiszem 2004](https://pubmed.ncbi.nlm.nih.gov/15513716/), [Sesto 2012](https://pubmed.ncbi.nlm.nih.gov/22768644/)). So spend space on the hit area first.
- **People aim at what they can see**, even when the hit area is larger ([Usuba et al. 2019](https://research.lycorp.co.jp/en/publications/395)). Make the visible shape match the hit area.

**What wrong taps cost**

- Put consequential actions far from frequent ones ([NN/g 2021](https://www.nngroup.com/articles/proximity-consequential-options/)).
- Prefer undo to a warning dialog ([Raskin, "Never use a warning when you mean undo"](https://alistapart.com/article/neveruseawarning/)).

**Chess.com**

- **Game Review**: three small actions (Show, Best, Retry) and one big green Next, bottom right.
  - After a mistake, a red Retry fills exactly Next's rectangle.
  - Actions that don't apply are greyed out rather than removed, so nothing shifts.

  ([Help: Game Review](https://support.chess.com/en/articles/10328363-how-do-i-use-game-review-on-the-app))
- **Puzzle hint**: Chess.com added a delay of about 3 s to Hint because people hit it right after Next. Users said the real fault was that Hint appeared where Next had just been. ([forum](https://www.chess.com/forum/view/site-feedback/chess-com-please-get-rid-of-the-delay-before-the-first-hint-on-puzzles))
- **Dragging**: the app has no setting to turn dragging off. "It accomplishes nothing but forcing random misclicks" ([App Store review](https://itunes.apple.com/us/rss/customerreviews/page=1/id=329218549/sortby=mostrecent/json), Nov 7 2026).

**Lichess (open-source mobile app)**

- The bottom bar has 2 to 5 equal cells about 48 pt tall. Everything else goes in a menu.
- Hint and "View solution" stay disabled for 4 s after a puzzle loads.
- A wrong move is taken back automatically after 500 ms.
- Prev and Next repeat while held.
- The dragged piece is drawn twice as large, one square above the finger, with a circle two squares wide on the square it will land on.
- The move method can be set to Either, Tap or Drag.
- Issue #1577: fast Next taps hit the move list just above the bar. ([bottom_bar.dart](https://github.com/lichess-org/mobile/blob/fdfddfc72abffb69c7ede2158695d16fb058d843/lib/src/widgets/bottom_bar.dart), [puzzle_screen.dart](https://github.com/lichess-org/mobile/blob/fdfddfc72abffb69c7ede2158695d16fb058d843/lib/src/view/puzzle/puzzle_screen.dart), [board_preferences.dart](https://github.com/lichess-org/mobile/blob/fdfddfc72abffb69c7ede2158695d16fb058d843/lib/src/model/settings/board_preferences.dart), [#1577](https://github.com/lichess-org/mobile/issues/1577))

**Learning apps**

- **Duolingo**: one full-width primary button at the bottom. Check becomes Continue in the same place, with the feedback above it. (Medium confidence: from an open-source replica and design write-ups, [react-duolingo](https://github.com/bryanjenningz/react-duolingo/blob/2d0fdbca433f36a0e54f56f3cde58ce1080790ba/src/pages/lesson.tsx#L340-L429).)
- **AnkiMobile**: "Double Tap Prevention" ignores a fast second tap, so you can't reveal or advance by accident. ([docs](https://docs.ankiweb.net/ankimobile/preferences.md))

## The recommended drill layout

### Rules

1. **Size and spacing.** Every frequent target is at least 44x44, both visibly and as a hit area, with at least 8 px to any other target. Groups of targets are 12 px or more apart.
2. **Three groups of targets, separated by things you can't tap:** the board, then the nav row, then the chips, then 138 px of note and result box, then the bar.
3. **Nothing moves under the finger.**
   - The nav row sits directly under the board in every phase.
   - Play's slot and the chips row are reserved while you answer.
   - Rows don't re-centre themselves, and the page never scrolls.
4. **Bar slots keep their meaning.**
   - Right slot, the forward action: Skip, Back to the position, Try again, or Continue.
   - Left slot, the secondary action: Show answer, Show it, Why?, or Hide.
   - After a bar tap changes the bar, it ignores taps for 400 ms.
5. **Rare and costly actions sit far from frequent ones.** End session is at top left and "stop drilling" at top right. Both have 44x44 hit areas, about 660 px from Continue, and "stop drilling" gets an undo.
6. **Text never pushes controls around.** The note (2 lines) and the box (68 px) have fixed heights and clamp their text. Everything else goes in Why.

### Wireframes

1 character is about 8 CSS px of width. Heights are not to scale; the y values are CSS px from the top of the screen.

**Correct (taught move), full screen**

```
   0 +-------------------------------------------------+
     |  status bar, Dynamic Island                     |  safe area 59
  63 |[X]  2 in a row - 1 more            10/232    [.]|  top bar 36; X and [.] hit areas 44x44 (rare actions)
 105 |=================------------------------- +0.3  |  eval bar 14 (not a target)
 123 |+-----------------------------------------------+|
     ||                                               ||
     ||               board 381 x 381                 ||  unchanged: full width, squares 47.6
     ||                                               ||
 504 |+-----------------------------------------------+|
 516 |+------+                     +------+ +---------+|  nav row 48: < > 60x48, Play 80x48, gaps 8
     ||  <   | 3.Nxe5 Nxe4 4.Qe2   |  >   | | > Play  ||  strip = read-only text, not buttons
     |+------+                     +------+ +---------+|
 572 |(@ Position) (v Nxe5 +0.3) (x Bc4 -0.5)          |  chips 44 tall, 8 apart; Position fixed, others scroll
 624 |o e5 is attacked once and not defended at all.   |  note: 2 lines max, clamped (40)
     |                                                 |
 672 |+-----------------------------------------------+|  result box 68, green
     || (v) Correct  Nxe5                     +0.31   ||
     || The thematic move: masters play it 100%.      ||
 740 |+-----------------------------------------------+|
     |                                                 |  slack 14 (flex)
 762 |+----------------+ +----------------------------+|  bar: 142x48 | 12 | 227x48
     ||      Why?      | |          Continue          ||
 810 |+----------------+ +----------------------------+|
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

**Ask, including the replay ("intro")**

```
   0 +-------------------------------------------------+
     |  status bar, Dynamic Island                     |  safe area 59
  63 |[X]  ================---------      1/232        |  top bar; [.] slot reserved, empty while answering
 105 |=========================================        |  eval bar, dimmed until you answer
 123 |+-----------------------------------------------+|
     ||                                               ||
     ||               board 381 x 381                 ||  any touch here skips the replay / returns from browsing
     ||                                               ||
 504 |+-----------------------------------------------+|
 516 |+------+                     +------+            |  nav row 48; Play's slot reserved, so > never moves
     ||  <   | .. 2.Nf3 Nf6 3.?    |  >   |            |  strip = read-only text
     |+------+                     +------+            |
 572 |                                                 |  (chips row, reserved; filled after answering)
 624 |Your move - new - reached 22x                    |  prompt (not a target)
     |Petrov's Defense - as White                      |
     |                                                 |
     |                                                 |
     |                                                 |
 762 |                   +----------------------------+|  right slot: Skip during the replay,
     |                   |            Skip            ||  "Back to the position" while browsing back,
 810 |                   +----------------------------+|  empty otherwise (the board is the input)
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

**Good move (a sound move that isn't the taught one), while you look for the taught move**

```
     |... top bar, board, nav row as in Correct ...    |
 572 |(@ Position) (o d4 +0.2) (x Bc4 -0.5)            |  chips 44 tall, 8 apart; Position fixed, others scroll
 624 |Your move is also good: level (+0.22), close     |  note: 2 lines max, clamped (40)
     |to the best move (+0.31).                        |
 672 |+-----------------------------------------------+|  result box 68, blue
     || (v) Good move  d4                      +0.22  ||
     || Masters play another move. Find it.           ||
 740 |+-----------------------------------------------+|
     |                                                 |
 762 |+----------------+ +----------------------------+|  board shows the drill position and accepts moves,
     ||    Show it     | |          Continue          ||  so "find it" needs no extra tap
 810 |+----------------+ +----------------------------+|
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

Once you find it or show it, the box's second line changes, the green chip is added *at the end* so nothing shifts, and the bar becomes [Why?] [Continue].

**Not quite**

```
     |... top bar, board, nav row as in Correct ...    |
 572 |(@ Position) (x Bc4 -0.5)                        |  chips 44 tall, 8 apart; Position fixed, others scroll
 624 |Your habit - 5x in your games                    |  note: 2 lines max, clamped (40)
     |                                                 |
 672 |+-----------------------------------------------+|  result box 68, red
     || (x) Not quite  Bc4                     -0.50  ||
     || +0.31 -> -0.50. Red arrow: Black's reply.     ||
 740 |+-----------------------------------------------+|
     |                                                 |
 762 |+----------------+ +----------------------------+|  Try again takes Continue's slot (Chess.com's
     ||  Show answer   | |         Try again          ||  Retry-in-Next's-rectangle pattern)
 810 |+----------------+ +----------------------------+|
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

**After Show answer**

```
     |... top bar, board, nav row as in Correct ...    |
 572 |(@ Position) (x Bc4 -0.5) (v Nxe5 +0.3)          |  answer chip appended: nothing shifts
 624 |o e5 is attacked once and not defended at all.   |  note: 2 lines max, clamped (40)
     |                                                 |
 672 |+-----------------------------------------------+|  result box 68, red
     || (x) Not quite  Bc4                     -0.50  ||
     || The answer: 3.Nxe5, the green arrow.          ||
 740 |+-----------------------------------------------+|
     |                                                 |
 762 |+----------------+ +----------------------------+|  same slots as Correct; a double tap on
     ||      Why?      | |          Continue          ||  Show answer lands on Why? (harmless),
 810 |+----------------+ +----------------------------+|  and the 400 ms guard blocks it anyway
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

**Why panel (opens in place)**

```
 504 |board bottom (unchanged, stays visible)          |
 516 |+------+                     +------+ +---------+|  nav row stays live: step through the line
     ||  <   | 3.Nxe5 Nxe4 4.Qe2   |  >   | | > Play  ||
     |+------+                     +------+ +---------+|
 572 |(@ Position) (v Nxe5 +0.3) (x Bc4 -0.5)          |  chips stay live: pick the line to read about
 624 |+-----------------------------------------------+|  panel top = chips bottom + 8
     ||                    ======                     ||  grabber: tap or drag up = full height; drag down = close
     || 3.Nxe5 - 1/5  e5 is attacked once and not..   ||  step line (was the sheet's step row)
     || Against the Petrov, take e5 with 3.Nxe5;      ||  body scrolls: 114 px = 5 lines at 15/21.75
     || 3.Bc4 hangs e4                                ||
     || 3.Nxe5 is the main line. Black can't ...      ||
 754 |+-----------------------------------------------+|
 762 |+----------------+ +----------------------------+|  bar unchanged: Why? now reads Hide;
     ||      Hide      | |          Continue          ||  Continue stays where it was
 810 |+----------------+ +----------------------------+|
 818 |              (home indicator 34)                |
 852 +-------------------------------------------------+
```

The panel is not modal: the board, nav row and chips keep working. That removes:

- the invisible full-screen backdrop that turned the board into a Close button (`:1131`);
- the duplicate chips;
- the Expand/Close/Next/Play cluster (`:1146-1182`).

Expanded, the panel's top moves to 67 (59 + 8), giving 671 px of reading space. The bar stays put.

### Height budget (tallest state)

Every answered state uses the same fixed zones, so they all have the same height.

| y from | y to | Zone | px | Notes |
|---|---|---|---|---|
| 0 | 63 | Safe area + padding | 63 | 59 + 4 (`+layout.svelte:217`) |
| 63 | 99 | Top bar | 36 | ✕ and ⋯ get 44x44 hit areas via `margin: -4px` |
| 99 | 123 | Gap, eval bar, gap | 24 | 6 + 14 + 4 |
| 123 | 504 | Board | 381 | Unchanged |
| 504 | 516 | Gap | 12 | Was 8; a high tap on ‹ lands 36 px from its centre before reaching the board |
| 516 | 564 | Nav row | 48 | ‹ 60, strip 157, › 60, Play 80, three gaps of 8 = 381 |
| 564 | 572 | Gap | 8 | |
| 572 | 616 | Chips | 44 | Position about 106 (fixed) + 8 + 267-px scroller |
| 616 | 624 | Gap | 8 | |
| 624 | 664 | Note | 40 | 2 lines x 14 px x 1.4 = 39.2, clamped |
| 664 | 672 | Gap | 8 | |
| 672 | 740 | Result box | 68 | 1 + 10 + 22.1 (17 px x 1.3) + 2 + 20.3 (14 px x 1.45) + 10 + 1 = 66.4 |
| 740 | 754 | Slack (flex) | 14 | Absorbs other devices' insets |
| 754 | 852 | Bar | 98 | 8 + 48 buttons (y 762-810) + 8 + 34 safe area |
| | | **Total** | **852** | 838 fixed + 14 slack. Today: 850.3 to 915.2 |

Bar widths: 142 + 12 + 227 = 381. Set them explicitly (`flex: 0 0 142px` and `flex: 1`). With the current `flex: 1` / `flex: 1.6` and 18 px side padding, flexbox floors each button at its 36 px of padding before sharing out the space. That gives 106/106/148 or 151/220, which is exactly what Live measured.

### Targets after the change ("Correct")

11 targets instead of 16. None is under 44 px, and the smallest gap is 8 px.

| Target | Size | Position (x, y) | Nearest target, gap |
|---|---|---|---|
| End session ✕ | 44x44 hit (36 drawn) | 2-46, 59-103 | Board, 20 below (the eval bar in between can't be tapped) |
| More ⋯ (stop drilling) | 44x44 hit | 347-391, 59-103 | Board, 20 below |
| Board squares | 47.6 | 6-387, 123-504 | Nav row, 12 |
| ‹ | 60x48 | 6-66, 516-564 | Chips, 8 below |
| › | 60x48 | 239-299, 516-564 | Play, 8 |
| Play | 80x48 | 307-387, 516-564 | ›, 8 |
| Position chip | about 106x44 | 6-112, 572-616 | First line chip, 8 |
| Line chips | 72-111 x 44 | 572-616 | Each other, 8 |
| Why? / Show it / Show answer / Hide | 142x48 | 6-148, 762-810 | Right button, 12 |
| Continue / Try again / Skip / Back | 227x48 | 160-387, 762-810 | Left button, 12. The nearest target above is a chip 146 px up. Today Continue is at 167-387 x 760-804, so muscle memory carries over. |

### What each slot shows, by state

| State | Nav row | Chips | Note | Box | Bar left | Bar right |
|---|---|---|---|---|---|---|
| Replay | ‹ › (stop the replay) | Reserved | "Here's the position…" + opening | — | — | Skip |
| Ask | ‹ › | Reserved | Your move · status · reached N× | — | — | "Back to the position" only while browsing back |
| Checking | ‹ › | Reserved | Checking… | — | — | — |
| Correct | ‹ › Play | Position, played ✓, habit ✕, tries | Step note or line summary | Green: verdict + 1 line | Why? | Continue |
| Good move, looking | ‹ › Play | Position, played ●, habit ✕ | Summary | Blue: "Find it." | Show it | Continue |
| Good move, found or shown | ‹ › Play | … + ✓ taught move, appended | Step note | Blue: "You found it: 3.Nxe5…" | Why? | Continue |
| Not quite | ‹ › Play | Position, played ✕ | Caption | Red: eval change | Show answer | Try again |
| After Show answer | ‹ › Play | … + ✓ taught move, appended | Step note | Red: "The answer: 3.Nxe5…" | Why? | Continue |
| Why open | ‹ › Play (live) | Live | Under the panel | Under the panel | Hide | Continue |

The box's first line is the verdict: icon, word, move and eval, moved down from the top bar. It is 17 px, in the box's color. The second line is one short fact of at most about 50 characters (14 px fits about 55 across 351 px). Examples:

- "It punishes 7…Qf6: +0.16 → +1.79." This replaces the 2-line sentence in IMG_1390.
- "Your habit (5×): +0.31 → −0.50."

After answering, the top bar's progress track is replaced by the streak, for example "2 in a row · 1 more" or "Back to 0 · comes back soon". Today the streak gets its own 28 px row in the footer.

## Quick wins, in implementation order

Effort: S = under an hour, M = a few hours, L = a day or more. Do QW3 before QW4: it frees the height that QW4 uses.

1. **Board drags need real movement every time (S).** At `lib/ui/Board.svelte:86`:
   ```js
   draggable: { enabled: !!dests, distance: 10, autoDistance: false },
   ```
   With chessground's default `autoDistance`, the next drag after a drag move starts from the first pixel (`dist/drag.js:45`). With this change, a tap that rolls less than 10 px (1.7 mm) stays a tap, and a deliberate drag (one square is 47 px) won't notice.
2. **Any touch on the board skips the replay (S).** At `+page.svelte:892`, use `onpointerdown` instead of `onclick`, and also return from browsing:
   `onpointerdown={() => (phase === 'intro' ? finishIntro() : phase === 'ask' && cursor < end && goTo(end))}`.
   A cancelled `touchstart` can't suppress `pointerdown`. Verify on device. Optionally, call `flushSync()` afterwards so the same touch can also pick up a piece (verify).
3. **Free 48 px before anything grows (S).**
   - Remove the footer's `.foot-row` (`:1098-1106`). Move the streak into the top bar, where `.status` shows today (`:845-852`), and move ⋯ per QW7. Saves 28 + 8 px.
   - On phones, change `.stage` gap 16 → 8 (`:1298`) and `.panel` gap 12 → 8 (`:1591`).
   - Clamp the text: `.note { height: 42px; overflow: hidden }` (`:1510-1519`), and `.verdict p` to 2 lines (`-webkit-line-clamp`). After a reveal, show only the answer line.
   - Math: 850.3 − 36 − 8 − 4 = 802.3. QW4 adds 14, giving 816.3. A 2-line box adds 20.3, giving 836.6. That fits in 852 even before the structural change.
4. **44 px targets with 8 px gaps (S).**
   - Delete `.navrow .icon-btn { width: 34px; height: 34px }` (`:1407-1411`); the arrows go back to the global 44x44 (`app.css:156-164`).
   - `.navrow { gap: 8px }` (`:1403`).
   - `.navrow .play { height: 44px; margin-left: 0 }` (`:1419-1420`).
   - `.chip-line { height: 44px }` (`:1340`) and `.chips { gap: 8px }` (`:1324`).
   - `.bar .icon-btn { width: 44px; height: 44px; margin: -4px }` (`:2137-2140`). The slot stays 36 px, the hit area becomes 44.
   - On phones, `.moves .mv { pointer-events: none }`: the strip becomes read-only text. ‹ › and the chips cover all navigation, and stepping back shows the game's moves automatically.
   - Add `disabled` to ‹ › at the ends of the line (`:939`, `:965`), using the same limits as `browse()` (`:446-456`). Today a tap at the end does nothing visible and looks like a miss.
5. **Footer slots that keep their meaning, plus a double-tap guard (M).**
   - In `:1092-1117`:
     - Miss: `[Show answer (quiet)] [Try again (primary)]`.
     - Looking for the taught move: `[Show it] [Continue]`.
     - Every other answered state: `[Why?] [Continue]`.
   - Drop "Try again" from the answered row (see QW6).
   - Delete the inline "show it" link (`:1069-1073`). New copy: "Masters play another move. Find it on the board."
   - Guard: `let calmUntil = 0`. Set `calmUntil = performance.now() + 400` in `showMain` (`:655`), `retry` (`:631`), `next` (`:663`), `openSheet` (`:645`) and at the end of `load`. Each bar handler starts with `if (performance.now() < calmUntil) return;`. This is the same idea as Lichess's 4 s Hint delay and Anki's double-tap prevention, scaled down to a double tap.
6. **"Find it" works on the first touch (S).** In `answer()` (`:537`), when the move is sound but not the taught one, leave `pv = null` so the drill position, with its arrows, stays on the board and `dests` exists (`:367-369`). Today you must first hit the 36 px Reset chip or the 34 px ‹, and nothing tells you so.
7. **"Stop drilling" far away and undoable (M).**
   - Move ⋯ (`:1100-1105`) to the right end of the top bar: 44x44 hit area, slot reserved while answering.
   - Replace `<details>` with a light-dismiss popover (the `popover` attribute, Safari 17+) or a bottom action sheet with rows of at least 48 px and a Cancel row.
   - After `suspendCard`, show "Stopped drilling Bc4 · Undo" for 5 s.
   - Add `unsuspendCard(id)` next to `suspendCard` (`data.worker.ts:362-364`): `db.cards.update(id, { suspended: false })`.
8. **Rows stop sliding under the finger (S).**
   - In the two centring effects (`:735-749`), scroll only when the item is out of view (`inline: 'nearest'`, no smooth scroll), and drop `lines` from the dependencies.
   - Take Reset out of the scroller (`:909-917`) and rename it "Position": the ↻ "Reset" reads like Try again.
   - Keep the chip order stable (`:196-199`): played move first, then the habit, then the taught move when it appears, then tries.
   - Add `scroll-padding-inline: 12px` and an edge-fade `mask-image` to `.moves` and `.chips`.
9. **Global touch CSS (S, `app.css`).**
   - Wrap the `:hover` rules in `@media (hover: hover)`: `app.css:166-169`, drill `:1367-1369`, `:1466-1471`, `:1904-1907`. On iPhone, hover sticks after a tap (the grey square on › in IMG_1383).
   - Add a shared `:active` with a 0 ms transition to `.icon-btn, .chip-line, .play, .chip, .segmented button, .text-btn, .tabbar a, summary`. SvelteKit already registers a `touchstart` listener on `<html>`, so `:active` fires on iOS.
   - Add `touch-action: manipulation` on buttons and links.
   - Add `.input { font-size: 16px }` (`app.css:217-226`): iOS zooms into 15 px inputs and stays zoomed.

## Bigger changes, in implementation order

1. **A fixed-height phone column: the layout above (M to L).** This is what guarantees "fits one screen".
   - At `+layout.svelte:215-223`, on phones: `main.focus { height: 100dvh; overflow: hidden; display: flex; flex-direction: column }`. Check on device that `100dvh` is 852 in the Home Screen app.
   - In the drill: make `.drill`, `.stage` and `.panel` flex columns with `min-height: 0`.
   - Move the nav row block (`:937-980`) above the chips block (`:907-935`).
   - Render the chips container in every phase, empty while answering, so the rows below never move.
   - Reserve Play's slot while answering (`visibility: hidden`).
   - Nav row: ‹ › at 60x48, Play at 80x48, `margin-top: 4px`, giving a 12 px gap below the board.
   - Box: put the headline back inside on phones by removing `:2164-2166` and the top-bar swap at `:2121-2127`. Set the headline to 17 px, `.verdict { height: 68px }`, and clamp the detail line to one line.
   - Note: `height: 40px`, clamped.
   - Bar: `.foot { position: static; margin-top: auto; padding: 8px 0 calc(8px + var(--safe-b)) }`, buttons 48 px.
   - Extend the bar buttons' hit areas 8 px into the bar's padding and out to the screen edges with `::after`, but not into the 12 px gap between them, which stays a buffer in front of Continue.
   - The right slot shows Skip during the replay and "Back to the position" while browsing back. That replaces the 19.6 px link at `:1007`.
2. **Arrows that repeat while held (M).** On `pointerdown`, step once. After 400 ms, repeat every 150 ms; stop on `pointerup` or `pointercancel`, and swallow the click that follows. Tick once when repeating starts (`lib/haptics.ts`). This follows the Lichess RepeatButton pattern, but slower than Lichess's 30 ms, which suits long games; engine lines here are at most 10 plies (`:608`), and you need to see each move. Holding replaces both the tappable move strip and repeated precise taps.
3. **The Why panel opens in place (M).**
   - Delete `.sheet-backdrop` (`:1131`, `:2068-2073`), `.sheet-head` (`:1133-1156`) and `.sheet-step` (`:1159-1183`).
   - In `openSheet` (`:645-652`), set `top = chipsEl.getBoundingClientRect().bottom + 8`, and make the panel end at the bar's top edge.
   - Add a grabber: a full-width zone 16-24 px tall. A tap or a drag up of more than 40 px expands it; a drag down collapses or closes it.
   - Body:
     - step line ("3.Nxe5 · 1/5" plus the step's notes);
     - headline, text and principle;
     - "Engine line" as a 44 px segmented row ("Moves: As explained | Engine"), instead of the 84x23 pill;
     - sources as 44 px rows instead of 12 px links on one line cut off with an ellipsis.
   - Give the panel a 3 px top border in the verdict's color, so the color cue stays visible while the box is covered.
   - Why? becomes Hide in the same slot (`aria-expanded`).
4. **Forgive slips on the board (M to L).**
   - *Undo for a slip.* Offer it when a wrong first answer starts on the same square as an accepted answer and lands on a square touching that answer's destination: e2e3 instead of e2e4, or Bd3 instead of Bc4.
     - Show a 44 px "Slipped? Undo" button in the note zone, mid-screen and away from the bar, for 5 s.
     - Undo puts back the record saved before the answer: `card.card`, via a new worker `restore(record)`. Then set `recorded = false`, decrement `stats.done`, set `firstTry = true`, and call `retry()`.
   - *Drag feedback.* While a drag is in progress, put a ring two squares wide on the square under the finger: `cg.getKeyAtDomPos` from a passive `touchmove` listener in `Board.svelte`. Draw the piece larger and higher with
     `.board :global(cg-board piece.dragging) { width: 20%; height: 20%; margin: -15% 0 0 -3.75% }`:
     1.6 squares wide, about 0.9 squares above the finger. It still drops where the finger is, which the ring shows. Verify on device.
   - *Setting.* Add "Move with: Tap squares / Drag / Both" in Settings → Drills. "Tap squares" sets `draggable.enabled: false`. Lichess has this setting; Chess.com users ask for it.
5. **Optional: board from edge to edge (S to M).**
   - On phones, set the side padding to 0 (`+layout.svelte:218-219`) and give the rows their own 6 px.
   - The board becomes 393 px with squares of 49.1 (+3.1%).
   - That costs 12 px of height, leaving 2 px of slack. Drop the bar's bottom padding to 4 px to get back to 6.
   - Untested: whether a-file and h-file drags that start at the screen edge trigger iOS edge gestures in a Home Screen app.

## Other screens and Home Screen web app polish

Confirmed problems, in priority order:

| Screen | Problem (measured) | Fix | Where |
|---|---|---|---|
| Settings, Lines, Mistakes | Segmented buttons are 32 px tall inside a 38 px pill. The 3 px rim and the 2 px seams do nothing when tapped. Settings has 16 of them (Live). The selected segment's contrast is 1.08-1.09:1. | `.segmented { padding: 0; gap: 0 }` and `.segmented button { flex: 1; height: 44px; border: 3px solid transparent; background-clip: padding-box }`, with an accent-colored selected state like `.chip[aria-pressed]` | `app.css:175-199` |
| Settings | Time-control chips are 34 px tall | 44 px | `app.css:201-209` |
| Settings | "Reset drill progress" and "Clear stored games" are 33.8 px tall, and the armed state never disarms (Live, Code) | 44 px rows. Disarm after 4 s. Ignore a second tap within 600 ms. | `settings/+page.svelte:50-61`, `:94-101`, `:215-217`, `:234-236`, `:328-333` |
| Settings | Re-tapping the already-selected Period or Reach restarts the analysis | Return early if the value is unchanged | `settings/+page.svelte:63-67`, `:78-82` |
| Explore | Four 44x44 icons, 6 px apart, with no visible edges. Start, which wipes the line, sits next to Back (Live). | Grid `44px 1fr 1fr 44px`, 12 px gaps, visible pills | `explore/+page.svelte:128-147`, `:287-291` |
| Explore | Crumbs and continuation moves are 33.8 px tall, 2 px apart (Live) | 44 px, 6-8 px apart; scroll the current crumb into view | `explore/+page.svelte:300-320` |
| Explore | The first move row is half under the tab bar (Live). There is no back control, and in a Home Screen app there's no browser Back. | Pin the board (`position: sticky`) with the moves underneath; add a 44x44 back button | `explore/+page.svelte:107-222` |
| Home | "All" links are 15.1x18.8 and 32x18.8 (Live) | Remove them (the tabs and "Browse all your lines" already go there), or make the whole header a 44 px row | `+page.svelte:165`, `:186` |
| Home | The Drill card links to Mistakes until the deck has been counted | Always link to `/drill`; the drill page already waits for cards | `+page.svelte:110` |
| Mistakes, Home | The leak card's Drill button (59x44) is 8 px below the card's explore link (Live) | A full-width 44 px Drill row with 12 px clearance | `lib/ui/LeakCard.svelte:41-67`, `:105-108` |
| Mistakes | "Drill these" is 108.5x36 (Live) | 44 px tall | `leaks/+page.svelte:113-116` |
| Lines, Settings, status card | Text links: "Change" 49.8x16.5, "Use a personal token instead" 192.9x20.3, "Connect Lichess" 103.9x15.3 (Live) | 44 px buttons or rows | `lines/+page.svelte:48`; `settings/+page.svelte:153`; `lib/ui/AnalysisStatus.svelte:41`, `:44` |
| Tab bar | Targets are fine (78.6x57). Inactive labels are #6b7180 on #0d0e11, 3.95:1. | Use `--text-2` | `+layout.svelte:160-171` |

Home Screen web app specifics. This research was skipped; these come from my own knowledge, so verify on device:

- **Update reload mid-session.** The service worker calls `skipWaiting` and `clients.claim` (`service-worker.ts:21`, `:30`), and the layout reloads on `controllerchange` (`+layout.svelte:45-50`). After a deploy, the app can therefore reload a few seconds after launch, in the middle of a tap or a card. Reload only on Home or between cards, or show a small "New version · Reload" chip.
- **Rubber-band scrolling.** Add `html, body { overscroll-behavior: none }` (Safari 16+). Today it is only set while the sheet is open (`app.css:318-323`), so a diagonal swipe on a scroller drags the whole app.
- **Long-press link previews.** The tabs, the drill's ✕ (an `<a>`) and the cards are links. A slow press opens iOS's link preview. Add `-webkit-touch-callout: none` to UI links, but not to real external links.
- **No browser chrome.** Every screen needs its own way back (Explore has none). The page also must never scroll under the status bar: with `black-translucent`, content shows through it, as in the 5:02 PM shot. The fixed drill column fixes that for the drill.
- **Landscape.** iOS ignores the manifest's `orientation`. In landscape (852x393) the phone styles still apply and the board would be 840 px tall. Either add a landscape rule or accept it.

## Thumb reach (secondary)

- **Today.** While answering, every control is in the top 72% of the screen and the bottom 256 px is empty (Live, drill-ask). In the review, the footer sits well at y 760-806, but ‹ is at the far left, mid-screen, and the ⋯ trigger, which leads to a permanent action, sits in the easiest spot on the screen, 8 px above Continue.
- **After the change.** Frequent targets are at y 516-564 (nav row), 572-616 (chips) and 762-810 (bar), all in the lower 40% of the screen. Continue keeps its place at the bottom right.
  - The hardest frequent reach for a right thumb is ‹ (x 6-66). Holding to repeat replaces strings of stretched taps.
  - The far ranks (y 123-171) stay the hardest board reach; that comes with a full-width board. Tap-tap (select, then tap the destination) needs less stretch than a long drag.
  - Rare actions are deliberately outside the easy zone: End session top left, ⋯ top right.
- This also matches Hoober's finding that people prefer tapping the middle of the screen. Precise work stays in the middle (board, nav row), and the big buttons sit at the bottom.

## Open questions

1. **Verdict placement.** Should the verdict move into the box, as recommended, or stay in the top bar ("Correct Bf5 0.00")? If it stays up top, the box becomes one line (42.3 px) and frees 26 px. Both versions fit.
2. **Dropping "Try again".** Is it fine to drop Try again after a Good move (you find the taught move on the board instead) and after Show answer (a missed card already comes back 5 cards later, `REPEAT_GAP`)?
3. **Move strip.** Read-only on phones, as recommended, or keep tap-to-jump with 44x48 pills 8 px apart? Tap-to-jump costs no height but adds 3 to 5 targets and needs the no-slide scrolling from QW8.
4. **Slip undo.** It amounts to a free retry, limited to moves that land next to an accepted answer. Is that acceptable for a spaced-repetition streak?
5. **Why panel height.** In place, you get about 114 px of text by default, and the nav row and chips stay put. The alternative is today's taller sheet: about 188 px of text, but it covers the nav row and chips and needs its own controls.
6. **Board size.** Is a board that runs edge to edge worth it: 3% bigger squares, and 12 of the 14 px of slack?
7. **Things to check on the device:**
   - the `pointerdown` skip;
   - how the 10 px drag threshold feels;
   - the drag ring and the lifted piece;
   - whether `100dvh` is 852;
   - whether any card in your 232-card deck still has copy too long for the clamps (the Live run used one card).
