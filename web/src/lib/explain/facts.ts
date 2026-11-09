// Plain-English facts about a drill card, read off the engine lines and the board: what the failing move
// loses and how, what the opponent threatens, and what the taught move does. Every statement is checked
// on the board, so the drill can show it for any card, instantly and offline.
import { attacks } from 'chessops/attacks';
import { Chess } from 'chessops/chess';
import type { Color, Move, NormalMove, Role, Square } from 'chessops/types';
import { makeSan } from 'chessops/san';
import { makeSquare, makeUci, opposite, parseUci, squareFile, squareRank } from 'chessops/util';
import { formatPlies, type Ply } from '../chess/line';

export interface Fact {
	/** What it explains: the position as a whole, the failing move, or the taught move. */
	about: 'position' | 'wrong' | 'main';
	text: string;
	/** Board preview: the explanation line it comes from (keyed by its first move) and how many moves to show. */
	line?: string;
	n?: number;
}

export interface FactInput {
	/** The drill position, with the player to move. */
	pos: Chess;
	/** Moves from the start to the position. */
	path: string[];
	/** The move that fails (the habit, or the move just played) and the engine line starting with it. */
	wrong: string;
	wrongLine?: Ply[];
	/** The taught move and the engine line starting with it. */
	main?: string;
	mainLine?: Ply[];
	/** The opponent's engine line if it were their turn again (from passTurn), to find what they threaten. */
	threat?: Ply[] | null;
}

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const NUMBER = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const MAX_FACTS = 6;
/** Material is compared once the captures in this many plies have settled. */
const MATERIAL_WINDOW = 10;

const minor = (role: Role) => role === 'knight' || role === 'bishop';
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${NUMBER[n] ?? n} times`);
const name = (color: Color) => (color === 'white' ? 'White' : 'Black');
const numbered = (ply: Ply) => formatPlies([ply]);
/** ": 3.Nxe5 Nxe5" for the moves a fact refers to, unless it's just the move itself. */
const shown = (plies: Ply[], n: number) => (n > 1 ? `: ${formatPlies(plies.slice(0, n))}` : '');

/** Minor pieces still on their starting squares. */
function minorsAtHome(pos: Chess, color: Color): number {
	const rank = color === 'white' ? 0 : 7;
	let n = 0;
	for (const [file, role] of [
		[1, 'knight'],
		[6, 'knight'],
		[2, 'bishop'],
		[5, 'bishop']
	] as const) {
		const piece = pos.board.get(rank * 8 + file);
		if (piece?.color === color && piece.role === role) n++;
	}
	return n;
}

function captured(pos: Chess, move: Move): Role | undefined {
	if (!('from' in move)) return undefined;
	const target = pos.board.get(move.to);
	if (target && target.color !== pos.turn) return target.role;
	if (pos.board.getRole(move.from) === 'pawn' && move.to === pos.epSquare) return 'pawn';
	return undefined;
}

export interface Swing {
	/** Pieces the side making the first move loses and wins, after even trades cancel out. */
	lost: Role[];
	won: Role[];
	/** Plies until the captures settle. */
	n: number;
	mate: boolean;
}

/**
 * Material changing hands along a line, or a mate within it. Material is read where the captures settle,
 * and reported from the first such point where one side is at least a pawn up and stays so. A capture at
 * the end of a cut-off line doesn't count: the recapture may simply be missing.
 */
export function materialSwing(start: Chess, plies: Ply[], window = MATERIAL_WINDOW): Swing | null {
	const pos = start.clone();
	const me = start.turn;
	const lost: Role[] = [];
	const won: Role[] = [];
	const moves = plies.slice(0, window).map((p) => parseUci(p.uci));
	const settled: Swing[] = [];
	let open = false;
	for (let i = 0; i < moves.length; i++) {
		const move = moves[i];
		if (!move || !pos.isLegal(move)) break;
		const taken = captured(pos, move);
		if (taken) {
			(pos.turn === me ? won : lost).push(taken);
			open = true;
		}
		pos.play(move);
		if (pos.isCheckmate()) return { ...cancel(lost, won), n: i + 1, mate: true };
		const next = moves[i + 1];
		if (open && next && !captured(pos, next)) {
			settled.push({ ...cancel(lost, won), n: i + 1, mate: false });
			open = false;
		}
	}
	const net = (s: Swing) => value(s.won) - value(s.lost);
	const final = settled.at(-1);
	if (!final || Math.abs(net(final)) < 1) return null;
	const sign = Math.sign(net(final));
	let first = settled.length - 1;
	while (first > 0 && sign * net(settled[first - 1]) >= 1) first--;
	return settled[first];
}

/** Drops even trades (a knight for a bishop counts as even). */
function cancel(lost: Role[], won: Role[]): { lost: Role[]; won: Role[] } {
	const l = [...lost];
	const w = [...won];
	for (let i = l.length - 1; i >= 0; i--) {
		const j = w.findIndex((r) => r === l[i] || (minor(r) && minor(l[i])));
		if (j >= 0) {
			w.splice(j, 1);
			l.splice(i, 1);
		}
	}
	return { lost: l, won: w };
}

const value = (roles: Role[]) => roles.reduce((s, r) => s + VALUE[r], 0);

function list(roles: Role[]): string {
	const counts = new Map<Role, number>();
	for (const r of [...roles].sort((a, b) => VALUE[b] - VALUE[a])) counts.set(r, (counts.get(r) ?? 0) + 1);
	return [...counts].map(([role, n]) => (n === 1 ? `a ${role}` : `${NUMBER[n] ?? n} ${role}s`)).join(' and ');
}

/** "a pawn", "the exchange", "a knight for a pawn". */
export function describeMaterial(lost: Role[], won: Role[]): string {
	if (lost.length === 1 && lost[0] === 'rook' && won.length === 1 && minor(won[0])) return 'the exchange';
	return won.length ? `${list(lost)} for ${list(won)}` : list(lost);
}

/** The first opponent move in a line that attacks two of the player's pieces (one of them a piece, not a pawn). */
export function findFork(start: Chess, plies: Ply[], within = 6): { n: number; targets: string[]; squares: Square[] } | null {
	const pos = start.clone();
	const me = start.turn;
	for (let i = 0; i < Math.min(within, plies.length); i++) {
		const move = parseUci(plies[i].uci);
		if (!move || !('from' in move) || !pos.isLegal(move)) return null;
		pos.play(move);
		if (pos.turn !== me) continue;
		const piece = pos.board.get(move.to);
		if (!piece || piece.color === me) continue;
		const hit: Square[] = [];
		for (const sq of attacks(piece, move.to, pos.board.occupied).intersect(pos.board[me])) {
			const target = pos.board.get(sq)!;
			const defended = pos.kingAttackers(sq, me, pos.board.occupied).nonEmpty();
			if (target.role === 'king' || VALUE[target.role] > VALUE[piece.role] || !defended) hit.push(sq);
		}
		const hasPiece = hit.some((sq) => pos.board.getRole(sq) !== 'pawn');
		if (hit.length >= 2 && hasPiece) return { n: i + 1, targets: named(pos, hit), squares: hit };
	}
	return null;
}

function forkText(targets: string[]): string {
	if (targets[0] === 'king') return `checks the king and attacks the ${targets.slice(1).join(' and the ')}`;
	return `attacks the ${targets.slice(0, -1).join(', the ')} and the ${targets.at(-1)} at once`;
}

/** Opponent pieces the piece on `sq` attacks that can be won: undefended, or worth more than it. */
function targetsOf(pos: Chess, sq: Square): string[] {
	const piece = pos.board.get(sq);
	if (!piece) return [];
	const them = opposite(piece.color);
	const hit: Square[] = [];
	for (const t of attacks(piece, sq, pos.board.occupied).intersect(pos.board[them])) {
		const target = pos.board.get(t)!;
		if (target.role === 'king') continue;
		const defended = pos.kingAttackers(t, them, pos.board.occupied).nonEmpty();
		if (VALUE[target.role] > VALUE[piece.role] || !defended) hit.push(t);
	}
	return named(pos, hit);
}

/** Whether the opponent captures on one of `squares` after ply `from` of the line. */
function capturesOn(start: Chess, plies: Ply[], from: number, squares: Square[]): boolean {
	const pos = start.clone();
	for (let i = 0; i < plies.length; i++) {
		const move = parseUci(plies[i].uci);
		if (!move || !pos.isLegal(move)) return false;
		if (i >= from && pos.turn !== start.turn && 'from' in move && squares.includes(move.to) && captured(pos, move)) return true;
		pos.play(move);
	}
	return false;
}

/** "king", "knight on e5", most valuable first. */
function named(pos: Chess, squares: Square[]): string[] {
	return squares
		.map((sq) => pos.board.get(sq)!)
		.map((piece, i) => ({ value: VALUE[piece.role], text: piece.role === 'king' ? 'king' : `${piece.role} on ${makeSquare(squares[i])}` }))
		.sort((a, b) => b.value - a.value)
		.map((t) => t.text);
}

/** What a developing move does: castles, develops, claims the centre, attacks something. */
function describeMove(pos: Chess, ply: Ply): string[] {
	const move = parseUci(ply.uci) as NormalMove | undefined;
	if (!move || !pos.isLegal(move)) return [];
	const piece = pos.board.get(move.from)!;
	const capture = !!captured(pos, move);
	const parts: string[] = [];
	if (ply.san.startsWith('O-O')) parts.push('castles, tucking the king away');
	else if (minor(piece.role) && squareRank(move.from) === (piece.color === 'white' ? 0 : 7)) {
		const file = squareFile(move.to);
		parts.push(`develops the ${piece.role}${file >= 2 && file <= 5 ? ' toward the centre' : ''}`);
	} else if (piece.role === 'pawn' && [27, 28, 35, 36].includes(move.to)) parts.push('claims the centre');
	if (!capture && !ply.san.startsWith('O-O')) {
		const after = pos.clone();
		after.play(move);
		const targets = targetsOf(after, move.to);
		if (targets.length) parts.push(`attacks the ${targets.join(' and the ')}`);
	}
	return parts;
}

/** Habits that break opening principles: an early queen, moving a piece twice, giving up castling. */
function describeHabit(pos: Chess, path: string[], ply: Ply): string[] {
	const move = parseUci(ply.uci) as NormalMove | undefined;
	if (!move || !pos.isLegal(move)) return [];
	const me = pos.turn;
	const piece = pos.board.get(move.from)!;
	const home = minorsAtHome(pos, me);
	const parts: string[] = [];
	const rights = pos.castles.castlingRights.intersect(pos.board[me]).nonEmpty();
	if (piece.role === 'king' && !ply.san.startsWith('O-O') && rights) parts.push('gives up the right to castle');
	if (piece.role === 'queen' && pos.fullmoves <= 8 && home >= 2) parts.push(`brings the queen out with ${NUMBER[home]} minor pieces still at home`);
	else if (!['pawn', 'king'].includes(piece.role) && pos.fullmoves <= 10 && home >= 2 && !captured(pos, move)) {
		// Did this piece arrive on its square earlier in the game?
		const replay = Chess.default();
		let movedBefore = false;
		for (const uci of path) {
			const m = parseUci(uci);
			if (!m || !replay.isLegal(m)) break;
			if (replay.turn === me && 'from' in m && m.to === move.from) movedBefore = true;
			replay.play(m);
		}
		if (movedBefore) parts.push(`moves the ${piece.role} a second time with ${NUMBER[home]} minor pieces still at home`);
	}
	return parts;
}

/** "f7 is attacked twice and defended only by the king": why a capture on that square works. */
function pressure(pos: Chess, ply: Ply): string | null {
	const move = parseUci(ply.uci) as NormalMove | undefined;
	const target = move && pos.board.get(move.to);
	if (!move || !target || target.color === pos.turn) return null;
	const attackers = pos.kingAttackers(move.to, pos.turn, pos.board.occupied).size();
	const defenders = [...pos.kingAttackers(move.to, opposite(pos.turn), pos.board.occupied)].map((sq) => pos.board.getRole(sq));
	if (attackers <= defenders.length) return null;
	const defended = !defenders.length ? 'not defended at all' : defenders.length === 1 ? `defended only by the ${defenders[0]}` : `defended ${times(defenders.length)}`;
	return `${makeSquare(move.to)} is attacked ${times(attackers)} and ${defended}.`;
}

/** A mate in one the side not to move would have with a free move: the threat behind a quiet move. */
export function mateThreat(pos: Chess): Ply | null {
	const passed = passTurn(pos);
	if (!passed) return null;
	for (const [from, dests] of passed.allDests()) {
		const pawn = passed.board.getRole(from) === 'pawn';
		for (const to of dests) {
			const move = pawn && (squareRank(to) === 0 || squareRank(to) === 7) ? { from, to, promotion: 'queen' as const } : { from, to };
			const after = passed.clone();
			after.play(move);
			if (after.isCheckmate()) return { uci: makeUci(move), san: makeSan(passed, move), moveNumber: passed.fullmoves, white: passed.turn === 'white' };
		}
	}
	return null;
}

/** The position with the opponent to move again, to find what they threaten; null if the player is in check. */
export function passTurn(pos: Chess): Chess | null {
	if (pos.isCheck()) return null;
	const setup = pos.toSetup();
	const passed = Chess.fromSetup({ ...setup, turn: opposite(setup.turn), epSquare: undefined });
	return passed.isOk ? passed.value : null;
}

/**
 * What a free move would win the opponent: their engine line from the passed position (see passTurn), as a
 * threat only when it wins material that stays won, or mates.
 */
export function realThreat(passed: Chess, line: Ply[]): Swing | null {
	const swing = materialSwing(passed, line);
	if (!swing) return null;
	return (swing.mate ? swing.n % 2 === 1 : value(swing.won) - value(swing.lost) >= 1) ? swing : null;
}

/** Facts for a card, most concrete first: what the failing move allows, then what the taught move does. */
export function explainFacts({ pos, path, wrong, wrongLine, main, mainLine, threat }: FactInput): Fact[] {
	const facts: Fact[] = [];
	const me = pos.turn;
	const them = name(opposite(me));
	const bad = wrongLine?.[0]?.uci === wrong ? wrongLine : undefined;

	const passed = threat?.length ? passTurn(pos) : null;
	const threatens = passed && threat ? realThreat(passed, threat) : null;
	if (threat && threatens) {
		const what = threatens.mate ? 'with mate to follow' : `winning ${describeMaterial(threatens.won, threatens.lost)}`;
		const allowed = bad?.[1]?.uci === threat[0].uci;
		facts.push({
			about: 'position',
			text: `${them} threatens ${numbered(threat[0])}, ${what}${allowed ? `, and ${numbered(bad![0])} doesn't stop it` : ''}.`,
			...(allowed ? { line: wrong, n: 2 } : {})
		});
	}

	if (bad) {
		const san = numbered(bad[0]);
		const swing = materialSwing(pos, bad);
		const mated = swing?.mate && swing.n % 2 === 0;
		if (mated) {
			facts.push({ about: 'wrong', text: `${san} allows mate: ${formatPlies(bad.slice(0, swing!.n))}.`, line: wrong, n: swing!.n });
		} else if (swing && !swing.mate && value(swing.lost) - value(swing.won) >= 1) {
			facts.push({ about: 'wrong', text: `${san} loses ${describeMaterial(swing.lost, swing.won)}${shown(bad, swing.n)}.`, line: wrong, n: swing.n });
			// Only a double attack that actually wins one of its targets explains the loss.
			const fork = findFork(pos, bad);
			const pays = fork && capturesOn(pos, bad.slice(0, swing.n), fork.n, fork.squares);
			if (fork && pays) facts.push({ about: 'wrong', text: `${numbered(bad[fork.n - 1])} ${forkText(fork.targets)}.`, line: wrong, n: fork.n });
		}
		// The first mate threat the opponent sets up in the refutation (e.g. ...Qh4 aiming at f2).
		if (!mated) {
			const p = pos.clone();
			for (let i = 0; i < Math.min(bad.length, 6); i++) {
				const move = parseUci(bad[i].uci);
				if (!move || !p.isLegal(move)) break;
				p.play(move);
				const mate = i % 2 === 1 ? mateThreat(p) : null;
				if (mate) {
					facts.push({ about: 'wrong', text: `${numbered(bad[i])} threatens ${numbered(mate)}.`, line: wrong, n: i + 1 });
					break;
				}
			}
		}
		const habit = describeHabit(pos, path, bad[0]);
		if (habit.length) facts.push({ about: 'wrong', text: `${san} ${habit.join(' and ')}.` });
	}

	const good = main && mainLine?.[0]?.uci === main ? mainLine : undefined;
	if (good) {
		const san = numbered(good[0]);
		const target = pressure(pos, good[0]);
		if (target) facts.push({ about: 'main', text: target });
		const swing = materialSwing(pos, good);
		if (swing?.mate && swing.n % 2 === 1) facts.push({ about: 'main', text: `${san} leads to mate: ${formatPlies(good.slice(0, swing.n))}.`, line: main, n: swing.n });
		else if (swing && !swing.mate && value(swing.won) - value(swing.lost) >= 1) {
			facts.push({ about: 'main', text: `${san} wins ${describeMaterial(swing.won, swing.lost)}${shown(good, swing.n)}.`, line: main, n: swing.n });
		}
		// A check that drives the king out, or a quiet move that threatens mate.
		const after = pos.clone();
		after.play(parseUci(good[0].uci)!);
		const reply = good[1];
		if (reply?.san.startsWith('K')) {
			const couldCastle = after.castles.castlingRights.intersect(after.board[opposite(me)]).nonEmpty();
			const where = couldCastle ? `after ${numbered(reply)} ${them} can no longer castle` : `the king has to go to ${reply.uci.slice(2, 4)}`;
			facts.push({ about: 'main', text: `${san} drags the king out: ${where}.`, line: main, n: 2 });
		}
		const mate = mateThreat(after);
		if (mate) facts.push({ about: 'main', text: `${san} threatens ${numbered(mate)}.`, line: main, n: 1 });
		const does = describeMove(pos, good[0]);
		if (does.length) facts.push({ about: 'main', text: `${san} ${does.join(' and ')}.`, line: main, n: 1 });
	}
	return facts.slice(0, MAX_FACTS);
}
