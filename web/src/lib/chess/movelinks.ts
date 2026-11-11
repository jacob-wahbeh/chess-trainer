// Finds the chess moves written in explanation text ("3.dxe5", "3...Nxe5", "5.f4 Nc6", "...d5"), so the text can
// link each one to the board. Only notation is matched: a bare square in prose ("pawns on e4 and f4") is a move
// only when it directly follows another move ("3.c3 d5").

import type { Ply } from './line';

/** A move as written: its number when given, whose move it is, and the SAN without check marks. */
export interface WrittenMove {
	no: number | null;
	white: boolean;
	san: string;
}

export type Segment = { text: string; move?: WrittenMove };

const SAN = String.raw`(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?`;
/** "12.Nf3", "12...Nf6", "12…Nf6", or "...Nf6" / "…Nf6" without a number. */
const NUMBERED = new RegExp(String.raw`(?<![\w.…])(?:(\d+)(\.\.\.|…|\.)\s?|(\.\.\.|…))(${SAN})(?![\w-])`, 'g');
/** A bare move right after another: "5.f4 Nc6" (only whitespace between). */
const NEXT = new RegExp(String.raw`^(\s+)(${SAN})(?![\w-])`);

const clean = (san: string) => san.replace(/[+#!?]+$/, '');

/** Splits text into plain runs and written moves. */
export function findMoves(text: string): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	NUMBERED.lastIndex = 0;
	for (let m = NUMBERED.exec(text); m; m = NUMBERED.exec(text)) {
		if (m.index > last) out.push({ text: text.slice(last, m.index) });
		const no = m[1] ? Number(m[1]) : null;
		const white = m[2] === '.';
		let move: WrittenMove = { no, white, san: clean(m[4]) };
		out.push({ text: m[0], move });
		let end = m.index + m[0].length;
		// Moves that follow without numbers: White's then Black's of the same number, Black's then White's next.
		for (let n = NEXT.exec(text.slice(end)); n && move.no !== null; n = NEXT.exec(text.slice(end))) {
			const next: WrittenMove = move.white ? { no: move.no, white: false, san: clean(n[2]) } : { no: move.no + 1, white: true, san: clean(n[2]) };
			out.push({ text: n[1] }, { text: n[2], move: next });
			move = next;
			end += n[0].length;
		}
		last = end;
		NUMBERED.lastIndex = end;
	}
	if (last < text.length) out.push({ text: text.slice(last) });
	return out;
}

/** The index (0-based) of a written move in a list of plies, or -1. A move without a number matches by side and SAN. */
export function plyIndex(plies: Ply[], move: WrittenMove): number {
	return plies.findIndex((p) => p.white === move.white && clean(p.san) === move.san && (move.no === null || p.moveNumber === move.no));
}
