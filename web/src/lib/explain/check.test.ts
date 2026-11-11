import { describe, expect, it } from 'vitest';
import { makeFen } from 'chessops/fen';
import { replayUcis } from '../chess/pgn';
import { checkExplanation, linkWarnings, sourceLink, type ExportCard } from './check';

// 1.e4 e5 2.Nf3 Bc5: the habit 3.Bc4 against the taught 3.Nxe5.
const path = ['e2e4', 'e7e5', 'g1f3', 'f8c5'];
const card: ExportCard = {
	id: '1|f1c4',
	color: 'white',
	moves: '1.e4 e5 2.Nf3 Bc5',
	fen: makeFen(replayUcis(path).pos.toSetup()),
	eval: '+1.20',
	habit: { move: '3.Bc4', label: 'mistake', evalAfter: '+0.30', winChanceLost: 15, firstMistakeInGames: 22, refutation: '3.Bc4 Nf6' },
	taught: { move: '3.Nxe5', reason: 'punish', line: '3.Nxe5 Qe7 4.Nf3 Qxe4+', evalAfter: '+1.20', mastersShare: null },
	accepted: [],
	opponentLastMove: { move: '2...Bc5', evalBefore: '+0.30', winChanceLost: 15 },
	threat: null,
	masters: null,
	facts: [],
	theory: [{ about: 'this position', page: 'Chess Opening Theory/1. e4/1...e5/2. Nf3/2...Bc5', text: 'White wins a pawn: 3. Nxe5 Qe7 4. d4! is strong. Later Bd3 helps.' }],
	check: { path, lines: [['f3e5', 'd8e7', 'e5f3', 'e7e4'], ['f1c4', 'g8f6']], threat: [] }
};
const explanation = (why: string) => ({ headline: 'Take the e5 pawn', why, principle: 'Grab a pawn your opponent leaves loose.', principleId: 'loose-pieces' });

describe('checkExplanation', () => {
	it('checks the ideas\' arrows and squares, and that lines name an existing idea', () => {
		const idea = { title: 'Hit f7', side: 'you' as const, text: 'Aim at f7.', arrows: ['c5f2'], squares: ['f7'] };
		const other = { title: 'Develop', side: 'both' as const, text: 'Bring the pieces out.' };
		expect(checkExplanation(card, { ...explanation('Take it.'), ideas: [idea, other], taught: { why: 'Take it.', enforces: { idea: 'Hit f7', text: 'It does.' } } })).toEqual([]);
		expect(
			checkExplanation(card, {
				...explanation('Take it.'),
				ideas: [{ ...idea, arrows: ['c4c4', 'c4-f7', 'd4d5'], squares: ['i9'] }, other],
				habit: { why: 'Slow.', strays: { idea: 'Hit f2', text: 'No.' } }
			})
		).toEqual([
			'idea "Hit f7": arrow c4c4 must be two different squares like e2e4',
			'idea "Hit f7": arrow c4-f7 must be two different squares like e2e4',
			'idea "Hit f7": arrow d4d5 starts on an empty square in the drill position',
			'idea "Hit f7": square i9 must look like f7',
			'"Hit f2" is not one of the ideas\' titles'
		]);
	});

	it('checks the alternatives against the common moves, and keeps the taught move out of before texts', () => {
		const ideas = [
			{ title: 'Centre', side: 'you' as const, text: 'Take the centre.' },
			{ title: 'Develop', side: 'both' as const, text: 'Bring the pieces out.' }
		];
		const given = [
			{ uci: 'd2d4', label: 'sound', lineUcis: ['d2d4', 'c5d4'] },
			{ uci: 'b1c3', label: 'inaccuracy', lineUcis: ['b1c3', 'g8f6'] }
		];
		const alt = (uci: string, label: string, before: string) => ({ uci, label, before, after: 'Later.', idea: 'Centre' });
		expect(checkExplanation(card, { ...explanation('Take it.'), ideas, alternatives: [alt('d2d4', 'sound', 'After 3.d4 Bxd4 the centre opens.'), alt('b1c3', 'inaccuracy', 'Slow.')] }, given)).toEqual([]);
		expect(
			checkExplanation(card, { ...explanation('Take it.'), ideas, alternatives: [alt('d2d4', 'inaccuracy', 'Better is 3.Nxe5, and Nf6 follows.')] }, given)
		).toEqual([
			'alternative d2d4: before names the taught move Nxe5; it shows while the player is still looking for it',
			'alternative d2d4: label must be "sound", as given',
			'alternative b1c3 (inaccuracy) has no written entry'
		]);
		expect(linkWarnings({ alternatives: [alt('d2d4', 'sound', 'After 3.d4 Bxd4 4.Nxd4, Nf6 follows.')] })).toEqual([
			'write Nf6 with its move number ("5.Nf6" or "5...Nf6") so it links to the board'
		]);
	});

	it('passes moves and pieces that appear in the lines', () => {
		expect(checkExplanation(card, explanation('2...Bc5 leaves the e5 pawn loose, so 3.Nxe5 takes it; after 3...Qe7 4.Nf3 Qxe4+ the bishop on c5 is still out of play.'))).toEqual([]);
	});

	it('flags moves and pieces that are not in the lines', () => {
		expect(checkExplanation(card, explanation('Instead 3.d4 and Nd5 hit the knight on c3, and Bc4 develops.'))).toEqual([
			'3.d4 is not a move in the card\'s lines',
			'Nd5 is not a move in the card\'s lines',
			'no knight stands on c3 in the position or its lines'
		]);
	});

	it('checks numbered moves against the move they were played at', () => {
		expect(checkExplanation(card, explanation('3...Qe7 and 4.Nf3 are in the line, but 4...Qe7 and 3.Nf3 are not.'))).toEqual([
			"4...Qe7 is not a move in the card's lines",
			"3.Nf3 is not a move in the card's lines"
		]);
		expect(checkExplanation(card, explanation('Later 5.Nf3 would be wrong.'))).toEqual(["5.Nf3 is not a move in the card's lines"]);
	});

	it('accepts moves quoted in the theory notes, at the move they are quoted for', () => {
		expect(checkExplanation(card, explanation('Theory recommends 4.d4 after 3...Qe7, and Bd3 later.'))).toEqual([]);
		expect(checkExplanation(card, explanation('Theory recommends 5.d4.'))).toEqual(["5.d4 is not a move in the card's lines"]);
	});

	it('rejects evaluation numbers but not masters percentages', () => {
		expect(checkExplanation(card, explanation('3.Nxe5 is played in 68.1% of master games.'))).toEqual([]);
		expect(checkExplanation(card, explanation('After 3.Nxe5 the eval is +1.94, against −0.48 or 0.00.'))).toEqual([
			'leave out evaluation numbers like +1.94; the app shows its own evals above the text',
			'leave out evaluation numbers like −0.48; the app shows its own evals above the text',
			'leave out evaluation numbers like 0.00; the app shows its own evals above the text'
		]);
	});

	it('rejects malformed answers and unknown principles', () => {
		expect(checkExplanation(card, { headline: 'x' })).toEqual(['needs string fields headline, why and principle']);
		expect(checkExplanation(card, { ...explanation('Fine.'), principleId: 'vibes' })[0]).toMatch(/^principleId must be one of: centre, /);
	});
});

describe('sourceLink', () => {
	it('links Wikibooks pages by their last move and URLs by host', () => {
		expect(sourceLink('Chess Opening Theory/1. e4/1...e5/2. Nf3/2...Bc5')).toEqual({
			label: 'Wikibooks, 2...Bc5',
			url: 'https://en.wikibooks.org/wiki/Chess_Opening_Theory/1._e4/1...e5/2._Nf3/2...Bc5'
		});
		expect(sourceLink('https://www.chess.com/article/view/x')).toEqual({ label: 'chess.com', url: 'https://www.chess.com/article/view/x' });
		expect(sourceLink('Reuben Fine, The Ideas Behind the Chess Openings')).toEqual({ label: 'Reuben Fine, The Ideas Behind the Chess Openings' });
	});
});
