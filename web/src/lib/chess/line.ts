import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { chessgroundMove } from 'chessops/compat';
import { parseUci } from 'chessops/util';
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

/** SAN for a continuation of UCI moves starting at `pos` (which is not modified). */
export function continuation(pos: Chess, ucis: string[]): Ply[] {
	const p = pos.clone();
	const plies: Ply[] = [];
	for (const uci of ucis) {
		const move = parseUci(uci);
		if (!move || !p.isLegal(move)) break;
		plies.push({ uci, san: makeSan(p, move), moveNumber: p.fullmoves, white: p.turn === 'white' });
		p.play(move);
	}
	return plies;
}
