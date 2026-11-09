// Renders the app icon (same design as static/favicon.svg) to the PNG sizes home screens need.
// Dependency-free: shapes are rasterized with 4x4 supersampling and written as RGBA PNGs.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const BG = [0x15, 0x17, 0x1c];
const DARK = [0x8c, 0xa2, 0xad];
const LIGHT = [0xde, 0xe3, 0xe6];
const ACCENT = [0x8a, 0xb4, 0xf8];

// Design space is 64x64, matching favicon.svg.
const roundRect = (x0, y0, w, h, r) => (x, y) => {
	const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r));
	const dy = Math.max(y0 + r - y, 0, y - (y0 + h - r));
	return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && dx * dx + dy * dy <= r * r;
};
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Layers, last match wins. `bleed` fills the whole square (iOS and maskable icons get masked by the OS). */
function layers(bleed) {
	return [
		[bleed ? () => true : roundRect(0, 0, 64, 64, 14), BG],
		[roundRect(12, 12, 20, 20, 3), DARK],
		[roundRect(32, 32, 20, 20, 3), DARK],
		[roundRect(32, 12, 20, 20, 3), LIGHT],
		[roundRect(12, 32, 20, 20, 3), LIGHT],
		[circle(42, 42, 5), ACCENT]
	];
}

function render(size, bleed) {
	const S = 4;
	const shapes = layers(bleed);
	const px = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < S; sy++) {
				for (let sx = 0; sx < S; sx++) {
					const u = ((x + (sx + 0.5) / S) / size) * 64;
					const v = ((y + (sy + 0.5) / S) / size) * 64;
					let color = null;
					for (const [hit, c] of shapes) if (hit(u, v)) color = c;
					if (color) {
						r += color[0];
						g += color[1];
						b += color[2];
						a += 1;
					}
				}
			}
			const i = (y * size + x) * 4;
			px[i] = a ? Math.round(r / a) : 0;
			px[i + 1] = a ? Math.round(g / a) : 0;
			px[i + 2] = a ? Math.round(b / a) : 0;
			px[i + 3] = Math.round((255 * a) / (S * S));
		}
	}
	return png(size, px);
}

const CRC = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const out = new URL('../static/icons/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [name, size, bleed] of [
	['icon-192.png', 192, false],
	['icon-512.png', 512, false],
	['icon-maskable-512.png', 512, true],
	['apple-touch-icon.png', 180, true]
]) {
	const data = render(size, bleed);
	await writeFile(new URL(name, out), data);
	console.log(`${name}: ${size}x${size}, ${(data.length / 1024).toFixed(1)} KB`);
}
