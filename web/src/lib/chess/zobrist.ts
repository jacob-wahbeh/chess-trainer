import type { Position } from 'chessops/chess';
import type { Role } from 'chessops/types';

// Position keys: a 53-bit Zobrist hash of board, side to move, castling rights and a *legal*
// en passant square (same notion of identity as python-chess's epd() and Lichess), so
// transpositions merge. The tables come from a fixed seed, so keys are stable everywhere.

const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const CASTLE = 12 * 64;
const EP = CASTLE + 64;
const TURN = EP + 8;
const SIZE = TURN + 1;

function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return (t ^ (t >>> 14)) >>> 0;
	};
}

const rand = mulberry32(0x5eed1e55);
const HI = new Uint32Array(SIZE).map(() => rand() & 0x1fffff);
const LO = new Uint32Array(SIZE).map(() => rand());

export function positionKey(pos: Position): number {
	let hi = 0;
	let lo = 0;
	const board = pos.board;
	for (let c = 0; c < 2; c++) {
		const color = c === 0 ? 'white' : 'black';
		for (let r = 0; r < 6; r++) {
			for (const sq of board.pieces(color, ROLES[r])) {
				const i = (c * 6 + r) * 64 + sq;
				hi ^= HI[i];
				lo ^= LO[i];
			}
		}
	}
	for (const sq of pos.castles.castlingRights) {
		hi ^= HI[CASTLE + sq];
		lo ^= LO[CASTLE + sq];
	}
	if (pos.epSquare !== undefined) {
		// toSetup() only reports the square when an en passant capture is actually legal.
		const ep = pos.toSetup().epSquare;
		if (ep !== undefined) {
			hi ^= HI[EP + (ep & 7)];
			lo ^= LO[EP + (ep & 7)];
		}
	}
	if (pos.turn === 'black') {
		hi ^= HI[TURN];
		lo ^= LO[TURN];
	}
	return hi * 0x100000000 + (lo >>> 0);
}
