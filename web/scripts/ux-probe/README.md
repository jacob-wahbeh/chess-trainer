# ux-probe: measure the phone UI

This tool renders the app in WebKit (Safari's engine) at iPhone size and measures every tap target. Use it to check UI changes against the 2026-11-10 baseline (`docs/mobile-ux/baseline-2026-11-10.json`).

**Why WebKit and not Chrome:** Playwright's Chrome won't start inside the Claude Code sandbox (a Mach-port permission error). This is a small WKWebView app instead, driven by JSON command files.

## What it emulates, and what it doesn't

**Emulated:**
- a 393x852 viewport;
- `navigator.standalone`;
- an iPhone user agent;
- dark mode;
- the app's safe-area variables, `--safe-t` = 59px and `--safe-b` = 34px.

**Not emulated:**
- **Pixel density.** It renders at DPR 2; the phone is DPR 3. chessground draws the board at 380px here and 378.67px on the phone.
- **Touch.** Input is a mouse: `hover: hover`, `pointer: fine`, no touch events. Touch-only behaviour (chessground's touchstart handling, drag thresholds, `:active` on iOS) still has to be checked on the phone.
- **Text metrics.** Wrapping can differ by a line from iOS. The fit results depend on text length.

**Storage:** the browser's website data store is non-persistent. Every launch starts empty and needs the data step below.

## Run it

All output goes to `/tmp/ux-probe/`: `cmd/` (the command channel), `data/<state>.json`, `shots/<state>.png` and `*.annotated.png`. Run the scripts from this directory. The app's dev server must be on http://localhost:5174 (`npm run dev:lan` in `web/`). Otherwise edit `BASE` in `nav.mjs` and `prep-wk.mjs`.

```sh
cd web/scripts/ux-probe
mkdir -p /tmp/ux-probe/bin
swiftc -O wk/browser.swift -o /tmp/ux-probe/bin/browser          # ~30 s, once per reboot
(/tmp/ux-probe/bin/browser http://localhost:5174/ > /tmp/ux-probe/browser.out 2>&1 &)
node smoke.mjs                   # sanity check: viewport, safe areas, trusted clicks
node prep-wk.mjs                 # import draco_jaco (3 months, reach 5; --period=12 --reach=3 for more cards) and wait; ~1 min
node run-drill.mjs [ask|correct|good|wrong|deck]   # drill states on the Petrov test card
node run-home.mjs; node run-pages.mjs [home|leaks|lines|explore|settings]
node summarize.mjs               # one line per target: size, nearest neighbour, gap, SMALL/TIGHT flags
node -e "import('./wk.mjs').then(m => m.quit())"   # stop the browser
```

## The test card

`run-drill.mjs` uses card `draco_jaco|white|6820108232337383|f1c4`, a Petrov's Defense card:
- 3.Nxe5 (`f3e5`) is the taught move: **Correct**.
- 3.d4 (`d2d4`) is an accepted alternative: the blue **Good move**.
- 3.Bc4 (`f1c4`) is the habit: **Not quite**.

Open any card directly with `/drill?card=<id>`. `cards.mjs` lists the deck.

## Files

| File | What it does |
|---|---|
| `wk/browser.swift` | The browser. Commands: `js`, `click`, `move`, `snap`, `load`, `quit`. |
| `wk.mjs` | Node client: `js(body)`, `click(x, y)`, `snap(path)`, `load(url)`, `quit()`. |
| `nav.mjs` | `open(path)`, `waitFor(expr)`, `waitStable()`, `tap(sel)`, `playMove(uci)`. |
| `measure.mjs` | `measureState(name)` collects every visible target and its edge-to-edge gap to the nearest other target (flags: under 44px, gap under 8px). Writes JSON and a clean plus an annotated screenshot. |
| `run-*.mjs` | Drive the app into each state and measure it. |
| `summarize.mjs`, `page-sum.mjs`, `export.mjs` | Print or export the collected data. |
