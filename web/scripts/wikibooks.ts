// Opening theory from the Wikibooks "Chess Opening Theory" pages (the text Lichess shows in its explorer;
// CC BY-SA). Used as research notes for written explanations, never shipped. Cached per page, missing pages too.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Ply } from '../src/lib/chess/line';

const API = 'https://en.wikibooks.org/w/api.php';
const HEADERS = { 'User-Agent': 'openings-trainer/0.1 (personal study tool)' };
/** Pause between requests: one at a time, as Wikimedia asks of scripts. */
const PAUSE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Characters of each page kept for the writer. */
const MAX_CHARS = 1800;

/** "Chess Opening Theory/1. e4/1...e5/2. Nf3" for the moves from the start. */
export const wikiTitle = (plies: Ply[]) =>
	['Chess Opening Theory', ...plies.map((p) => (p.white ? `${p.moveNumber}. ${p.san}` : `${p.moveNumber}...${p.san}`))].join('/');

export const wikiUrl = (title: string) => `https://en.wikibooks.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%2F', '/')}`;

async function query(params: Record<string, string>) {
	const url = `${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', maxlag: '5', ...params })}`;
	for (let attempt = 0; ; attempt++) {
		await sleep(PAUSE_MS);
		const res = await fetch(url, { headers: HEADERS });
		if (res.ok) {
			const body = await res.json();
			if (!body.error) return body.query;
		}
		if (attempt >= 6) throw new Error(`Wikibooks ${res.status}`);
		const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
		console.log(`  Wikibooks asked us to slow down; waiting ${Math.round(wait / 1000)}s`);
		await sleep(wait);
	}
}

/** The commentary part of a page: headings become plain lines; tables, references and links are dropped. */
function clean(text: string): string {
	const cut = text.search(/\n=+ ?(Theory table|References|See also|External links|Statistics)/);
	let out = (cut >= 0 ? text.slice(0, cut) : text)
		.replace(/^=+\s*(.*?)\s*=+$/gm, '$1:')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (out.length > MAX_CHARS) out = out.slice(0, out.lastIndexOf('.', MAX_CHARS) + 1) || out.slice(0, MAX_CHARS);
	return out;
}

/** Page texts by title (null when there's no page or no commentary), from the cache or Wikibooks. */
export async function theoryPages(titles: string[], cacheFile: URL): Promise<Map<string, string | null>> {
	const cache: Record<string, string | null> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
	const unknown = [...new Set(titles)].filter((t) => !(t in cache));

	// Which pages exist: 50 titles per request.
	const existing: string[] = [];
	for (let i = 0; i < unknown.length; i += 50) {
		const batch = unknown.slice(i, i + 50);
		const q = await query({ prop: 'info', titles: batch.join('|') });
		const alias = new Map<string, string>();
		for (const r of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(r.from, r.to);
		const pages = new Map<string, { missing?: boolean }>(q.pages.map((p: { title: string; missing?: boolean }) => [p.title, p]));
		for (const title of batch) {
			let final = title;
			for (let hops = 0; alias.has(final) && hops < 3; hops++) final = alias.get(final)!;
			const page = pages.get(final);
			if (!page || page.missing) cache[title] = null;
			else existing.push(title);
		}
	}

	writeFileSync(cacheFile, JSON.stringify(cache));
	if (existing.length) console.log(`  fetching ${existing.length} theory pages…`);

	// Their text: one page per request (the API returns a single full extract at a time).
	for (const [i, title] of existing.entries()) {
		const q = await query({ prop: 'extracts', explaintext: '1', titles: title });
		const text = clean(q.pages?.[0]?.extract ?? '');
		cache[title] = text.length > 40 ? text : null;
		if (i % 25 === 24) writeFileSync(cacheFile, JSON.stringify(cache));
	}
	writeFileSync(cacheFile, JSON.stringify(cache));
	return new Map(titles.map((t) => [t, cache[t] ?? null]));
}
