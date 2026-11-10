// Explanations as notes on the moves of a drill card's lines, so the drill can show them on the board one move
// at a time instead of as paragraphs: computed facts go on the move they're about, and the written explanation is
// split into what it says about the habit and what it says about the taught move.
import type { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Fact, Shape } from './facts';

export interface Note {
	text: string;
	/** Whose idea it is: the taught move (green), the failing move (red), or the position (yellow). */
	tone: Fact['about'];
	/** The ply of the line it belongs on: 1 is the line's first move, 0 the drill position before it. */
	n: number;
	shapes?: Shape[];
}

/**
 * The facts that belong on the line starting with `key`, in move order. Facts tied to a line go on their ply;
 * the rest go on the drill position: facts about the position on every line, the others on their move's line.
 */
export function notesFor(facts: Fact[], key: string, roles: { main?: string; wrong?: string }): Note[] {
	return facts
		.filter((f) => (f.line !== undefined ? f.line === key : f.about === 'position' || roles[f.about] === key))
		.map((f) => ({ text: f.text, tone: f.about, n: f.line !== undefined && f.n ? f.n : 0, shapes: f.shapes }))
		.sort((a, b) => a.n - b.n);
}

/** Sentences of a written explanation. Move numbers ("5...Nge7", "6.Ndb5") never end one. */
export function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Whether a sentence mentions a move, as a whole token ("Qc7" in "5...Qc7," but not "O-O" in "O-O-O"). */
function mentions(sentence: string, san: string): boolean {
	const bare = san.replace(/[+#!?]+$/, '');
	if (!bare) return false;
	const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9]|-O)`).test(sentence);
}

/**
 * Splits a written "why" into the sentences about the habit and those about the taught move. Explanations
 * first say why the habit fails, then why the taught move is right, so a sentence naming only one of the two
 * moves belongs to it, and any other sentence goes with the one before it (the first with the habit).
 */
export function splitWritten(why: string, wrongSan: string, mainSan: string): { wrong: string[]; main: string[] } {
	const out = { wrong: [] as string[], main: [] as string[] };
	let side: 'wrong' | 'main' = 'wrong';
	for (const sentence of splitSentences(why)) {
		const w = mentions(sentence, wrongSan);
		const m = mentions(sentence, mainSan);
		if (m && !w) side = 'main';
		else if (w && !m) side = 'wrong';
		out[side].push(sentence);
	}
	return out;
}

/** A move in a written explanation: "5.f4", "3...Nxe5", or a bare "Bc5" right after another move ("4.Nc3 Bc5"). */
const MOVE = /(?<![A-Za-z0-9])(?:(\d+)(\.\.\.|\.)\s?)?(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#!?]*(?![A-Za-z0-9])/g;

/**
 * The line a written explanation walks through after the taught move ("3.dxe5 ... 3...Nxe5, and after 4.Nc3 Bc5
 * 5.f4"), as UCI moves from `pos`: starting with `first`, then each move the text names for the next ply, for as
 * long as they follow on and are legal. Moves named again later are skipped; a gap ends the line. A bare move only
 * counts right after another one, so "the knight on e5" isn't read as a move.
 */
export function writtenLine(text: string, pos: Chess, first: string): string[] {
	const start = (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1);
	const cur = pos.clone();
	const out: string[] = [];
	let expected = start;
	let prev: { end: number; ply: number } | null = null;
	for (const m of text.matchAll(MOVE)) {
		const [whole, number, dots, san] = m;
		const at = m.index ?? 0;
		let ply: number;
		if (number) ply = (Number(number) - 1) * 2 + (dots === '...' ? 1 : 0);
		else if (prev && /^\s+$/.test(text.slice(prev.end, at))) ply = prev.ply + 1;
		else {
			prev = null;
			continue;
		}
		prev = { end: at + whole.length, ply };
		if (!out.length) {
			if (ply !== start) continue;
			const move = parseSan(cur, san);
			if (!move || makeUci(move) !== first) continue;
			cur.play(move);
			out.push(first);
			expected++;
			continue;
		}
		if (ply < expected) continue;
		if (ply > expected) break;
		const move = parseSan(cur, san);
		if (!move) break;
		out.push(makeUci(move));
		cur.play(move);
		expected++;
	}
	return out;
}
