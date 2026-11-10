import { describe, expect, it } from 'vitest';
import type { Fact } from './facts';
import { replaySans, replayUcis } from '../chess/pgn';
import { notesFor, splitSentences, splitWritten, writtenLine } from './notes';

describe('notesFor', () => {
	const facts: Fact[] = [
		{ about: 'position', text: 'White threatens 6.Ndb5.', shapes: [{ orig: 'c3', dest: 'b5', brush: 'red' }] },
		{ about: 'wrong', text: '6.Ndb5 threatens 7.Nd6#.', line: 'g8e7', n: 2 },
		{ about: 'wrong', text: '5...Nge7 moves the knight a second time.' },
		{ about: 'main', text: '5...Qc7 develops the queen.', line: 'd8c7', n: 1 },
		{ about: 'main', text: 'd6 is covered twice.' }
	];

	it('puts each fact on its line and move, and the rest on the drill position', () => {
		const roles = { main: 'd8c7', wrong: 'g8e7' };
		expect(notesFor(facts, 'g8e7', roles).map((n) => [n.n, n.text])).toEqual([
			[0, 'White threatens 6.Ndb5.'],
			[0, '5...Nge7 moves the knight a second time.'],
			[2, '6.Ndb5 threatens 7.Nd6#.']
		]);
		expect(notesFor(facts, 'd8c7', roles).map((n) => [n.n, n.tone])).toEqual([
			[0, 'position'],
			[0, 'main'],
			[1, 'main']
		]);
		// Another line (a move tried in the review) only gets the facts about the position.
		expect(notesFor(facts, 'a7a6', roles).map((n) => n.text)).toEqual(['White threatens 6.Ndb5.']);
		expect(notesFor(facts, 'g8e7', roles)[0].shapes).toEqual([{ orig: 'c3', dest: 'b5', brush: 'red' }]);
	});
});

describe('splitWritten', () => {
	it('keeps move numbers inside a sentence', () => {
		expect(splitSentences('5...Nge7 shuts in the bishop. After 6.Ndb5 Black is worse. "Quoted" too.')).toEqual([
			'5...Nge7 shuts in the bishop.',
			'After 6.Ndb5 Black is worse.',
			'"Quoted" too.'
		]);
	});

	it('gives each sentence to the move it is about', () => {
		const why =
			'5...Nge7 shuts in the f8 bishop, the only piece guarding d6. After 6.Ndb5 White threatens mate on d6. ' +
			'5...Qc7 puts the queen on a safe square where it watches d6. Black follows with ...a6 and ...b5.';
		expect(splitWritten(why, 'Nge7', 'Qc7')).toEqual({
			wrong: ['5...Nge7 shuts in the f8 bishop, the only piece guarding d6.', 'After 6.Ndb5 White threatens mate on d6.'],
			main: ['5...Qc7 puts the queen on a safe square where it watches d6.', 'Black follows with ...a6 and ...b5.']
		});
	});

	it('matches whole moves only', () => {
		expect(splitWritten('O-O-O walks into the attack. O-O is safe.', 'O-O-O', 'O-O')).toEqual({
			wrong: ['O-O-O walks into the attack.'],
			main: ['O-O is safe.']
		});
		expect(splitWritten('Bxf7+ wins a pawn. Nxf7 loses.', 'Nxf7', 'Bxf7+').main).toEqual(['Bxf7+ wins a pawn.']);
	});
});

describe('writtenLine', () => {
	const pos = replayUcis(replaySans(['e4', 'e5', 'd4', 'Nc6']).ucis).pos;

	it('follows the moves the explanation names after the taught move', () => {
		const why =
			'3.c3 invites 3...d5, opening the centre while you are undeveloped. 3.dxe5, played by masters 43% of the time, ' +
			'liquidates the centre on your terms: the knight recaptures with 3...Nxe5, and after 4.Nc3 Bc5 5.f4 your pawn ' +
			'kicks it again with gain of space. The knight on e5 has to move.';
		expect(writtenLine(why, pos, 'd4e5')).toEqual(['d4e5', 'c6e5', 'b1c3', 'f8c5', 'f2f4']);
	});

	it('stops at a gap or an illegal move, and needs the taught move first', () => {
		expect(writtenLine('3.dxe5 Nxe5 5.f4', pos, 'd4e5')).toEqual(['d4e5', 'c6e5']);
		expect(writtenLine('3.dxe5 Nxe5 4.Qh8', pos, 'd4e5')).toEqual(['d4e5', 'c6e5']);
		expect(writtenLine('3.Nf3 and 4.Nc3', pos, 'd4e5')).toEqual([]);
	});
});
