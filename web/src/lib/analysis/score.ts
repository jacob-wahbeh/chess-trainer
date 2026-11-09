// Move judgement, calibrated in docs/web-app-plan.md. Win% and thresholds follow Lichess (same as trainer/engine.py).

export type Label = 'book' | 'repertoire' | 'offbook' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder';

/** Win-chance drop (percentage points, mover's view) for each engine label. */
export const INACCURACY = 5;
export const MISTAKE = 10;
export const BLUNDER = 15;
/** A position counts as master theory with at least this many master games... */
export const THEORY_MIN_GAMES = 20;
/** ...and a move is book when masters play it in at least this share of them. */
export const BOOK_MIN_SHARE = 0.01;
/** An off-book but sound move you pick this consistently is a deliberate repertoire choice. */
export const REPERTOIRE_MIN_SHARE = 0.7;

/** Labels that make a move the "first departure" of a game. */
export const DEPARTURES = new Set<Label>(['inaccuracy', 'mistake', 'blunder', 'offbook']);

export function winPercent(cp: number): number {
	const c = Math.max(-1000, Math.min(1000, cp));
	return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

export function engineLabel(drop: number): Label | null {
	if (drop >= BLUNDER) return 'blunder';
	if (drop >= MISTAKE) return 'mistake';
	if (drop >= INACCURACY) return 'inaccuracy';
	return null;
}

export interface Eval {
	/** Centipawns, White's point of view. */
	cp?: number;
	/** Moves to mate, White's point of view (positive: White mates). */
	mate?: number;
	/** Best move, chessops UCI (castling as king-takes-rook). */
	best?: string;
	depth: number;
	src: 'cloud' | 'local' | 'terminal';
}

/** Master games per move at a position (moves in chessops UCI). */
export interface Masters {
	total: number;
	moves: Record<string, number>;
}

/** An evaluation as an eval bar shows it, from White's point of view: "+0.45", "−1.21", "#3", "−#2". */
export function formatEval(e: Eval | undefined): string {
	if (!e) return '?';
	if (e.mate !== undefined) return `${e.mate < 0 ? '−' : ''}#${Math.abs(e.mate)}`;
	const cp = e.cp ?? 0;
	if (Math.abs(cp) >= 100000) return cp > 0 ? '#' : '−#';
	const v = cp / 100;
	return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

/** Centipawns from White's point of view, mates mapped beyond the win% clamp. */
export function whiteCp(e: Eval): number {
	if (e.mate !== undefined) return e.mate > 0 ? 100000 : -100000;
	return e.cp ?? 0;
}
