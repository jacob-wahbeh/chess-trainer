// Drill cards: one per costly first mistake, scheduled with FSRS (https://github.com/open-spaced-repetition).
import type { Chess } from 'chessops/chess';
import { makeUci } from 'chessops/util';
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { positionKey } from '../chess/zobrist';
import type { Leak } from '../analysis/classify';
import { INACCURACY, MISTAKE, THEORY_MIN_GAMES, whiteCp, winPercent, type Eval, type Masters } from '../analysis/score';
import type { Color } from '../games/types';

export { Rating, State, type Grade };

export interface CardRecord {
	/** `${user}|${color}|${position key}|${wrong move}` */
	id: string;
	user: string;
	color: Color;
	key: number;
	/** The habitual move being trained away (chessops UCI). */
	wrong: string;
	/** Moves from the start to the position. */
	path: string[];
	/** Priority among new cards: game points lost to this first mistake. */
	points: number;
	/** Games where it was the first departure, when last synced. */
	first: number;
	created: number;
	/** First review (ms); counts toward the daily new-card limit. */
	introduced?: number;
	fsrs: Card;
	/** fsrs.due in ms, for sorting without Date objects. */
	due: number;
	suspended?: boolean;
}

/** Moves within this many win% of the best are accepted as correct. */
export const ACCEPT_DROP = 3;
/** Master moves at least this common are accepted when no evaluation of them exists. */
export const ACCEPT_MASTER_SHARE = 0.05;
/** Master main moves this common are accepted unless the engine calls them an inaccuracy. */
export const POPULAR_MASTER_SHARE = 0.1;

export const scheduler = fsrs({ enable_fuzz: true, request_retention: 0.9 });

/** Leaks worth a card: at least ~10 win% lost in total, or a single big mistake. */
const MIN_CARD_POINTS = 0.1;
export const cardWorthy = (leak: Leak) => leak.points >= MIN_CARD_POINTS || leak.drop >= MISTAKE;

export const cardId = (user: string, color: Color, key: number, wrong: string) => `${user.toLowerCase()}|${color}|${key}|${wrong}`;

export function newCard(leak: Leak, user: string, now = Date.now()): CardRecord {
	const card = createEmptyCard(new Date(now));
	return {
		id: cardId(user, leak.color, leak.key, leak.uci),
		user: user.toLowerCase(),
		color: leak.color,
		key: leak.key,
		wrong: leak.uci,
		path: leak.path,
		points: leak.points,
		first: leak.first,
		created: now,
		fsrs: card,
		due: now
	};
}

export interface Session {
	ids: string[];
	/** Practice once the scheduled cards are done: cards due later today, new cards past today's limit, then the rest. */
	extra: string[];
	due: number;
	fresh: number;
	total: number;
	/** Next time a card becomes due after this session (ms), if any. */
	nextDue?: number;
}

const startOfDay = (now: number, days = 0) => {
	const d = new Date(now);
	d.setHours(24 * days, 0, 0, 0);
	return d.getTime();
};

/** Due reviews first (most overdue first), then the costliest new cards up to today's remaining allowance. */
export function buildSession(cards: CardRecord[], newPerDay: number, now = Date.now()): Session {
	const active = cards.filter((c) => !c.suspended);
	const introducedToday = active.filter((c) => (c.introduced ?? 0) >= startOfDay(now)).length;
	const due = active.filter((c) => c.fsrs.state !== State.New && c.due <= now).sort((a, b) => a.due - b.due);
	const unseen = active.filter((c) => c.fsrs.state === State.New).sort((a, b) => b.points - a.points);
	const allowance = Math.max(0, newPerDay - introducedToday);
	const fresh = unseen.slice(0, allowance);
	const later = active.filter((c) => c.fsrs.state !== State.New && c.due > now).sort((a, b) => a.due - b.due);
	const tomorrow = startOfDay(now, 1);
	return {
		ids: [...due, ...fresh].map((c) => c.id),
		extra: [...later.filter((c) => c.due < tomorrow), ...unseen.slice(allowance), ...later.filter((c) => c.due >= tomorrow)].map((c) => c.id),
		due: due.length,
		fresh: fresh.length,
		total: active.length,
		nextDue: later[0]?.due
	};
}

/** A shuffled copy (Fisher-Yates): each session meets its cards in a new order. */
export function shuffled<T>(items: T[], random = Math.random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export function review(card: CardRecord, grade: Grade, now = Date.now()): CardRecord {
	const next = scheduler.next(card.fsrs, new Date(now), grade).card;
	return { ...card, fsrs: next, due: next.due.getTime(), introduced: card.introduced ?? now };
}

/** When each grade would schedule the card next (ms). */
export function previewDue(card: CardRecord, now = Date.now()): Record<Grade, number> {
	const p = scheduler.repeat(card.fsrs, new Date(now));
	return {
		[Rating.Again]: p[Rating.Again].card.due.getTime(),
		[Rating.Hard]: p[Rating.Hard].card.due.getTime(),
		[Rating.Good]: p[Rating.Good].card.due.getTime(),
		[Rating.Easy]: p[Rating.Easy].card.due.getTime()
	} as Record<Grade, number>;
}

export interface Answer {
	uci: string;
	/** Win% given away versus the best move, when known. */
	drop: number | null;
	share: number | null;
	why: 'engine' | 'sound' | 'book';
	/** Evaluation after the move (White's view), when known. */
	eval?: Eval;
}

/**
 * Moves accepted as correct at a position: the engine's choice, any move whose saved evaluation loses at
 * most ACCEPT_DROP, master main moves short of an inaccuracy, and common master moves that haven't been
 * evaluated. The habitual wrong move never counts.
 */
export function acceptedMoves(pos: Chess, key: number, wrong: string, evals: Map<number, Eval>, masters: Map<number, Masters>): Answer[] {
	const before = evals.get(key);
	const m = masters.get(key);
	const theory = m && m.total >= THEORY_MIN_GAMES ? m : undefined;
	const sign = pos.turn === 'white' ? 1 : -1;
	const base = before ? winPercent(sign * whiteCp(before)) : null;
	const out: Answer[] = [];
	for (const [from, dests] of pos.allDests()) {
		const pawn = pos.board.getRole(from) === 'pawn';
		for (const to of dests) {
			// Only queen promotions are drilled.
			const move = pawn && (to >> 3 === 7 || to >> 3 === 0) ? { from, to, promotion: 'queen' as const } : { from, to };
			const uci = makeUci(move);
			if (uci === wrong) continue;
			const share = theory ? (theory.moves[uci] ?? 0) / theory.total : null;
			const child = pos.clone();
			child.play(move);
			const after = evals.get(positionKey(child));
			if (before?.best === uci) {
				out.push({ uci, drop: 0, share, why: 'engine', eval: after ?? before });
				continue;
			}
			if (after && base !== null) {
				const drop = Math.max(0, base - winPercent(sign * whiteCp(after)));
				const popular = share !== null && share >= POPULAR_MASTER_SHARE && drop < INACCURACY;
				if (drop <= ACCEPT_DROP || popular) out.push({ uci, drop, share, why: share !== null && share >= 0.01 ? 'book' : 'sound', eval: after });
			} else if (share !== null && share >= ACCEPT_MASTER_SHARE) {
				out.push({ uci, drop: null, share, why: 'book' });
			}
		}
	}
	return out.sort((a, b) => (a.drop ?? 2) - (b.drop ?? 2) || (b.share ?? 0) - (a.share ?? 0));
}

/** Why a move is the one a drill holds up as the answer. */
export type MainWhy = 'thematic' | 'punish' | 'offbook' | 'engine';

/**
 * The answer a drill teaches. In book positions it's the masters' favourite among the accepted moves: it
 * carries the opening's plans, and small engine preferences between sound moves are noise. After the
 * opponent's inaccuracy, or out of book, it's the engine's choice: concrete play matters more there.
 */
export function mainMove(answers: Answer[], masters: Masters | undefined, punish: boolean): { uci: string; why: MainWhy } | undefined {
	const engine = answers.find((a) => a.why === 'engine') ?? answers[0];
	if (!engine) return undefined;
	if (punish) return { uci: engine.uci, why: 'punish' };
	let thematic: Answer | undefined;
	for (const a of answers) if ((a.share ?? 0) >= ACCEPT_MASTER_SHARE && (a.share ?? 0) > (thematic?.share ?? 0)) thematic = a;
	if (thematic) return { uci: thematic.uci, why: 'thematic' };
	return { uci: engine.uci, why: masters && masters.total < THEORY_MIN_GAMES ? 'offbook' : 'engine' };
}

/** Win% a move loses versus the position's evaluation (both from the mover's side); null if unknown. */
export function dropOf(pos: Chess, before: Eval | undefined, after: Eval | undefined): number | null {
	if (!before || !after) return null;
	const sign = pos.turn === 'white' ? 1 : -1;
	return Math.max(0, winPercent(sign * whiteCp(before)) - winPercent(sign * whiteCp(after)));
}

/** Grade from how the attempt went: any miss is a lapse; a quick, confident answer on a known card is Easy. */
export function autoGrade(a: { correctFirstTry: boolean; ms: number; state: State }): Grade {
	if (!a.correctFirstTry) return Rating.Again;
	if (a.state === State.Review && a.ms < 2500) return Rating.Easy;
	return Rating.Good;
}

export const isInaccuracy = (drop: number | null) => drop !== null && drop >= INACCURACY;
