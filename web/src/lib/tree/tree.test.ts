import { describe, expect, it } from 'vitest';
import { replaySans } from '../chess/pgn';
import { normalizeGame, isFinal, monthEnd, type RawGame } from '../games/chesscom';
import type { Game, Result } from '../games/types';
import { buildOpeningIndex, familyOf, groupLines } from './openings';
import { buildTree, mainLine, nodeView } from './tree';

function game(sans: string[], result: Result = 'win'): Game {
	const { ucis, keys } = replaySans(sans);
	return { id: '1', url: '', end: 0, timeClass: 'blitz', color: 'white', result, myRating: 0, oppRating: 0, opponent: '', ucis, keys };
}

const start = replaySans([]).keys[0];

describe('buildTree', () => {
	const games = [
		game(['e4', 'c5', 'Nf3', 'd6'], 'win'),
		game(['e4', 'c5', 'Nf3', 'Nc6'], 'loss'),
		game(['e4', 'e5'], 'draw'),
		game(['d4', 'd5'], 'win')
	];
	const tree = buildTree(games);

	it('counts games per position with results', () => {
		expect(nodeView(tree, start)).toMatchObject({ n: 4, w: 2, d: 1, l: 1 });
	});

	it('lists moves most common first', () => {
		const moves = nodeView(tree, start)!.moves;
		expect(moves.map((m) => [m.uci, m.n])).toEqual([
			['e2e4', 3],
			['d2d4', 1]
		]);
		expect(nodeView(tree, moves[0].to)).toMatchObject({ n: 3 });
	});

	it('follows the most common continuation', () => {
		expect(mainLine(tree, start, 16, 2)).toEqual(['e2e4', 'c7c5', 'g1f3']);
	});

	it('counts a game once even if it repeats a position', () => {
		const t = buildTree([game(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'])]);
		expect(nodeView(t, start)!.n).toBe(1);
	});
});

describe('openings', () => {
	const index = buildOpeningIndex([
		['B20', 'Sicilian Defense', 'e2e4 c7c5'],
		['B50', 'Sicilian Defense: Modern Variations', 'e2e4 c7c5 g1f3 d7d6'],
		['C20', "King's Pawn Game", 'e2e4 e7e5']
	]);

	it('extracts the family name', () => {
		expect(familyOf('Sicilian Defense: Najdorf Variation, English Attack')).toBe('Sicilian Defense');
	});

	it('groups games by deepest named line within families', () => {
		const families = groupLines(
			[game(['e4', 'c5', 'Nf3', 'd6', 'd4']), game(['e4', 'c5', 'Nc3']), game(['e4', 'e5']), game(['a3'])],
			index
		);
		expect(families.map((f) => [f.name, f.n])).toEqual([
			['Sicilian Defense', 2],
			["King's Pawn Game", 1],
			['Other', 1]
		]);
		expect(families[0].lines.map((l) => l.name).sort()).toEqual(['Sicilian Defense', 'Sicilian Defense: Modern Variations']);
		expect(families[0].ucis).toEqual(['e2e4', 'c7c5']);
	});
});

describe('normalizeGame', () => {
	const raw = (over: Partial<RawGame> = {}): RawGame => ({
		url: 'https://www.chess.com/game/live/123/',
		pgn: '[White "A"]\n\n1. e4 e5 2. Nf3 1-0',
		end_time: 1_700_000_000,
		time_class: 'blitz',
		rules: 'chess',
		white: { username: 'Draco_Jaco', rating: 1500, result: 'win' },
		black: { username: 'opp', rating: 1520, result: 'resigned' },
		...over
	});

	it('detects color case-insensitively and maps results', () => {
		expect(normalizeGame(raw(), 'draco_jaco')).toMatchObject({ id: '123', color: 'white', result: 'win', oppRating: 1520, ucis: ['e2e4', 'e7e5', 'g1f3'] });
		expect(normalizeGame(raw(), 'opp')).toMatchObject({ color: 'black', result: 'loss' });
		const draw = raw({ white: { username: 'a', rating: 1, result: 'repetition' }, black: { username: 'b', rating: 1, result: 'repetition' } });
		expect(normalizeGame(draw, 'b')!.result).toBe('draw');
	});

	it('skips variants', () => {
		expect(normalizeGame(raw({ rules: 'chess960' }), 'draco_jaco')).toBeNull();
	});
});

describe('month caching', () => {
	it('computes month ends and finality', () => {
		expect(new Date(monthEnd('2025-12') * 1000).toISOString()).toBe('2025-12-31T23:59:59.000Z');
		expect(isFinal('2025-12', monthEnd('2025-12') + 3 * 24 * 3600)).toBe(true);
		expect(isFinal('2025-12', monthEnd('2025-12') + 3600)).toBe(false);
	});
});
