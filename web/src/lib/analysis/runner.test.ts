import { describe, expect, it } from 'vitest';
import { replaySans } from '../chess/pgn';
import { parseInfo } from '../engine/uci';
import { chessopsUci, evalsFromCloud, terminalEval } from './runner';
import { replayUcis } from '../chess/pgn';

const posAfter = (sans: string[]) => replayUcis(replaySans(sans).ucis).pos;
const keyAfter = (sans: string[]) => replaySans(sans).keys.at(-1)!;

describe('chessopsUci', () => {
	it('converts standard castling notation and rejects illegal moves', () => {
		const pos = posAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
		expect(chessopsUci(pos, 'e1g1')).toBe('e1h1');
		expect(chessopsUci(pos, 'e1h1')).toBe('e1h1');
		expect(chessopsUci(pos, 'e1c1')).toBeUndefined();
		expect(chessopsUci(pos, undefined)).toBeUndefined();
	});
});

describe('evalsFromCloud', () => {
	it('evaluates the position and the positions after each candidate move', () => {
		const pos = posAfter(['e4', 'c5', 'Nf3']);
		const out = new Map(
			evalsFromCloud(pos, {
				depth: 40,
				pvs: [
					{ moves: ['d7d6', 'd2d4'], cp: 24 },
					{ moves: ['b8c6', 'd2d4'], cp: 25 },
					{ moves: ['e7e6'], mate: -3 }
				]
			})
		);
		expect(out.get(keyAfter(['e4', 'c5', 'Nf3']))).toEqual({ cp: 24, mate: undefined, best: 'd7d6', depth: 40, src: 'cloud' });
		expect(out.get(keyAfter(['e4', 'c5', 'Nf3', 'Nc6']))).toMatchObject({ cp: 25, best: 'd2d4' });
		expect(out.get(keyAfter(['e4', 'c5', 'Nf3', 'e6']))).toMatchObject({ mate: -3, best: undefined });
		expect(out.size).toBe(4);
	});
});

describe('terminalEval', () => {
	it('scores checkmate for the winner and stalemate as a draw', () => {
		expect(terminalEval(posAfter(['f3', 'e5', 'g4', 'Qh4#']))).toMatchObject({ cp: -100000, src: 'terminal' });
		expect(terminalEval(posAfter(['e4']))).toBeUndefined();
	});
});

describe('parseInfo', () => {
	it('reads scores and principal variations, ignoring bound scores', () => {
		expect(parseInfo('info depth 16 seldepth 22 multipv 1 score cp -34 nodes 120000 nps 800000 pv e7e5 g1f3')).toEqual({
			depth: 16,
			cp: -34,
			pv: ['e7e5', 'g1f3'],
			nodes: 120000
		});
		expect(parseInfo('info depth 12 score mate 3 nodes 10 pv d1h5')).toMatchObject({ mate: 3 });
		expect(parseInfo('info depth 16 score cp 20 lowerbound nodes 5 pv e2e4')).toBeNull();
		expect(parseInfo('info string NNUE evaluation enabled')).toBeNull();
	});
});
