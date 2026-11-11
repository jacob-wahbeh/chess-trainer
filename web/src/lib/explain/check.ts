// Written explanations (static/explanations.json) and the guardrail they pass before the app shows them:
// every move they mention must appear in the card's own lines, and every "piece on square" must exist.
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { makeSquare, parseUci } from 'chessops/util';
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
	if (source.startsWith('Chess Opening Theory/')) {
		const url = `https://en.wikibooks.org/wiki/${encodeURIComponent(source.replaceAll(' ', '_')).replaceAll('%2F', '/')}`;
		return { label: `Wikibooks, ${source.split('/').at(-1)}`, url };
	}
	const [label, url] = source.split(' | ');
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
export function vocabulary(card: ExportCard): { moves: Set<string>; numbered: Set<string>; pieces: Set<string> } {
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
	for (const line of card.check.lines) play(pos, line);
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

/** Problems with a written explanation; empty when it can be shown. */
export function checkExplanation(card: ExportCard, e: unknown): string[] {
	const x = e as Partial<Explanation> | null;
	if (!x || typeof x.headline !== 'string' || typeof x.why !== 'string' || typeof x.principle !== 'string') {
		return ['needs string fields headline, why and principle'];
	}
	if (x.themes !== undefined && !(Array.isArray(x.themes) && x.themes.every((t) => typeof t === 'string'))) return ['themes must be a list of strings'];
	if (x.sources !== undefined && !(Array.isArray(x.sources) && x.sources.every((t) => typeof t === 'string'))) return ['sources must be a list of strings'];
	const problems: string[] = [];
	if (typeof x.principleId !== 'string' || !principleById.has(x.principleId)) problems.push(`principleId must be one of: ${[...principleById.keys()].join(', ')}`);
	if (x.headline.split(/\s+/).length > MAX_HEADLINE_WORDS) problems.push(`headline is longer than ${MAX_HEADLINE_WORDS} words`);
	const { moves, numbered, pieces } = vocabulary(card);
	const text = [x.headline, x.why, x.principle].join('\n');
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
	return [...new Set(problems)];
}
