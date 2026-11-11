// Client for wk/browser.swift: one JSON file per command in /tmp/ux-probe/cmd, one result file back.
import fs from 'node:fs';

const DIR = '/tmp/ux-probe/cmd';
let n = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function cmd(obj, timeoutMs = 180_000) {
	fs.mkdirSync(DIR, { recursive: true });
	const id = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(6, '0')}-${String(n++).padStart(5, '0')}`;
	const file = `${DIR}/${id}.cmd.json`;
	fs.writeFileSync(file + '.tmp', JSON.stringify(obj));
	fs.renameSync(file + '.tmp', file);
	const out = `${DIR}/${id}.res.json`;
	const t0 = Date.now();
	while (!fs.existsSync(out)) {
		if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${obj.type}`);
		await sleep(25);
	}
	const res = JSON.parse(fs.readFileSync(out, 'utf8')).result;
	fs.unlinkSync(out);
	return res;
}

/** Runs `body` (an async function body that returns a JSON-serialisable value) in the page. */
export async function js(body, timeoutMs) {
	const code = `const __r = await (async () => {${body}\n})(); return JSON.stringify(__r === undefined ? null : __r);`;
	const res = await cmd({ type: 'js', code }, timeoutMs);
	if (res && typeof res === 'object' && res.error) throw new Error(`js error: ${res.error}\n--- in:\n${body.slice(0, 400)}`);
	return res === null ? null : JSON.parse(res);
}

export const click = (x, y) => cmd({ type: 'click', x, y });
export const move = (x, y) => cmd({ type: 'move', x, y });
export const snap = (path, width = 1179, rect) => cmd({ type: 'snap', path, width, ...(rect ? { rect } : {}) });
export const load = (url) => cmd({ type: 'load', url }, 60_000);
export const quit = () => cmd({ type: 'quit' });
export { sleep };
