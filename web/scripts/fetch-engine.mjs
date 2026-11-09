// Downloads the Stockfish 19 lite single-threaded WebAssembly build into static/engine/.
// Source: https://github.com/nmrugg/stockfish.js (GPL-3.0). Pinned by version and SHA-256.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const VERSION = 'v19.0.1';
const FILES = {
	'stockfish-19-lite-single.js': 'ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a',
	'stockfish-19-lite-single.wasm': 'ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de'
};
const outDir = new URL('../static/engine/', import.meta.url);

await mkdir(outDir, { recursive: true });
for (const [name, sha256] of Object.entries(FILES)) {
	const url = `https://github.com/nmrugg/stockfish.js/releases/download/${VERSION}/${name}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual !== sha256) throw new Error(`${name}: SHA-256 mismatch (got ${actual})`);
	await writeFile(new URL(name, outDir), bytes);
	console.log(`${name}: ${(bytes.length / 1e6).toFixed(2)} MB, verified`);
}
