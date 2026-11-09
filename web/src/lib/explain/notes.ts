// Explanations as notes on the moves of a drill card's lines, so the drill can show them on the board one move
// at a time instead of as paragraphs: computed facts go on the move they're about, and the written explanation is
// split into what it says about the habit and what it says about the taught move.
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
