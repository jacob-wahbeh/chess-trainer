// Drill cards: one per costly first mistake. Each keeps a streak of first-try answers: three in a row and it's
// known, a miss resets it, and so does repeating the mistake in a real game. The drill goes through the whole
// deck in order of need (buildDeck); there are no dates or intervals.
import type { Chess } from 'chessops/chess';
import { makeUci } from 'chessops/util';
import { positionKey } from '../chess/zobrist';
import type { Leak } from '../analysis/classify';
import { INACCURACY, MISTAKE, THEORY_MIN_GAMES, whiteCp, winPercent, type Eval, type Masters } from '../analysis/score';
import type { Color } from '../games/types';

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
	/** The first and the latest game where it was the first departure (ms). */
	since: number;
	last: number;
	created: number;
	/** First-try answers in a row; a miss resets it. */
	streak: number;
	/** Times drilled (only the first time a card comes up in a sitting counts). */
	seen: number;
	/** When it was last drilled (ms). */
	lastSeen?: number;
	/** The last time it was drilled was a miss. */
	missed?: boolean;
	/** The mistake came up again in a game played after the card was last drilled (that game's end, ms). */
	playedAgain?: number;
	suspended?: boolean;
}

/** Moves within this many win% of the best are accepted as correct. */
export const ACCEPT_DROP = 3;
/** Master moves at least this common are accepted when no evaluation of them exists. */
export const ACCEPT_MASTER_SHARE = 0.05;
/** Master main moves this common are accepted unless the engine calls them an inaccuracy. */
export const POPULAR_MASTER_SHARE = 0.1;
/** First-try answers in a row that make a card known. */
export const KNOWN_STREAK = 3;
/** A mistake you first made this recently counts as new from your recent games. */
export const RECENT_MS = 14 * 86_400_000;
/** One known card is mixed in after this many others, so known cards stay fresh. */
const KNOWN_EVERY = 8;
/** Cards within a group are shuffled in blocks this big: roughly in order of need, but never the same order. */
const SHUFFLE_BLOCK = 10;
/**
 * A card missed this recently waits behind the new cards from recent games: the sitting already brought it back
 * for practice, so reopening the app shouldn't start with it again.
 */
export const COOLDOWN_MS = 30 * 60_000;

/** Leaks worth a card: at least ~10 win% lost in total, or a single big mistake. */
const MIN_CARD_POINTS = 0.1;
export const cardWorthy = (leak: Leak) => leak.points >= MIN_CARD_POINTS || leak.drop >= MISTAKE;

export const cardId = (user: string, color: Color, key: number, wrong: string) => `${user.toLowerCase()}|${color}|${key}|${wrong}`;

export function newCard(leak: Leak, user: string, now = Date.now()): CardRecord {
	return {
		id: cardId(user, leak.color, leak.key, leak.uci),
		user: user.toLowerCase(),
		color: leak.color,
		key: leak.key,
		wrong: leak.uci,
		path: leak.path,
		points: leak.points,
		first: leak.first,
		since: leak.since * 1000,
		last: leak.last * 1000,
		created: now,
		streak: 0,
		seen: 0
	};
}

/**
 * A card brought up to date with the latest analysis of your games. Repeating the mistake in a game played after
 * the card was last drilled sends it back to the start: streak 0, at the front of the deck.
 */
export function refreshCard(card: CardRecord, leak: Leak): CardRecord {
	const next: CardRecord = { ...card, points: leak.points, first: leak.first, since: leak.since * 1000, last: leak.last * 1000 };
	if (card.seen && card.lastSeen !== undefined && next.last > card.lastSeen && next.last !== card.playedAgain) {
		next.playedAgain = next.last;
		next.streak = 0;
	}
	return next;
}

export type Status = 'new' | 'learning' | 'known';
export const statusOf = (card: CardRecord): Status => (!card.seen ? 'new' : card.streak >= KNOWN_STREAK ? 'known' : 'learning');
const isRecent = (card: CardRecord, now: number) => !card.seen && card.since >= now - RECENT_MS;

/** A drill result: right or wrong the first time the card came up in a sitting. */
export function recordAnswer(card: CardRecord, correct: boolean, now = Date.now()): CardRecord {
	return { ...card, streak: correct ? card.streak + 1 : 0, seen: card.seen + 1, lastSeen: now, missed: !correct, playedAgain: undefined };
}

export interface Deck {
	/** Every card to drill, in order of need. */
	ids: string[];
	/** Mistakes repeated in a game after drilling them, cards missed last time, and new ones from recent games. */
	playedAgain: number;
	missed: number;
	recent: number;
	/** By status (new includes the recent ones). */
	fresh: number;
	learning: number;
	known: number;
	total: number;
}

/**
 * The whole deck in order of need: mistakes you played again in a game, cards you missed last time, new mistakes
 * from your recent games (costliest first), cards missed in the last half hour, cards you're learning (the one
 * practised longest ago first), older new cards (costliest first), and known cards, one mixed in every few cards
 * so they stay fresh.
 */
export function buildDeck(cards: CardRecord[], now = Date.now(), random = Math.random, order: 'need' | 'random' = 'need'): Deck {
	const active = cards.filter((c) => !c.suspended);
	const leastRecent = (a: CardRecord, b: CardRecord) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0);
	const costliest = (a: CardRecord, b: CardRecord) => b.points - a.points;
	const again = active.filter((c) => c.playedAgain).sort((a, b) => b.playedAgain! - a.playedAgain!);
	const rest = active.filter((c) => !c.playedAgain);
	const missed = rest.filter((c) => c.seen && c.missed).sort(leastRecent);
	const cooling = (c: CardRecord) => (c.lastSeen ?? 0) > now - COOLDOWN_MS;
	const recent = rest.filter((c) => isRecent(c, now)).sort(costliest);
	const learning = rest.filter((c) => statusOf(c) === 'learning' && !c.missed).sort(leastRecent);
	const older = rest.filter((c) => !c.seen && !isRecent(c, now)).sort(costliest);
	const known = rest.filter((c) => statusOf(c) === 'known' && !c.missed).sort(leastRecent);
	const mix = (group: CardRecord[]) => group.flatMap((_, i) => (i % SHUFFLE_BLOCK ? [] : shuffled(group.slice(i, i + SHUFFLE_BLOCK), random)));
	const main = [again, missed.filter((c) => !cooling(c)), recent, missed.filter(cooling), learning, older].flatMap(mix);
	const ids: string[] = [];
	const k = mix(known);
	for (let i = 0; i < main.length; i++) {
		ids.push(main[i].id);
		if ((i + 1) % KNOWN_EVERY === 0 && k.length) ids.push(k.shift()!.id);
	}
	ids.push(...k.map((c) => c.id));
	return {
		// Random order: every card shuffled, ignoring need (the counts still describe the deck).
		ids: order === 'random' ? shuffled(active, random).map((c) => c.id) : ids,
		playedAgain: again.length,
		missed: missed.length,
		recent: recent.length,
		fresh: active.filter((c) => !c.seen).length,
		learning: active.filter((c) => statusOf(c) === 'learning').length,
		known: active.filter((c) => statusOf(c) === 'known').length,
		total: active.length
	};
}

/** A shuffled copy (Fisher-Yates). */
export function shuffled<T>(items: T[], random = Math.random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
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

export const isInaccuracy = (drop: number | null) => drop !== null && drop >= INACCURACY;
