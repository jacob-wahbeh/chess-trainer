// Written explanations (static/explanations.json) and the guardrail they pass before the app shows them:
// every move they mention must appear in the card's own lines, and every "piece on square" must exist.
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { makeSquare, parseSquare, parseUci } from 'chessops/util';
import { findMoves } from '../chess/movelinks';
import type { MainWhy } from '../drill/cards';
import type { Color } from '../games/types';
import { passTurn } from './facts';
import { principleById } from './principles';

/** A written explanation, keyed `${position key}|${habit}` like ExportCard.id. */
export interface Explanation {
	headline: string;
	why: string;
	/** The principle applied to this position... */
	principle: string;
	/** ...and the foundational one it comes from (principles.ts). */
	principleId: string;
	themes?: string[];
	/** What it draws on: Wikibooks page titles ("Chess Opening Theory/1. e4/..."), URLs, or "Label | URL". */
	sources?: string[];
	/** The opening's main ideas, researched (docs/opening-ideas-pipeline.md). Shown once the answer is. */
	ideas?: {
		title: string;
		side: 'you' | 'opponent' | 'both';
		text: string;
		/** Optional, for drawing the idea on the drill position: arrows as from-to squares ("e2e4"), and squares ("f7"). */
		arrows?: string[];
		squares?: string[];
	}[];
	/** Why the habit is worse, and which idea it neglects. Replaces splitting `why` when present. */
	habit?: { why: string; strays?: IdeaLink };
	/** Why the taught move is right, and which idea it carries out. */
	taught?: { why: string; enforces?: IdeaLink };
	/**
	 * Other common moves here (club or master): `before` is shown as soon as one is played and never names the
	 * taught move; `after` once the taught move is found or shown.
	 */
	alternatives?: { uci: string; label: string; before: string; after: string; idea?: string }[];
}

/** An opening idea (by title) and a short line on how a move relates to it. */
export interface IdeaLink {
	idea: string;
	text: string;
}

/** Everything the explanation writer gets for a card (scripts/export-cards.ts). */
export interface ExportCard {
	id: string;
	color: Color;
	opening?: string;
	/** "1.e4 e5 2.Nf3 Bc5" */
	moves: string;
	fen: string;
	/** Evaluation of the position, White's view ("+0.45"). */
	eval: string;
	habit: { move: string; label: string; evalAfter: string; winChanceLost: number; firstMistakeInGames: number; refutation: string };
	taught: { move: string; reason: MainWhy; line: string; evalAfter: string; mastersShare: number | null } | null;
	accepted: { move: string; mastersShare: number | null; winChanceLost: number | null }[];
	opponentLastMove: { move: string; evalBefore: string; winChanceLost: number | null } | null;
	threat: { move: string; line: string } | null;
	masters: { games: number; moves: { move: string; share: number }[] } | null;
	facts: string[];
	/** Research notes: Wikibooks "Chess Opening Theory" commentary for this position and the moves around it. */
	theory: { about: string; page: string; text: string }[];
	/** For the checker, in UCI: the moves to the position, lines from it, and the threat line after passing. */
	check: { path: string[]; lines: string[][]; threat: string[] };
}

/** A source as a link: Wikibooks theory pages by their last move, URLs by host. */
export function sourceLink(source: string): { label: string; url?: string } {
	const [label, url] = source.split(' | ');
	if (label.startsWith('Chess Opening Theory/')) {
		const page = `https://en.wikibooks.org/wiki/${encodeURIComponent(label.replaceAll(' ', '_')).replaceAll('%2F', '/')}`;
		return { label: `Wikibooks, ${label.split('/').at(-1)}`, url: url && /^https?:\/\//.test(url) ? url : page };
	}
	if (url && /^https?:\/\//.test(url)) return { label, url };
	if (/^https?:\/\//.test(source)) return { label: new URL(source).hostname.replace(/^www\./, ''), url: source };
	return { label: source };
}

const MAX_HEADLINE_WORDS = 14;
const MOVE = /(\d+\.(?:\.\.|…)?\s?|\.\.\.|…)?\b(O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)(?![\w-])[+#]?/g;
/** Evaluations ("+1.94", "−0.48", "0.00"): the app shows live ones, so written text must not quote its own. */
const EVAL = /[+−-]\d{1,2}\.\d{2}(?!\d)|(?<![\d.])0\.00(?!\d)/g;
const PIECE_ON = /\b(king|queen|rook|bishop|knight|pawn)s?\s+on\s+([a-h][1-8])\b/gi;
const SQUARE_PIECE = /\b([a-h][1-8])[-\s](king|queen|rook|bishop|knight|pawn)\b/gi;

/** SAN moves (also numbered: "3...Nf6") and piece placements on the way to the position and along its lines. */
export function vocabulary(card: ExportCard, extraLines: string[][] = []): { moves: Set<string>; numbered: Set<string>; pieces: Set<string> } {
	const moves = new Set<string>();
	const numbered = new Set<string>();
	const pieces = new Set<string>();
	const note = (pos: Chess) => {
		for (const sq of pos.board.occupied) pieces.add(`${pos.board.getRole(sq)}@${makeSquare(sq)}`);
	};
	const play = (start: Chess, ucis: string[]) => {
		const pos = start.clone();
		note(pos);
		for (const uci of ucis) {
			const move = parseUci(uci);
			if (!move || !pos.isLegal(move)) break;
			const san = makeSan(pos, move).replace(/[+#]/g, '');
			moves.add(san);
			numbered.add(`${pos.fullmoves}${pos.turn === 'white' ? '.' : '...'}${san}`);
			pos.play(move);
			note(pos);
		}
	};
	play(Chess.default(), card.check.path);
	const pos = Chess.fromSetup(parseFen(card.fen).unwrap()).unwrap();
	for (const line of [...card.check.lines, ...extraLines]) play(pos, line);
	const passed = passTurn(pos);
	if (passed) play(passed, card.check.threat);
	for (const t of card.theory ?? []) quoted(t.text, moves, numbered);
	return { moves, numbered, pieces };
}

const QUOTED = /(?:(\d+)\.(\.\.|…)?\s*)?\b(O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)(?![\w-])[+#]?[?!]*/g;

/**
 * Moves quoted in theory notes, numbered as a reader would: "5. Bxf7+ Ke7 6. d4!" gives 5.Bxf7, 5...Ke7 and
 * 6.d4. Moves that only follow prose are known by SAN alone.
 */
function quoted(text: string, moves: Set<string>, numbered: Set<string>) {
	let last = 0;
	let n = 0;
	let white = true;
	let live = false;
	for (const m of text.matchAll(QUOTED)) {
		const [, num, dots, san] = m;
		if (num) {
			n = Number(num);
			white = !dots;
			live = true;
		} else if (!(live && /^\s*$/.test(text.slice(last, m.index)))) live = false;
		last = m.index + m[0].length;
		if (!live && /^[a-h][1-8]/.test(san)) continue;
		moves.add(san);
		if (!live) continue;
		numbered.add(`${n}${white ? '.' : '...'}${san}`);
		if (!white) n++;
		white = !white;
	}
}

/** Another common move here and its engine line (scripts/alternatives.ts), for checking the texts about it. */
export interface AlternativeLine {
	uci: string;
	label: string;
	lineUcis: string[];
}

/** Word limits for the phone: texts above them are cut down, not shown in full. */
const MAX_WORDS = { idea: 35, why: 75, link: 25, alternative: 50 };

/**
 * Problems with a written explanation; empty when it can be shown. With `alternatives` (the common moves from
 * scripts/alternatives.ts), their lines count as known moves and every one of them needs a written entry.
 */
export function checkExplanation(card: ExportCard, e: unknown, alternatives?: AlternativeLine[]): string[] {
	const x = e as Partial<Explanation> | null;
	if (!x || typeof x.headline !== 'string' || typeof x.why !== 'string' || typeof x.principle !== 'string') {
		return ['needs string fields headline, why and principle'];
	}
	if (x.themes !== undefined && !(Array.isArray(x.themes) && x.themes.every((t) => typeof t === 'string'))) return ['themes must be a list of strings'];
	if (x.sources !== undefined && !(Array.isArray(x.sources) && x.sources.every((t) => typeof t === 'string'))) return ['sources must be a list of strings'];
	const problems: string[] = [];
	if (typeof x.principleId !== 'string' || !principleById.has(x.principleId)) problems.push(`principleId must be one of: ${[...principleById.keys()].join(', ')}`);
	if (x.headline.split(/\s+/).length > MAX_HEADLINE_WORDS) problems.push(`headline is longer than ${MAX_HEADLINE_WORDS} words`);
	const { moves, numbered, pieces } = vocabulary(card, (alternatives ?? []).map((a) => a.lineUcis));
	const rich = richTexts(x);
	const text = [x.headline, x.why, x.principle, ...rich].join('\n');
	for (const m of text.matchAll(MOVE)) {
		const [, number, san] = m;
		// A bare pawn push ("e4") may just be a square; only check it when it carries a move number.
		if (!number && /^[a-h][1-8]/.test(san)) continue;
		// "3.Nf3" must be played at that move; "...Nf6" and "Nf6" anywhere in the lines.
		const at = /^(\d+)\.(\.\.|…)?/.exec(number ?? '');
		const known = at ? numbered.has(`${at[1]}${at[2] ? '...' : '.'}${san}`) : moves.has(san);
		if (!known) problems.push(`${m[0].trim()} is not a move in the card's lines`);
	}
	for (const [figure] of text.matchAll(EVAL)) problems.push(`leave out evaluation numbers like ${figure}; the app shows its own evals above the text`);
	for (const [, role, square] of text.matchAll(PIECE_ON)) {
		if (!pieces.has(`${role.toLowerCase()}@${square}`)) problems.push(`no ${role.toLowerCase()} stands on ${square} in the position or its lines`);
	}
	for (const [, square, role] of text.matchAll(SQUARE_PIECE)) {
		if (!pieces.has(`${role.toLowerCase()}@${square}`)) problems.push(`no ${role.toLowerCase()} stands on ${square} in the position or its lines`);
	}
	problems.push(...checkIdeas(x, card), ...checkRich(x, card, alternatives));
	return [...new Set(problems)];
}

/** The texts of the opening-ideas format (docs/opening-ideas-pipeline.md). */
function richTexts(x: Partial<Explanation>): string[] {
	return [
		...(x.ideas ?? []).map((i) => i.text),
		x.habit?.why,
		x.habit?.strays?.text,
		x.taught?.why,
		x.taught?.enforces?.text,
		...(x.alternatives ?? []).flatMap((a) => [a.before, a.after])
	].filter((t): t is string => typeof t === 'string');
}

const words = (t: string) => t.trim().split(/\s+/).length;

/** Lengths, sides, the alternatives against the common moves, and `before` texts that give the taught move away. */
function checkRich(x: Partial<Explanation>, card: ExportCard, alternatives?: AlternativeLine[]): string[] {
	const problems: string[] = [];
	for (const i of x.ideas ?? []) {
		if (!['you', 'opponent', 'both'].includes(i.side)) problems.push(`idea "${i.title}": side must be you, opponent or both`);
		if (words(i.text) > MAX_WORDS.idea) problems.push(`idea "${i.title}" is longer than ${MAX_WORDS.idea} words`);
	}
	if (x.ideas && (x.ideas.length < 2 || x.ideas.length > 5)) problems.push('give 2 to 5 ideas');
	for (const [name, why] of [['habit.why', x.habit?.why], ['taught.why', x.taught?.why]] as const) {
		if (why && words(why) > MAX_WORDS.why) problems.push(`${name} is longer than ${MAX_WORDS.why} words`);
	}
	for (const [name, link] of [['habit.strays', x.habit?.strays], ['taught.enforces', x.taught?.enforces]] as const) {
		if (link && words(link.text) > MAX_WORDS.link) problems.push(`${name}.text is longer than ${MAX_WORDS.link} words`);
	}
	const taughtSan = card.taught?.move.replace(/^\d+\.+/, '').replace(/[+#]/g, '');
	const given = new Map((alternatives ?? []).map((a) => [a.uci, a]));
	for (const a of x.alternatives ?? []) {
		const at = `alternative ${a.uci}`;
		if (typeof a.before !== 'string' || typeof a.after !== 'string') {
			problems.push(`${at} needs before and after texts`);
			continue;
		}
		if (words(a.before) > MAX_WORDS.alternative || words(a.after) > MAX_WORDS.alternative) problems.push(`${at}: before and after must each be at most ${MAX_WORDS.alternative} words`);
		if (taughtSan && [...a.before.matchAll(MOVE)].some((m) => m[2] === taughtSan)) problems.push(`${at}: before names the taught move ${taughtSan}; it shows while the player is still looking for it`);
		if (alternatives) {
			const g = given.get(a.uci);
			if (!g) problems.push(`${at} is not one of the common moves given`);
			else if (g.label !== a.label) problems.push(`${at}: label must be "${g.label}", as given`);
		}
	}
	for (const g of alternatives ?? []) if (!(x.alternatives ?? []).some((a) => a.uci === g.uci)) problems.push(`alternative ${g.uci} (${g.label}) has no written entry`);
	return problems;
}

/**
 * Advice for writers, not a reason to reject: piece moves the app can't link to the board, which need a number
 * ("4...Nf6") or to follow a numbered move ("4.Nc3 Nf6"). A move only talked about ("can't play Nc3") is fine.
 */
export function linkWarnings(e: unknown): string[] {
	const x = e as Partial<Explanation> | null;
	return x ? [...new Set(richTexts(x).flatMap(unlinked))] : [];
}

function unlinked(text: string): string[] {
	const linked: [number, number][] = [];
	let at = 0;
	for (const seg of findMoves(text)) {
		if (seg.move) linked.push([at, at + seg.text.length]);
		at += seg.text.length;
	}
	const problems: string[] = [];
	for (const m of text.matchAll(MOVE)) {
		const san = m[2];
		if (!/^[KQRBNO]/.test(san)) continue;
		const start = m.index + m[0].indexOf(san);
		if (!linked.some(([a, b]) => start >= a && start < b)) problems.push(`write ${san} with its move number ("5.${san}" or "5...${san}") so it links to the board`);
	}
	return problems;
}

const ARROW = /^([a-h][1-8])([a-h][1-8])$/;
const SQUARE = /^[a-h][1-8]$/;

/** The ideas' board shapes are well-formed, and every line's idea names one of them. */
function checkIdeas(x: Partial<Explanation>, card: ExportCard): string[] {
	const board = Chess.fromSetup(parseFen(card.fen).unwrap()).unwrap().board;
	const problems: string[] = [];
	const titles = new Set((x.ideas ?? []).map((i) => i.title));
	for (const i of x.ideas ?? []) {
		for (const a of i.arrows ?? []) {
			const m = ARROW.exec(a);
			if (!m || m[1] === m[2]) problems.push(`idea "${i.title}": arrow ${a} must be two different squares like e2e4`);
			else if (!board.has(parseSquare(m[1])!)) problems.push(`idea "${i.title}": arrow ${a} starts on an empty square in the drill position`);
		}
		for (const q of i.squares ?? []) if (!SQUARE.test(q)) problems.push(`idea "${i.title}": square ${q} must look like f7`);
	}
	const named = [x.habit?.strays?.idea, x.taught?.enforces?.idea, ...(x.alternatives ?? []).map((a) => a.idea)];
	for (const idea of named) if (idea !== undefined && !titles.has(idea)) problems.push(`"${idea}" is not one of the ideas' titles`);
	return problems;
}
