import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { chessgroundMove } from 'chessops/compat';
import { makeUci, parseUci } from 'chessops/util';
import type { Key } from 'chessground/types';
import { positionKey } from './zobrist';

export interface Ply {
	uci: string;
	san: string;
	/** Move number shown before White's moves ("1." / "1..."). */
	moveNumber: number;
	white: boolean;
}

export interface Walk {
	pos: Chess;
	plies: Ply[];
	/** Keys of every position on the path, starting with the initial one. */
	keys: number[];
	fen: string;
	lastMove?: Key[];
}

/** Replays a UCI path from the start; stops at the first illegal move. */
export function walk(ucis: string[]): Walk {
	const pos = Chess.default();
	const plies: Ply[] = [];
	const keys = [positionKey(pos)];
	let lastMove: Key[] | undefined;
	for (const uci of ucis) {
		const move = parseUci(uci);
		if (!move || !pos.isLegal(move)) break;
		plies.push({ uci, san: makeSan(pos, move), moveNumber: pos.fullmoves, white: pos.turn === 'white' });
		lastMove = chessgroundMove(move) as Key[];
		pos.play(move);
		keys.push(positionKey(pos));
	}
	return { pos, plies, keys, fen: makeFen(pos.toSetup()), lastMove };
}

export const sanOf = (pos: Chess, uci: string) => {
	const move = parseUci(uci);
	return move && pos.isLegal(move) ? makeSan(pos, move) : uci;
};

/** "1.e4 c5 2.Nf3", numbering continuing from where `plies` start. */
export function formatPlies(plies: Ply[]): string {
	return plies
		.map((p, i) => (p.white ? `${p.moveNumber}.${p.san}` : i === 0 ? `${p.moveNumber}...${p.san}` : p.san))
		.join(' ');
}

/** SAN for a continuation of UCI moves starting at `pos` (not modified). Accepts engine-style castling (e1g1). */
export function continuation(pos: Chess, ucis: string[]): Ply[] {
	const p = pos.clone();
	const plies: Ply[] = [];
	for (const raw of ucis) {
		const parsed = parseUci(raw);
		const move = parsed && normalizeMove(p, parsed);
		if (!move || !p.isLegal(move)) break;
		const uci = makeUci(move);
		plies.push({ uci, san: makeSan(p, move), moveNumber: p.fullmoves, white: p.turn === 'white' });
		p.play(move);
	}
	return plies;
}

/** Board states along a path: index 0 is the start, index i the position after i moves. */
export function positions(ucis: string[]): { fen: string; lastMove?: Key[] }[] {
	const pos = Chess.default();
	const out: { fen: string; lastMove?: Key[] }[] = [{ fen: makeFen(pos.toSetup()) }];
	for (const uci of ucis) {
		const move = parseUci(uci);
		if (!move || !pos.isLegal(move)) break;
		pos.play(move);
		out.push({ fen: makeFen(pos.toSetup()), lastMove: chessgroundMove(move) as Key[] });
	}
	return out;
}
