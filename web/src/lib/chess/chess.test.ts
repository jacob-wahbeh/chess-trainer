import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { pgnSans, replaySans, replayUcis } from './pgn';
import { positionKey } from './zobrist';

const keyOfFen = (fen: string) => positionKey(Chess.fromSetup(parseFen(fen).unwrap()).unwrap());
const keyAfter = (sans: string[]) => replaySans(sans).keys.at(-1)!;

describe('positionKey', () => {
	it('merges transpositions', () => {
		expect(keyAfter(['Nf3', 'd5', 'd4'])).toBe(keyAfter(['d4', 'd5', 'Nf3']));
	});

	it('distinguishes side to move', () => {
		expect(keyOfFen('8/8/8/8/8/8/8/K6k w - - 0 1')).not.toBe(keyOfFen('8/8/8/8/8/8/8/K6k b - - 0 1'));
	});

	it('distinguishes castling rights', () => {
		const start = keyAfter([]);
		const lostRights = keyAfter(['e4', 'e5', 'Ke2', 'Ke7', 'Ke1', 'Ke8', 'e4']);
		expect(lostRights).not.toBe(keyAfter(['e4', 'e5']));
		expect(start).not.toBe(lostRights);
	});

	it('ignores an en passant square that cannot be captured', () => {
		// After 1.e4 no black pawn can take en passant, so the key equals the FEN without it.
		expect(keyAfter(['e4'])).toBe(keyOfFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));
	});

	it('keeps an en passant square that can be captured', () => {
		const sans = ['e4', 'Nf6', 'e5', 'd5'];
		const withEp = 'rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
		const withoutEp = 'rnbqkb1r/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3';
		expect(keyAfter(sans)).toBe(keyOfFen(withEp));
		expect(keyAfter(sans)).not.toBe(keyOfFen(withoutEp));
	});

	it('produces safe integers', () => {
		const key = keyAfter(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
		expect(Number.isSafeInteger(key)).toBe(true);
	});
});

const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "draco_jaco"]
[Black "someone"]
[Result "1-0"]

1. e4 {[%clk 0:02:59.9]} 1... c5 {[%clk 0:02:59.1]} 2. Nf3 {[%clk 0:02:58.2]} 2... d6
{[%clk 0:02:57.5]} 3. d4 {[%clk 0:02:57.0]} 3... cxd4 {[%clk 0:02:56.1]} 4. O-O-O 1-0
`;

describe('pgnSans', () => {
	it('strips headers, clocks, move numbers and the result', () => {
		expect(pgnSans(CHESSCOM_PGN)).toEqual(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'O-O-O']);
	});

	it('respects the ply limit', () => {
		expect(pgnSans(CHESSCOM_PGN, 3)).toEqual(['e4', 'c5', 'Nf3']);
	});
});

describe('replaySans / replayUcis', () => {
	it('stops at the first illegal move', () => {
		const { ucis, keys } = replaySans(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'O-O-O']);
		expect(ucis).toEqual(['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4']);
		expect(keys).toHaveLength(7);
	});

	it('round-trips through UCI, including castling', () => {
		const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'];
		const { ucis, keys } = replaySans(sans);
		expect(ucis.at(-1)).toBe('e1h1'); // chessops encodes castling as king-takes-rook
		expect(replayUcis(ucis).keys).toEqual(keys);
	});
});
