# Mobile UX fixes: execution plan

The working plan for making the phone UI less cramped and less precise. It comes from the 2026-11-10 review. Work top to bottom, one batch per commit. Tick boxes as you go.

| File | What it holds |
|---|---|
| `review.md` | The full review: measurements, research with sources, wireframes, height budget, reasoning. Read its "Recommended drill layout" section before batch F. |
| `evidence.json` | Raw output: 6 code audits, 4 verifications, 3 research reports, live measurements. The audits for `drill-ask` and `drill-sheet` were not independently verified. There are also more small issues than the review lists. |
| `baseline-2026-11-10.json` | Live target measurements before any fix, to compare against. |
| `web/scripts/ux-probe/` | The tool that re-measures. See its README. |

Line numbers below are approximate and drift. Go by the selector or function name.

## Rules from the owner (don't break these)

- **The board stays full width on phones. Never shrink it** ("dont shrink the board ever"). Making it bigger, edge to edge, is allowed.
- **Keep the colored result box** (green Correct, blue Good move, red Not quite), with little text in it.
- **The drill fits one screen** in the Home Screen app (393x852, safe areas 59/34) **without scrolling**, in every result state.
- **Priority:** first tap-target size, spacing and mis-tap cost; thumb reach second.
- **The owner wants speed.** Do each batch directly in one session; no multi-agent workflows needed. Check on the phone after each batch.

## Before starting

- [x] **Commit the working tree.** Both sessions' drill work is in `89ab27b`, "Opening-idea explanations: pilot on three cards".
- [ ] **Get answers to the decisions** (next section), or go with the default.

## More rules (from the opening-ideas session)

- **Never reveal the taught move** before the owner finds it or taps Show answer (`answerShown` / `seeking`). An alternative's `before` text is safe to show early; its `after` text and the opening `ideas` are not.
- **Don't invent chess content.** If a design needs data that doesn't exist, make it optional with a fallback and say what data it needs. Only three cards have the rich fields (`ideas`, `habit`, `taught`, `alternatives` on `Explanation` in `web/src/lib/explain/check.ts`; format in `docs/opening-ideas-pipeline.md`). The other 600+ cards have only the older fields and must keep working.
- **Call the opponent by side or "they"**, never he/him/his.
- **Commits:** only when the owner asks. Stage explicit paths. Never commit `debug_photos/` or `.env`. The owner deploys with `git push origin main` (GitHub Pages).
- **Phone:** iPhone 14 Pro, 393x852 like the measurements here.

**Rich-content test cards** (open with `/drill?card=…`):
- `draco_jaco%7Cwhite%7C4886445385944472%7Cc2c3`: try 3.d5, then Try again with 3.dxe5; also 3.Nf3.
- `draco_jaco%7Cblack%7C6104332673881535%7Cd7d6`: try 2...Nc6 and 2...d5.
- `draco_jaco%7Cwhite%7C15856967415293%7Cf3g5`: try 7.Qb3 and 7.Nxd4.

## Decisions (default in bold)

On 2026-11-10 the owner said to go with the recommendations: 1 = into the box, 2 = yes, 3 = read-only (done), 5 = keep the sheet and fix its controls (because of the opening-ideas content), 6 = later. 4 (slip undo) is still open.

1. **Verdict placement.** **Move it into the colored box (17px headline)**, or keep it in the top bar. If it stays in the top bar, the box is one line (42px) and the layout frees 26px.
2. **Drop "Try again"** after a Good move (you find the taught move on the board instead) and after Show answer (a missed card comes back anyway). **Yes.**
3. **Move strip on phones.** **Read-only text**; ‹ › and the chips do the navigating. The alternative is tappable 44x48 pills, 8px apart.
4. **Slip undo.** For a wrong first answer from the same square as an accepted answer, landing next to that answer's destination, offer "Slipped? Undo" for 5s. **Ask the owner** (it amounts to a free retry).
5. **Why on phones.** An in-place panel under the chips (about 114px of text; the board, nav row and chips stay live), or keep the sheet but fix its controls. **Reconsider:** the opening-ideas work adds "Main ideas" and comparisons, which need more room. Keeping the sheet but fixing its controls may now be the better choice.
6. **Board edge to edge** (393px, +3%; costs 12 of the 14px of slack). **Optional, later.**

## Batches

### A: board input (S, about 1 hour). Done 2026-11-10, and the owner checked it on the phone ("looks and feels way better")

- [x] **A1. Drag threshold.** In `lib/ui/Board.svelte`, config (≈line 86):
  `draggable: { enabled: !!dests, distance: 10, autoDistance: false }`.
  Today, after any drag move, chessground's `autoDistance` starts the next drag at 0px, so a finger roll becomes a move. That move is graded wrong, saved at once and resets the streak, with no undo.
- [x] **A2. Any touch on the board skips the replay or returns from browsing.** In the drill, the board wrapper `<div class="board" … onclick>` (≈line 935): change `onclick` to `onpointerdown`, with
  `phase === 'intro' ? finishIntro() : phase === 'ask' && cursor < end && goTo(end)`.
  Chessground calls preventDefault on touchstart near pieces, so `click` never fires there; today about 40% of the board responds.
- [x] **A3. "Find it" works on the first touch after a Good move.** In `answer()` (≈line 544, `pv = { key: uci, n: 1 }`): when the move is sound but not the taught one (`seeking`), keep `pv = null` so the drill position stays on the board and `dests` exists. Today you must first tap Reset or ‹, and nothing tells you.
- **Check:** on the phone only. The tool uses a mouse, so it can't test touch.

### B: sizes, spacing, height (S, about 1-2 hours; B1 before B2). Done 2026-11-10

Measured with ux-probe on the Petrov card:
- Every drill state is 852/852: correct, good, wrong, shown, ask, Why and the menu. The baseline was 850-915.
- Correct, wrong and shown: 0 targets under 44px and 0 gaps under 8px.
- Good move: only "show it" is still small; that's batch C.
- Not done yet: Why sheet controls (batch W) and the menu item (batch D).
- As built, on phones: the streak and ⋯ moved into the top bar in place of the card count; the move strip is read-only; Reset is now "Position", fixed outside the scrolling chip row.

- [x] **B1. Free about 48px.**
  - Remove the footer's `.foot-row` and move its contents up: the streak goes into the top bar (where `.status` shows after answering), and ⋯ moves per D1.
  - Phones: `.stage` gap 16 → 8, `.panel` gap 12 → 8.
  - `.note`: fixed `height: 42px; overflow: hidden`.
  - `.verdict p`: clamp to 2 lines.
- [x] **B2. 44px targets with 8px gaps.**
  - Delete the 34px override `.navrow .icon-btn`; the global `.icon-btn` is 44.
  - `.navrow { gap: 8px }`; `.navrow .play { height: 44px; margin-left: 0 }`.
  - `.chip-line { height: 44px }`; `.chips { gap: 8px }`.
  - Phone `.bar .icon-btn`: 44px hit area (`margin: -4px`), drawn at 36.
  - Phones: `.moves .mv { pointer-events: none }` (decision 3).
  - Disable ‹ › at the ends of the line, using the limits in `browse()`.
- [x] **B3. Rows stop sliding under the finger.** The two "keep … in view" `$effect`s for `chipsEl` and `movesEl`:
  - scroll only when the item is out of view (`inline: 'nearest'`, not smooth);
  - drop `lines` from the dependencies.
  - Take Reset out of the scroller and rename it "Position".
  - Keep the chip order stable (in `chips`): played move, habit, then the taught move appended when shown, then tries.
  - `.moves`/`.chips`: `scroll-padding-inline: 12px` plus an edge-fade `mask-image`.
- **Check:** with the tool, `run-drill.mjs` then `summarize.mjs`.
  - Page heights: correct, good, wrong and shown all ≤ 852. The baseline was 850.3, 869, 855 and 915.
  - No frequent target under 44px, and no gap under 8px except inside the board.

### C: footer buttons keep their meaning (M, about 2 hours; needs decision 2). Done 2026-11-10, decision 2 = yes

- [x] **C1. Fixed slots.**
  - Miss: `[Show answer (quiet)] [Try again (primary)]`.
  - Looking for the taught move: `[Show it] [Continue]`.
  - Every other answered state: `[Why?] [Continue]`.
  - Delete the inline "show it" link; the box copy becomes "Masters play another move. Find it on the board."
  - Explicit widths: left `flex: 0 0 142px`, right `flex: 1`, 12px gap, 48px tall.
- [x] **C2. 400ms double-tap guard.** Add `let calmUntil = 0`. Set it to `performance.now() + 400` in `showMain`, `retry`, `next`, `openSheet` and at the end of `load`. Bar handlers return early while calm. Today Continue covers 80% of where Show answer just was.
- **Check:** on the phone, double-tap Show answer. It must not skip the answer.

### D: "stop drilling" far away and undoable (M, about 2 hours). Done 2026-11-10

As built:
- ⋯ is in the phone top bar with a 44px hit area. It closes on a touch outside it (pointerdown listener), and its item is 48px tall.
- Desktop keeps it in the footer row.
- The Undo toast was tested in ux-probe: suspend, then Undo, unsuspends and reloads the card.

- [x] **D1. Move ⋯** to the right end of the top bar (44x44 hit area; slot reserved while answering). Replace the `<details class="menu">` with a light-dismiss `popover` (Safari 17+) or an action sheet with rows of at least 48px plus Cancel.
- [x] **D2. Undo.** After `skipForGood()` → `suspendCard`, show a 5s toast, "Stopped drilling Bc4 · Undo". Add `unsuspendCard(id)` next to `suspendCard` in `lib/worker/data.worker.ts` (≈line 362): `db.cards.update(id, { suspended: false })`.

### E: global touch CSS and the other screens (S-M, about 2 hours)

- [ ] **E1.** `app.css`:
  - Wrap `:hover` rules in `@media (hover: hover)` (also the drill's hover rules); hover sticks after a tap on iPhone.
  - A shared `:active` state with a 0ms transition on `.icon-btn, .chip-line, .play, .chip, .segmented button, .text-btn, .tabbar a, summary`.
  - `touch-action: manipulation` on buttons and links.
  - `.input { font-size: 16px }`, so iOS doesn't zoom on focus.
  - `html, body { overscroll-behavior: none }`.
  - `-webkit-touch-callout: none` on UI links, not on external ones.
- [ ] **E2. Segmented controls.** Today: 32px buttons in a 38px pill. Change to 44px buttons with no dead rim, and an accent-colored selected state (today's contrast is 1.08:1). Time-control `.chip`: 34 → 44.
- [ ] **E3. Settings.**
  - "Reset drill progress" and "Clear stored games" become 44px rows. The armed state disarms after 4s, and a second tap within 600ms is ignored.
  - Re-tapping the selected Period or Reach doesn't restart the analysis.
- [ ] **E4. Explore.**
  - The icon row becomes a grid `44px 1fr 1fr 44px` with 12px gaps and visible pills, so Start (which wipes the line) isn't next to Back.
  - Crumbs and moves become 44px, 6-8px apart.
  - Pin the board; add a 44x44 back button (a Home Screen app has no browser Back).
- [ ] **E5. Home, Mistakes, Lines.**
  - Remove the "All" links (15x19px) or make the header a 44px row.
  - Drill card: always link to `/drill`.
  - LeakCard's Drill becomes a full-width 44px row.
  - "Drill these" becomes 44px tall.
  - Text links ("Change", "Use a personal token instead", "Connect Lichess") become 44px buttons.
  - Tab bar inactive labels use `--text-2`.
- [ ] **E6. Service worker update.** Don't reload on `controllerchange` in the middle of a drill (`+layout.svelte`). Reload on Home or between cards, or show a "New version · Reload" chip.

### F: fixed-height drill column (M-L, half a day; after A-C; decisions 1 and 3)

- [ ] Follow `review.md`, "Recommended drill layout" (wireframes, height budget, slot table). In short:
  - **Column:** phone `main.focus { height: 100dvh; overflow: hidden; display: flex; flex-direction: column }`. Drill `.drill`, `.stage` and `.panel` become flex columns with `min-height: 0`.
  - **Row order:** move the nav row under the board, above the chips. Render the chips row in every phase (empty while answering). Reserve Play's slot while answering.
  - **Sizes:**
    - nav row: ‹ › 60x48, Play 80x48, 12px gap under the board;
    - note: 40px, clamped;
    - box: 68px (headline plus one line);
    - bar: `position: static; margin-top: auto`, buttons 48px.
  - **Right slot:** shows Skip during the replay and "Back to the position" while browsing back, replacing the 19.6px link.
- **Check:**
  - Every state is exactly 852 tall (838 fixed plus 14 slack).
  - On the phone, `100dvh` = 852 in the Home Screen app.
  - Copy that's too long for the clamps: check a few cards with `/drill?card=<id>`.

### W: the Why sheet, shorter and more visual (M-L, after A-C; replaces the Why item in G)

The owner's reaction to the rich cards on the phone: the content is good, but the Why sheet is long and scroll-heavy, some things repeat, and it isn't visual enough.

The goals:
- learn by seeing, not walls of text;
- everything reachable from the board without scrolling the page;
- compact rather than airy;
- large, intuitive controls.

- [ ] List what the sheet shows for each line on the three rich cards and on an older card, and remove the repeats. For example, the summary, the story, the comparison and the step notes can say the same thing.
- [ ] Tie text to the board: each idea or line note should show its arrows/squares when tapped, as the note links in the desktop `storyBlock` already do. Collapse long text behind one-line headlines.
- [ ] Fix the control cluster:
  - Expand and Close 4px apart, Next and Play 2px apart;
  - the 84x23 "Engine line" pill;
  - the invisible backdrop over the board.
- [ ] Keep the hide-until-shown rules (`answerShown` / `seeking`), and the fallback for cards without rich fields.

### G: later

- [ ] **‹ › repeat while held:** 400ms delay, then every 150ms, with a haptic tick when repeating starts.
- [ ] **Slip undo (decision 4).**
- [ ] **Drag feedback:** a ring on the square under the finger, and the dragged piece drawn larger and above the finger.
- [ ] **Setting:** "Move with: Tap squares / Drag / Both".
- [ ] **Optional:** board edge to edge (decision 6).

## How to verify every batch

1. `cd web && npm run check && npm test`.
2. **Tool, for layout batches:** `web/scripts/ux-probe/README.md` covers starting the browser, `prep-wk.mjs`, `run-drill.mjs`, `run-pages.mjs` and `summarize.mjs`. Compare with `baseline-2026-11-10.json`.
3. **Phone:**
   - `npm run dev:lan` in `web/`, then open `http://<Mac IP>:5173` in Safari (the port can differ; it was 5174 when 5173 was busy). Find the IP with `ipconfig getifaddr en0`; it was 192.168.1.201.
   - Safari has its own storage, separate from the Home Screen app, so import games there once.
   - Touch-only behaviour (A1, A2, C2, `:active`) can only be checked on the phone.
4. One commit per batch, with a short summary of what changed and what was checked on the phone.
