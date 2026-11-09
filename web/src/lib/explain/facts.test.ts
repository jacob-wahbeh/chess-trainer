import { describe, expect, it } from 'vitest';
import type { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { continuation } from '../chess/line';
import { replaySans, replayUcis } from '../chess/pgn';
import { describeMaterial, explainFacts, findFork, materialSwing, passTurn } from './facts';

/** The position after `sans`, and an engine-style line from there given in SAN. */
function setup(sans: string[], line: string[] = []) {
	const path = replaySans(sans).ucis;
	const { pos } = replayUcis(path);
	return { pos, path, plies: continuation(pos, replaySans([...sans, ...line]).ucis.slice(sans.length)) };
}

/** SAN moves played from any position, as a line. */
function lineFrom(start: Chess, sans: string[]) {
	const pos = start.clone();
	const ucis = sans.map((san) => {
		const move = parseSan(pos, san)!;
		pos.play(move);
		return makeUci(move);
	});
	return continuation(start, ucis);
}

describe('materialSwing', () => {
	it('measures material once the captures settle', () => {
		const { pos, plies } = setup(['e4', 'e5', 'Nf3', 'Nc6'], ['Nxe5', 'Nxe5', 'd4', 'Nc6']);
		expect(materialSwing(pos, plies)).toEqual({ lost: ['knight'], won: ['pawn'], n: 2, mate: false });
	});

	it('spots a mate in the line', () => {
		const { pos, plies } = setup(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'], ['Qxf7#']);
		expect(materialSwing(pos, plies)).toMatchObject({ n: 1, mate: true });
	});
});

describe('describeMaterial', () => {
	it('names material the way players do', () => {
		expect(describeMaterial(['pawn'], [])).toBe('a pawn');
		expect(describeMaterial(['pawn', 'pawn'], [])).toBe('two pawns');
		expect(describeMaterial(['rook'], ['bishop'])).toBe('the exchange');
		expect(describeMaterial(['knight'], ['pawn'])).toBe('a knight for a pawn');
	});
});

describe('findFork', () => {
	it('finds the double attack in the Blackburne Shilling trap', () => {
		const { pos, plies } = setup(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'], ['Nxe5', 'Qg5', 'Nxf7', 'Qxg2']);
		expect(findFork(pos, plies)).toMatchObject({ n: 2, targets: ['knight on e5', 'pawn on g2'] });
	});
});

describe('passTurn', () => {
	it('gives the opponent a free move unless the player is in check', () => {
		expect(passTurn(setup(['e4', 'e5']).pos)?.turn).toBe('black');
		// Passing as Black: White's next move is the next move number.
		const asBlack = passTurn(setup(['e4', 'e5', 'Nf3']).pos)!;
		expect([asBlack.turn, asBlack.fullmoves]).toEqual(['white', 3]);
		expect(passTurn(setup(['e4', 'e5']).pos)!.fullmoves).toBe(2);
		expect(passTurn(setup(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'd6', 'Qxf7+']).pos)).toBeNull();
	});
});

describe('explainFacts', () => {
	it('explains a lost piece, the fork behind it, and what the right move does', () => {
		const { pos, path, plies: bad } = setup(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'], ['Nxe5', 'Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#']);
		const { plies: good } = setup(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'], ['Nxd4', 'exd4', 'O-O']);
		const facts = explainFacts({ pos, path, wrong: bad[0].uci, wrongLine: bad, main: good[0].uci, mainLine: good }).map((f) => f.text);
		expect(facts).toEqual(['4.Nxe5 allows mate: 4.Nxe5 Qg5 5.Nxf7 Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3#.']);
	});

	it('reports the material lost, from where it stays lost, and the fork that wins it', () => {
		const { pos, path, plies: bad } = setup(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'], ['Nxe5', 'Qg5', 'Bxf7+', 'Ke7', 'O-O', 'Qxe5', 'Bb3']);
		const facts = explainFacts({ pos, path, wrong: bad[0].uci, wrongLine: bad });
		expect(facts.map((f) => f.text)).toEqual([
			'4.Nxe5 loses a knight for two pawns: 4.Nxe5 Qg5 5.Bxf7+ Ke7 6.O-O Qxe5.',
			'4...Qg5 attacks the knight on e5 and the pawn on g2 at once.'
		]);
		expect(facts[0]).toMatchObject({ line: bad[0].uci, n: 6 });
		// Drawn on the board: where Black wins the knight, and the queen's two targets.
		expect(facts[0].shapes).toEqual([{ orig: 'e5', brush: 'red' }]);
		expect(facts[1].shapes).toEqual([
			{ orig: 'g5', dest: 'g2', brush: 'red' },
			{ orig: 'g5', dest: 'e5', brush: 'red' }
		]);
	});

	it('names a threat only when it wins material, and says when the habit allows it', () => {
		const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'd4', 'Bg4'];
		const { pos, path } = setup(moves);
		const threat = lineFrom(passTurn(pos)!, ['Nxd4', 'c3', 'Nxf3+', 'gxf3', 'Be6']);
		const allows = setup(moves, ['Nc3', 'Nxd4']).plies;
		const facts = (line: typeof allows) => explainFacts({ pos, path, wrong: line[0].uci, wrongLine: line, threat }).map((f) => f.text);
		expect(facts(allows)).toEqual(["Black threatens 5...Nxd4, winning a pawn, and 5.Nc3 doesn't stop it."]);
		expect(facts(setup(moves, ['dxe5', 'dxe5']).plies)).toEqual(['Black threatens 5...Nxd4, winning a pawn.']);
		// The threat captures at once, so one arrow shows it.
		expect(explainFacts({ pos, path, wrong: allows[0].uci, wrongLine: allows, threat })[0].shapes).toEqual([{ orig: 'c6', dest: 'd4', brush: 'red' }]);
		const quiet = lineFrom(passTurn(pos)!, ['Nf6', 'Nc3']);
		expect(explainFacts({ pos, path, wrong: allows[0].uci, wrongLine: allows, threat: quiet })).toEqual([]);
	});

	it('explains the Two Knights 5.Bxf7+ card: the weak f7 square, the king hunt, and the mate threat behind 5.Nxf7', () => {
		const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'Nxe4'];
		const { pos, path, plies: good } = setup(moves, ['Bxf7+', 'Ke7', 'd4', 'h6', 'Nxe4', 'Kxf7', 'd5', 'Nd4', 'c3', 'Nb5']);
		const bad = setup(moves, ['Nxf7', 'Qh4', 'Qe2', 'Nd4', 'g3', 'Nxe2', 'gxh4', 'Nd4', 'Nxh8', 'Nxc2+']).plies;
		const facts = explainFacts({ pos, path, wrong: bad[0].uci, wrongLine: bad, main: good[0].uci, mainLine: good });
		expect(facts.map((f) => [f.about, f.text])).toEqual([
			['wrong', '5...Qh4 threatens 6...Qxf2#.'],
			['main', 'f7 is attacked twice and defended only by the king.'],
			['main', '5.Bxf7+ wins a pawn.'],
			['main', '5.Bxf7+ drags the king out: after 5...Ke7 Black can no longer castle.']
		]);
		expect(facts.map((f) => f.shapes)).toEqual([
			// Shown after 5...Qh4: the queen's mate on f2.
			[{ orig: 'h4', dest: 'f2', brush: 'red' }],
			[
				{ orig: 'f7', brush: 'yellow' },
				{ orig: 'c4', dest: 'f7', brush: 'green' },
				{ orig: 'g5', dest: 'f7', brush: 'green' },
				{ orig: 'e8', dest: 'f7', brush: 'red' }
			],
			[{ orig: 'f7', brush: 'green' }],
			[{ orig: 'e7', brush: 'yellow' }]
		]);
	});

	it('draws a threat that needs a second move as two chained arrows', () => {
		// With a free move White would play 5.Ng5 and then take on f7.
		const { pos, path } = setup(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3']);
		const threat = lineFrom(passTurn(pos)!, ['Ng5', 'a6', 'Nxf7', 'Qe7', 'Nxh8']);
		const facts = explainFacts({ pos, path, wrong: 'a7a6', threat });
		expect(facts.map((f) => f.text)).toEqual(['White threatens 5.Ng5, winning a pawn.']);
		expect(facts[0].shapes).toEqual([
			{ orig: 'f3', dest: 'g5', brush: 'red' },
			{ orig: 'g5', dest: 'f7', brush: 'red' }
		]);
	});

	it('describes developing moves and principle-breaking habits', () => {
		const { pos, path, plies: bad } = setup(['e4', 'e5'], ['Qh5']);
		const { plies: good } = setup(['e4', 'e5'], ['Nf3']);
		const facts = explainFacts({ pos, path, wrong: bad[0].uci, wrongLine: bad, main: good[0].uci, mainLine: good });
		expect(facts.map((f) => f.text)).toEqual([
			'2.Qh5 brings the queen out with four minor pieces still at home.',
			'2.Nf3 develops the knight toward the centre and attacks the pawn on e5.'
		]);
		expect(facts.map((f) => f.shapes)).toEqual([
			[
				{ orig: 'd1', dest: 'h5', brush: 'red' },
				{ orig: 'b1', brush: 'yellow' },
				{ orig: 'g1', brush: 'yellow' },
				{ orig: 'c1', brush: 'yellow' },
				{ orig: 'f1', brush: 'yellow' }
			],
			[{ orig: 'f3', dest: 'e5', brush: 'green' }]
		]);
		const king = setup(['e4', 'e5'], ['Ke2']);
		expect(explainFacts({ pos, path, wrong: king.plies[0].uci, wrongLine: king.plies }).map((f) => f.text)).toEqual([
			'2.Ke2 gives up the right to castle.'
		]);
	});
});
