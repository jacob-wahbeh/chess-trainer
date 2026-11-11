// In-page measurement of tap targets, plus clean and annotated screenshots, for one UI state.
import fs from 'node:fs';
import { js, snap, move } from './wk.mjs';

export const SHOTS = '/tmp/ux-probe/shots';
export const DATA = '/tmp/ux-probe/data';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

/** Body of an async function run in the page; returns targets in viewport (and optionally document) coordinates. */
const MEASURE = (mode) => `
const MODE = ${JSON.stringify(mode)};
const SEL = 'a[href], button, summary, input, select, textarea, label, [role=button], [tabindex]:not([tabindex="-1"])';
const vw = innerWidth, vh = innerHeight, sy = scrollY;
const found = [...document.querySelectorAll(SEL)];
for (const b of document.querySelectorAll('.cg-wrap')) found.push(b);
const set = new Set(found);
const outer = found.filter((el) => { for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; });
const nestedDropped = found.filter((el) => !outer.includes(el)).map((el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.'));
const labelOf = (el) => {
  if (el.classList.contains('cg-wrap')) return 'board';
  const aria = el.getAttribute('aria-label');
  const text = (el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim();
  return (text || aria || el.getAttribute('title') || el.tagName.toLowerCase()).slice(0, 34);
};
const visible = (el) => {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
  return true;
};
/** Border box clipped by scrolling/clipping ancestors (not past a fixed ancestor), in viewport px. */
const clipped = (el) => {
  const r = el.getBoundingClientRect();
  let L = r.left, T = r.top, R = r.right, B = r.bottom, fixed = getComputedStyle(el).position === 'fixed', sticky = false;
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.position === 'sticky') sticky = true;
    if (!fixed && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      const pr = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { L = Math.max(L, pr.left + p.clientLeft); R = Math.min(R, pr.left + p.clientLeft + p.clientWidth); }
      if (cs.overflowY !== 'visible') { T = Math.max(T, pr.top + p.clientTop); B = Math.min(B, pr.top + p.clientTop + p.clientHeight); }
    }
    if (cs.position === 'fixed') fixed = true;
  }
  return { full: r, L, T, R, B, fixed, sticky };
};
const rd = (n) => Math.round(n * 10) / 10;
const items = [];
for (const el of outer) {
  if (!visible(el)) continue;
  const c = clipped(el);
  if (c.full.width < 1 || c.full.height < 1) continue;
  let { L, T, R, B } = c;
  if (R - L < 1 || B - T < 1) continue; // scrolled out of its scroller
  const inView = !(R <= 0 || L >= vw || B <= 0 || T >= vh);
  // On-screen hit test: share of sample points where this element (or a child) is on top.
  let hit = null;
  if (inView) {
    const vL = Math.max(L, 0), vT = Math.max(T, 0), vR = Math.min(R, vw), vB = Math.min(B, vh);
    let n = 0, h = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const x = vL + ((i + 0.5) / 5) * (vR - vL), y = vT + ((j + 0.5) / 5) * (vB - vT);
      const top = document.elementFromPoint(x, y);
      n++;
      if (top && (top === el || el.contains(top))) h++;
    }
    hit = h / n;
  }
  if (MODE === 'screen' && !inView) continue;
  const docY = c.fixed ? null : T + sy;
  items.push({
    label: labelOf(el), tag: el.tagName.toLowerCase(), cls: [...el.classList].slice(0, 3).join('.'),
    x: rd(L), y: rd(T), w: rd(R - L), h: rd(B - T),
    fullW: rd(c.full.width), fullH: rd(c.full.height), clipped: rd(R - L) < rd(c.full.width) - 0.5 || rd(B - T) < rd(c.full.height) - 0.5,
    docY: docY === null ? null : rd(docY), fixed: c.fixed, sticky: c.sticky, inView, hit,
    fontPx: parseFloat(getComputedStyle(el).fontSize), disabled: !!el.disabled
  });
}
// Landmarks for layout math.
const marks = {};
for (const s of ['main', '.bar', '.bar .status', '.track', '.evalbar', '.board-row', '.cg-wrap', '.chips', '.navrow', '.moves', '.note', '.panel', '.verdict', '.foot', '.foot-row', '.foot .actions', '.menu-body', '.sheet', '.sheet-head', '.sheet-step', '.sheet-body', '.sheet-backdrop', '.tabbar', '.hint', '.drill-cta', '.status.card']) {
  const el = document.querySelector(s);
  if (!el || !visible(el)) continue;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) continue;
  marks[s] = { x: rd(r.left), y: rd(r.top), w: rd(r.width), h: rd(r.height), bottom: rd(r.bottom) };
}
const se = document.scrollingElement;
return {
  url: location.pathname + location.search, vw, vh, scrollY: sy, scrollHeight: se.scrollHeight, clientHeight: se.clientHeight,
  fits: se.scrollHeight <= innerHeight, overflowPx: Math.max(0, se.scrollHeight - innerHeight),
  sheetOpen: document.documentElement.classList.contains('sheet-open'), items, nestedDropped, marks,
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)
};`;

const distance = (a, b) => {
	const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
	const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
	return Math.round(Math.hypot(dx, dy) * 10) / 10;
};

/** Nearest neighbour gap among `list` (same coordinate space). */
function gaps(list) {
	for (const a of list) {
		let best = Infinity, who = null;
		for (const b of list) {
			if (a === b) continue;
			const d = distance(a, b);
			if (d < best) (best = d), (who = b.label);
		}
		a.nearest = who;
		a.nearestGap = who === null ? null : best;
		a.small = a.fullW < 44 || a.fullH < 44;
		a.tight = a.nearestGap !== null && a.nearestGap < 8;
	}
	return list;
}

const ANNOTATE = (boxes) => `
const boxes = ${JSON.stringify(boxes)};
const o = document.createElement('div');
o.id = 'ux-probe-overlay';
o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:600 9px/1.1 -apple-system,system-ui;';
const band = (top, h) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;right:0;top:' + top + 'px;height:' + h + 'px;background:repeating-linear-gradient(45deg,rgba(255,0,255,.18) 0 6px,transparent 6px 12px);'; o.appendChild(d); };
band(0, 59); band(innerHeight - 34, 34);
for (const b of boxes) {
  const d = document.createElement('div');
  const col = b.small && b.tight ? '#ff3b30' : b.small || b.tight ? '#ff9f0a' : '#30d158';
  d.style.cssText = 'position:absolute;box-sizing:border-box;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;border:1.5px solid ' + col + ';background:' + col + '22;border-radius:3px;';
  const t = document.createElement('span');
  t.textContent = Math.round(b.fullW) + '×' + Math.round(b.fullH) + (b.nearestGap !== null ? ' g' + Math.round(b.nearestGap) : '');
  t.style.cssText = 'position:absolute;left:0;top:0;background:' + col + ';color:#000;padding:0 2px;white-space:nowrap;border-radius:0 0 3px 0;';
  d.appendChild(t);
  o.appendChild(d);
}
document.documentElement.appendChild(o);
return true;`;

/**
 * Measures the current state. `full`: also measure the whole page in document coordinates (long pages) and take a
 * full-page snapshot.
 */
export async function measureState(name, { full = false, note = '' } = {}) {
	await move(196, 30); // park the mouse in the top safe area (nothing interactive there): no :hover in shots
	const res = await js(MEASURE('screen'));
	// Targets you can actually tap right now: visible on screen and not covered (e.g. by the sheet's backdrop).
	const active = res.items.filter((i) => i.hit === null || i.hit > 0);
	const covered = res.items.filter((i) => i.hit === 0);
	gaps(active);
	const out = { state: name, note, ...res, items: undefined, targets: active, covered: covered.map((c) => c.label) };
	if (full && res.scrollHeight > res.vh + 1) {
		const page = await js(MEASURE('page'));
		// Document coordinates for in-flow targets; fixed ones (the tab bar) are listed apart.
		const flow = page.items.filter((i) => !i.fixed).map((i) => ({ ...i, y: i.docY }));
		gaps(flow);
		out.page = { targets: flow, fixed: page.items.filter((i) => i.fixed).map((i) => i.label) };
	}
	fs.writeFileSync(`${DATA}/${name}.json`, JSON.stringify(out, null, 1));
	await snap(`${SHOTS}/${name}.png`);
	await js(ANNOTATE(active));
	await snap(`${SHOTS}/${name}.annotated.png`);
	await js(`document.getElementById('ux-probe-overlay')?.remove(); return true;`);
	if (full && res.scrollHeight > res.vh + 1) {
		await snap(`${SHOTS}/${name}.full.png`, 1179, [0, 0, res.vw, res.scrollHeight]);
	}
	const small = active.filter((t) => t.small).length, tight = active.filter((t) => t.tight).length;
	console.log(`${name}: ${active.length} targets (${small} <44px, ${tight} gap<8px), covered ${covered.length}; scrollHeight ${res.scrollHeight} vs ${res.vh} -> ${res.fits ? 'fits' : `scrolls ${res.overflowPx}px`}`);
	return out;
}
