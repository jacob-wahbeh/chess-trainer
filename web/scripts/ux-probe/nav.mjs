import { js, load, sleep, click } from './wk.mjs';

export const BASE = 'http://localhost:5174';

/** Waits until `cond` (a JS expression) is true in the page. */
export async function waitFor(cond, timeoutMs = 30_000, label = cond) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeoutMs) {
		try {
			if (await js(`return !!(${cond});`)) return true;
		} catch {}
		await sleep(250);
	}
	throw new Error(`waitFor timed out: ${label}`);
}

/** Waits until the layout stops changing (scroll height, interactive count, text) for `quietMs`. */
export async function waitStable(quietMs = 2500, timeoutMs = 30_000) {
	const t0 = Date.now();
	let last = '', since = Date.now();
	while (Date.now() - t0 < timeoutMs) {
		const sig = await js(`return [document.scrollingElement.scrollHeight, document.querySelectorAll('a[href],button,summary,input,select,label').length, document.body.innerText.length, document.querySelectorAll('.mv.faint').length].join('|');`);
		if (sig !== last) (last = sig), (since = Date.now());
		else if (Date.now() - since >= quietMs) return sig;
		await sleep(300);
	}
	return last + ' (not stable)';
}

/** Full page load of `path`, then waits for the app shell. */
export async function open(path) {
	await load(BASE + path);
	await waitFor(`document.querySelector('main') && document.querySelector('main').children.length`, 30_000, 'main');
}

/** Client-side navigation through a link in the page (as a tap on it would). */
export async function goLink(selector) {
	await js(`document.querySelector(${JSON.stringify(selector)}).click(); return true;`);
}

/** Clicks the centre of the first element matching `selector` with a real (trusted) mouse click. */
export async function tap(selector) {
	const r = await js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
	if (!r) throw new Error(`tap: no ${selector}`);
	await click(r.x, r.y);
	return r;
}

/** Clicks the element whose visible text matches `text` (exact, trimmed) among `selector`. */
export async function tapText(selector, text) {
	const r = await js(`const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && e.getClientRects().length); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
	if (!r) throw new Error(`tapText: no ${selector} "${text}"`);
	await click(r.x, r.y);
	return r;
}

/** Plays a UCI move on the board by clicking the from-square, then the to-square (orientation from the board). */
export async function playMove(uci) {
	const geo = await js(`const b = document.querySelector('cg-board').getBoundingClientRect(); const black = !!document.querySelector('.cg-wrap.orientation-black'); return { x: b.left, y: b.top, w: b.width, h: b.height, black };`);
	const sq = (s) => {
		const f = s.charCodeAt(0) - 97, r = Number(s[1]);
		const col = geo.black ? 7 - f : f, row = geo.black ? r - 1 : 8 - r;
		return { x: geo.x + (col + 0.5) * (geo.w / 8), y: geo.y + (row + 0.5) * (geo.h / 8) };
	};
	const a = sq(uci.slice(0, 2)), b = sq(uci.slice(2, 4));
	await click(a.x, a.y);
	await sleep(250);
	await click(b.x, b.y);
	return { from: a, to: b, geo };
}

export { sleep };
