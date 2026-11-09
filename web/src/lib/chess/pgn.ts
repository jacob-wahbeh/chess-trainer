import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';
import { positionKey } from './zobrist';

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** SAN tokens of a PGN's mainline, up to `limit` plies. Handles Chess.com's {[%clk ...]} comments. */
export function pgnSans(pgn: string, limit = Infinity): string[] {
	const blank = pgn.search(/\n\s*\n/);
	const text = (blank >= 0 ? pgn.slice(blank) : pgn)
		.replace(/\{[^}]*\}/g, ' ')
		.replace(/\([^)]*\)/g, ' ')
		.replace(/\$\d+/g, ' ');
	const sans: string[] = [];
	for (const raw of text.split(/\s+/)) {
		const token = raw.replace(/^\d+\.+/, '');
		if (!token || RESULTS.has(token)) continue;
		sans.push(token);
		if (sans.length >= limit) break;
	}
	return sans;
}

export interface Replayed {
	ucis: string[];
	/** Position keys before each move plus the final position: length ucis.length + 1. */
	keys: number[];
}

/** Plays SAN moves from the initial position, stopping at the first illegal or unparsable one. */
export function replaySans(sans: string[]): Replayed {
	const pos = Chess.default();
	const ucis: string[] = [];
	const keys = [positionKey(pos)];
	for (const san of sans) {
		const move = parseSan(pos, san);
		if (!move) break;
		ucis.push(makeUci(move));
		pos.play(move);
		keys.push(positionKey(pos));
	}
	return { ucis, keys };
}

/** The position after UCI moves from the start (illegal moves are ignored), and each move's key. */
export function replayUcis(ucis: string[]): { pos: Chess; keys: number[] } {
	const pos = Chess.default();
	const keys = [positionKey(pos)];
	for (const uci of ucis) {
		const move = parseUci(uci);
		if (!move || !pos.isLegal(move)) break;
		pos.play(move);
		keys.push(positionKey(pos));
	}
	return { pos, keys };
}
