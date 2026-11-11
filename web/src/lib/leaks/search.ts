import { sanOf, walk } from '$lib/chess/line';

/**
 * What a first mistake can be found by: its opening and its moves, the mistake included. Each move is written both
 * the way the app shows a line ("1.e4 c5 2.c3 d6") and on its own ("2...d6"), so either can be searched for.
 */
export function searchText(leak: { opening?: string | null; path: string[]; uci: string }): string {
	const line = walk(leak.path);
	const plies = [...line.plies, { san: sanOf(line.pos, leak.uci), moveNumber: line.pos.fullmoves, white: line.pos.turn === 'white' }];
	const shown = plies.map((p) => (p.white ? `${p.moveNumber}.${p.san}` : p.san)).join(' ');
	const own = plies.map((p) => `${p.moveNumber}${p.white ? '.' : '...'}${p.san}`).join(' ');
	return normalize(`${leak.opening ?? ''} ${shown} ${own}`);
}

/** Lower case, "…" as "...", no space after a move number ("3. c3" is "3.c3"), no check marks. */
export function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/…/g, '...')
		.replace(/(\d+\.(?:\.\.)?)\s+/g, '$1')
		.replace(/[+#!?]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Every word of the query appears in the text (made by `searchText`). */
export function matches(text: string, query: string): boolean {
	const words = normalize(query).split(' ').filter(Boolean);
	return words.every((w) => text.includes(w));
}
