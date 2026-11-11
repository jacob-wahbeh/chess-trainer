<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Chess, normalizeMove } from 'chessops/chess';
	import { chessgroundDests, chessgroundMove } from 'chessops/compat';
	import { makeFen, parseFen } from 'chessops/fen';
	import { makeUci, parseUci } from 'chessops/util';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { chessopsUci } from '$lib/analysis/runner';
	import { formatEval, formatEvalShort, standingOf, standingSentence, whiteCp, type Eval } from '$lib/analysis/score';
	import { continuation, formatPlies, positions, sanOf, walk, type Ply, type Walk } from '$lib/chess/line';
	import { findMoves, plyIndex, type WrittenMove } from '$lib/chess/movelinks';
	import { ACCEPT_DROP, dropOf, KNOWN_STREAK, statusOf, type CardRecord } from '$lib/drill/cards';
	import { EnginePool, type EvalResult } from '$lib/engine/pool';
	import { sourceLink, type Explanation } from '$lib/explain/check';
	import { explainFacts, passTurn, type Fact, type Shape } from '$lib/explain/facts';
	import { notesFor, splitWritten, writtenLine, type Note } from '$lib/explain/notes';
	import { principleById } from '$lib/explain/principles';
	import { writtenExplanations } from '$lib/explain/written';
	import { pct } from '$lib/format';
	import { analysis, drill, ready, refreshDrill, settings } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { CardDetail } from '$lib/worker/data.worker';
	import Board from '$lib/ui/Board.svelte';
	import EvalBar from '$lib/ui/EvalBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { haptic, type Haptic } from '$lib/haptics';

	type Phase = 'loading' | 'intro' | 'ask' | 'checking' | 'result' | 'done' | 'empty';
	interface Result {
		kind: 'correct' | 'also' | 'wrong';
		played: string;
		drop: number | null;
		/** Opponent's best reply to a wrong move. */
		reply?: string;
		/** Evaluation after the move (White's view), when known. */
		eval?: Eval;
	}
	interface Frame {
		fen: string;
		lastMove?: Key[];
	}
	/** good: the taught move; bad: the habit or another mistake; own: a sound move of the player's. */
	type Kind = 'good' | 'bad' | 'own';
	/** A line to review after answering, shown as a chip and as an arrow on the drill position. */
	interface Chip {
		key: string;
		kind: Kind;
		tag: string;
	}
	/** A move played on the drill position after answering, to see where it leads; sound once the engine agrees. */
	interface Try {
		key: string;
		sound: boolean | null;
	}

	/** Plies replayed before each card (the earlier ones appear instantly). */
	const INTRO_PLIES = 8;
	/** Time per replayed move for each setup speed; the start position is held a little longer. */
	const INTRO_MS = { slow: 1000, normal: 600, fast: 300 } as const;
	/** Arrow keys step through the moves; up and down jump to the start and to the end. */
	const NAV_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -Infinity, ArrowDown: Infinity };
	/** Time per move when a line plays itself out on the board; it lingers on moves with a note. */
	const PLAY_MS = 900;
	const NOTE_MS = 2600;
	/** Eval labels on the arrows need a board this wide to be readable. */
	const LABEL_MIN_PX = 440;
	const SOLID: Record<Kind, string> = { good: 'green', bad: 'red', own: 'blue' };
	const PALE: Record<Kind, string> = { good: 'paleGreen', bad: 'paleRed', own: 'paleBlue' };
	/** A written explanation's line is shown once it names the taught move, a reply and one more move. */
	const BOOK_MIN_PLIES = 3;
	/** Moves tried after answering that keep a chip of their own. */
	const MAX_TRIES = 2;
	/** A missed card comes back this many cards later for practice, at most MAX_REPEATS times in a sitting. */
	const REPEAT_GAP = 5;
	const MAX_REPEATS = 2;

	let phase = $state<Phase>('loading');
	let queue = $state<string[]>([]);
	let index = $state(0);
	let card = $state<CardDetail | null>(null);
	/** Board position along the game: 0 is the start, `end` the drill position. */
	let cursor = $state(0);
	/** A line being stepped through from the drill position: its first `n` moves are on the board. */
	let pv = $state<{ key: string; n: number } | null>(null);
	let result = $state<Result | null>(null);
	let revealed = $state(false);
	let firstTry = $state(true);
	/** The card already came up in this sitting (after a miss): practice only, its streak doesn't change. */
	let repeat = $state(false);
	/** Whether this card's result is saved: on the first answer, so leaving or reloading mid-review keeps it. */
	let recorded = false;
	/** Engine continuations keyed by their first move ('' = the engine's own choice when no answer is known). */
	let lines = $state.raw<Record<string, Ply[]>>({});
	/** The start of a line (the move, and the reply to a mistake) until the engine's continuation arrives. */
	let seed = $state.raw<Record<string, Ply[]>>({});
	/** Evaluation of each engine line (White's view), for the eval bar, the chips and the arrows. */
	let evals = $state.raw<Record<string, Eval>>({});
	/** The opponent's engine line with a free turn, to find what they threaten. */
	let threat = $state.raw<Ply[] | null>(null);
	/** The line under review (its chip is selected). */
	let selected = $state<string | null>(null);
	/** The line playing itself out on the board. */
	let playing = $state<string | null>(null);
	/** After a sound alternative: looking for the main move, which stays hidden until found or shown. */
	let seeking = $state(false);
	let found = $state(false);
	let tries = $state<Try[]>([]);
	/** Whether the whole game shows in the move list during the review. */
	let fullPath = $state(false);
	/** The taught move's line follows the written explanation's moves when it names enough; this shows the engine's. */
	let engineLine = $state(false);
	/** Phones: the written explanation, notes and principle open in a sheet under the board. */
	let sheet = $state(false);
	/** Where the sheet starts: just under the board, so the board stays in view; or near the top, expanded. */
	let sheetTop = $state(0);
	let sheetFull = $state(false);
	let boardEl = $state<HTMLElement | undefined>();
	let boardWidth = $state(0);
	/** Phones: the eval bar goes above the board so the board can take the full width. */
	let narrow = $state(false);
	/** The move row under the board, kept scrolled to the move on the board. */
	let movesEl = $state<HTMLElement | undefined>();
	/** Phones: what the Why sheet shows, a line (its chip) or the opening (ideas, principle, sources). */
	let sheetView = $state<'line' | 'opening'>('line');
	/** The opening view's open sections: idea titles, 'principle', 'sources'. */
	let openSections = $state<Set<string>>(new Set());
	/** Taps on the footer buttons are ignored until then: a double tap on one button mustn't land on the button that replaces it. */
	let calmUntil = 0;
	const settle = () => (calmUntil = performance.now() + 400);
	const calm = (fn: () => unknown) => () => {
		if (performance.now() < calmUntil) return;
		void fn();
	};
	/** The card just stopped with "stop drilling this", while its Undo is offered. */
	let stopped = $state<{ id: string; san: string } | null>(null);
	let stoppedTimer: ReturnType<typeof setTimeout> | undefined;
	/** The "more" menu (stop drilling this card): open state, and its element for closing on a touch outside it. */
	let menuOpen = $state(false);
	let menuEl = $state<HTMLElement | undefined>();
	/** The chip row, kept scrolled to the selected line. */
	let chipsEl = $state<HTMLElement | undefined>();
	let explainRun = 0;
	/** Explanations written ahead of time (scripts/explanations.ts), by `${position key}|${habit}`. */
	let explanations = $state.raw<Record<string, Explanation>>({});
	let stats = $state({ done: 0, firstTry: 0 });
	/** Cards that came up in this sitting, and how often each missed one was brought back. */
	const appeared = new Set<string>();
	const requeued = new Map<string, number>();
	let introTimer: ReturnType<typeof setTimeout> | undefined;
	let playTimer: ReturnType<typeof setTimeout> | undefined;
	let engine: Promise<EnginePool> | undefined;

	const line = $derived(card ? walk(card.card.path) : null);
	const end = $derived(line?.plies.length ?? 0);
	const frames = $derived(card ? positions(card.card.path) : []);
	const color = $derived(card?.card.color ?? 'white');
	const main = $derived(card?.main?.uci);
	const why = $derived(card?.main?.why);
	/** The opponent's last move ("5...h6") when the answer punishes it. */
	const slip = $derived(line && why === 'punish' ? formatPlies(line.plies.slice(-1)) : '');
	const theMain = $derived(why === 'thematic' ? 'the thematic move' : why === 'punish' ? `the move that punishes ${slip}` : 'the engine’s move');
	const written = $derived(card ? explanations[`${card.card.key}|${card.card.wrong}`] : undefined);
	/** The move explained as failing: the one just played if it was wrong, otherwise the usual habit. */
	const wrongMove = $derived(result?.kind === 'wrong' ? result.played : card?.card.wrong);
	/** How the result shows: "Correct" (green) only for the taught move; any other sound move is "Good move" (blue). */
	const tone = $derived<Result['kind'] | null>(
		!result ? null : result.kind === 'wrong' ? 'wrong' : main !== undefined && result.played !== main ? 'also' : 'correct'
	);
	/** Not while retrying a miss, or while looking for the main move after a sound alternative. */
	const answerShown = $derived(!!result && (result.kind !== 'wrong' || revealed) && !seeking);
	/** Checked facts about the failing move and the taught one, from the engine lines as they arrive. */
	const facts: Fact[] = $derived.by(() => {
		if (!card || !line || !result || !wrongMove) return [];
		return explainFacts({
			pos: line.pos,
			path: card.card.path,
			wrong: wrongMove,
			wrongLine: lines[wrongMove],
			main,
			mainLine: main ? lines[main] : undefined,
			threat,
			mainEval: main !== undefined ? playerCp(evalOf(main)) : undefined,
			wrongEval: playerCp(evalOf(wrongMove))
		});
	});
	const progress = $derived(queue.length ? Math.min(1, index / queue.length) : 0);

	/**
	 * The line the written explanation walks through after the taught move (as far as its moves follow on), so
	 * stepping through the green line shows what the text describes. Only used when it goes past the first reply.
	 */
	const bookLine: Ply[] = $derived.by(() => {
		if (!written || !line || main === undefined) return [];
		const ucis = writtenLine(written.why, line.pos, main);
		return ucis.length >= BOOK_MIN_PLIES ? continuation(line.pos, ucis) : [];
	});
	const showsBook = (key: string) => key === main && bookLine.length > 0 && !engineLine;
	const lineOf = (key: string): Ply[] => (showsBook(key) ? bookLine : (lines[key] ?? seed[key] ?? []));
	/** "5...Qc7": a line's first move, numbered as in the notation. */
	const numbered = (key: string) => {
		const ply = lineOf(key)[0] ?? (line && key ? continuation(line.pos, [key])[0] : undefined);
		return ply ? formatPlies([ply]) : '…';
	};

	/** The lines to review: the taught move (once it may be seen), the move played, the habit, and moves tried. */
	const chips: Chip[] = $derived.by(() => {
		if (!card || !result || wrongMove === undefined) return [];
		const share = card.answers.find((a) => a.uci === main)?.share;
		const list: Chip[] = [];
		const tag = why === 'thematic' ? `Thematic${share ? ` · masters ${pct(share)}` : ''}` : why === 'punish' ? `Punishes ${slip}` : 'Engine’s choice';
		// Order stays put as the review goes on: the move played first, then the habit; the taught move, once it may be seen, is
		// added after them (first only when it was the move played), so nothing shifts under the finger.
		const playedMain = answerShown && result.played === main;
		if (playedMain) list.push({ key: main ?? '', kind: 'good', tag });
		if (result.kind !== 'wrong' && result.played !== main) list.push({ key: result.played, kind: 'own', tag: 'Your move · also good' });
		const habit = `Your habit · ${card.wrongCount}× in your games`;
		list.push({ key: wrongMove, kind: 'bad', tag: wrongMove === card.card.wrong ? habit : 'Your move' });
		if (wrongMove !== card.card.wrong && answerShown) list.push({ key: card.card.wrong, kind: 'bad', tag: habit });
		if (answerShown && !playedMain) list.push({ key: main ?? '', kind: 'good', tag });
		for (const t of tries) {
			if (list.some((c) => c.key === t.key)) continue;
			list.push({ key: t.key, kind: t.sound === false ? 'bad' : 'own', tag: t.sound === null ? 'Checking…' : t.sound ? 'Also fine' : 'A mistake' });
		}
		return list;
	});
	const chipOf = (key: string | null) => chips.find((c) => c.key === key);
	/** A line's first move without its number: every line starts from the drill position. */
	const chipSan = (key: string) => lineOf(key)[0]?.san ?? (line && key ? sanOf(line.pos, key) : '…');
	/** An evaluation in centipawns from the player's side. */
	const playerCp = (e: Eval | undefined) => (e ? whiteCp(e) * (color === 'white' ? 1 : -1) : undefined);
	/** Evaluations as the analysis saved them where it has one (so they match the verdict), else the live engine's. */
	const evalOf = (key: string): Eval | undefined => {
		if (!card) return evals[key];
		if (result && key === result.played && result.eval) return result.eval;
		return card.answers.find((a) => a.uci === key)?.eval ?? (key === card.card.wrong ? card.wrongEval : undefined) ?? evals[key];
	};
	const kindOf = (key: string): Kind => chipOf(key)?.kind ?? 'own';

	/** The line on the board and how far along it: 0 at the drill position, -1 looking back through the game. */
	const viewKey = $derived(pv?.key ?? selected);
	const viewN = $derived(pv ? pv.n : phase === 'result' && cursor === end ? 0 : -1);
	const visibleFacts = $derived(answerShown ? facts : facts.filter((f) => f.about !== 'main'));
	/** Checked facts for the other lines (a sound alternative, the habit after another mistake, moves tried). */
	const extraFacts = $derived.by(() => {
		const out: Record<string, Fact[]> = {};
		if (!card || !line || !result) return out;
		for (const c of chips) {
			if (c.key === (main ?? '') || c.key === wrongMove || !lines[c.key]) continue;
			const input = { pos: line.pos, path: card.card.path };
			const after = playerCp(evalOf(c.key));
			out[c.key] =
				c.kind === 'bad'
					? explainFacts({ ...input, wrong: c.key, wrongLine: lines[c.key], wrongEval: after })
					: explainFacts({ ...input, wrong: '', main: c.key, mainLine: lines[c.key], mainEval: after });
		}
		return out;
	});
	const lineNotes = (key: string | null): Note[] => {
		if (key === null || !result) return [];
		let notes = notesFor(visibleFacts, key, { main, wrong: wrongMove });
		if (showsBook(key)) {
			// Facts come from the engine's line: keep those on moves the book line shares with it.
			const engine = lines[key] ?? [];
			let same = 0;
			while (same < bookLine.length && engine[same]?.uci === bookLine[same].uci) same++;
			notes = notes.filter((n) => n.n <= same);
		}
		const extra = extraFacts[key];
		if (!extra) return notes;
		const role = kindOf(key) === 'bad' ? { wrong: key } : { main: key };
		return [...notes, ...notesFor(extra, key, role)].sort((a, b) => a.n - b.n);
	};
	/**
	 * What a line's move is and how it compares with the best move, for every line but the main one: "Also fine:
	 * +0.31, close to Nf6 (+0.20)". The main move isn't named while it's still to be found.
	 */
	const summary = (key: string): string => {
		const chip = chipOf(key);
		if (!chip || !card || !line || !result || key === (main ?? '')) return '';
		if (chip.tag === 'Checking…') return `Checking ${numbered(key)}…`;
		const label =
			chip.kind !== 'bad'
				? key === result.played
					? 'Your move is also good'
					: 'Also fine'
				: key === card.card.wrong
					? `Your habit (${card.wrongCount}×)`
					: key === result.played
						? 'Not quite'
						: 'A mistake';
		const mine = evalOf(key);
		const best = answerShown && main ? sanOf(line.pos, main) : 'the best move';
		if (!mine || !card.eval) return `${label}.`;
		return chip.kind === 'bad'
			? `${label}: ${standingSentence(mine)} (${formatEval(mine)}). ${best[0].toUpperCase() + best.slice(1)} keeps ${kept(card.eval)}.`
			: `${label}: ${standingSentence(mine).replace(/^It’s/, 'it’s')} (${formatEval(mine)}), close to ${best} (${formatEval(card.eval)}).`;
	};
	/** "it level (+0.14)" / "White better (+1.07)": what a move keeps, in words and as the eval. */
	const kept = (e: Eval) => `${standingOf(e) === 'level' ? 'it level' : standingOf(e)} (${formatEval(e)})`;
	/** "level (+0.14)" / "White clearly better (+2.68)". */
	const stateOf = (e: Eval) => `${standingOf(e)} (${formatEval(e)})`;
	const viewNotes = $derived(lineNotes(viewKey));
	const notesHere = $derived(viewN >= 0 ? viewNotes.filter((n) => n.n === viewN) : []);
	/** The written explanation, split between what it says about the habit and about the taught move. */
	const story = $derived.by(() => {
		if (!written || !line || !card || !answerShown) return null;
		return splitWritten(written.why, sanOf(line.pos, card.card.wrong), main ? sanOf(line.pos, main) : '');
	});
	/** The written entry for another common move here (club or master), if the explanation has one. */
	const altOf = (key: string) => written?.alternatives?.find((a) => a.uci === key);
	/** What the written explanation says about a line: the habit, the taught move, or another common move. */
	const storyFor = (key: string): string[] => {
		if (!written || !card) return [];
		const alt = altOf(key);
		// Written never to name the taught move, so it shows as soon as the move is played.
		if (alt) return [alt.before];
		if (key === card.card.wrong && written.habit) return answerShown ? [written.habit.why] : [];
		if (key === (main ?? '') && written.taught) return answerShown ? [written.taught.why] : [];
		return !story ? [] : key === card.card.wrong ? story.wrong : key === (main ?? '') ? story.main : [];
	};
	const sideName = (side: 'you' | 'opponent' | 'both') => (side === 'you' ? 'You' : side === 'both' ? 'Both' : color === 'white' ? 'Black' : 'White');

	const feel = (kind: Haptic) => settings.haptics && haptic(kind);
	const evaluate = async (fen: string, depth: number) => (await (engine ??= EnginePool.create(1))).evaluate(fen, depth);
	const toWhite = (r: EvalResult, pos: Chess): Eval => {
		const sign = pos.turn === 'white' ? 1 : -1;
		return { cp: r.cp === undefined ? undefined : sign * r.cp, mate: r.mate === undefined ? undefined : sign * r.mate, depth: r.depth, src: 'local' };
	};
	const arrow = (uci: string | undefined, brush: string): DrawShape[] => {
		const move = uci ? parseUci(uci) : undefined;
		if (!move) return [];
		const [orig, dest] = chessgroundMove(move) as Key[];
		return [{ orig, dest, brush }];
	};
	const after = (pos: Chess, uci: string) => {
		const p = pos.clone();
		const move = parseUci(uci)!;
		p.play(move);
		return { pos: p, frame: { fen: makeFen(p.toSetup()), lastMove: chessgroundMove(move) as Key[] } };
	};
	const toShapes = (list: Shape[] = []): DrawShape[] => list.map((s) => ({ orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.brush }));

	const shown: Frame | null = $derived(pv && line ? (playOut(line.pos, lineOf(pv.key).slice(0, pv.n)) ?? frames[end]) : (frames[cursor] ?? null));
	/** The position on the board, for whose turn it is and a king in check. */
	const shownPos = $derived.by(() => {
		const setup = shown ? parseFen(shown.fen) : undefined;
		const pos = setup?.isOk ? Chess.fromSetup(setup.value) : undefined;
		return pos?.isOk ? pos.value : null;
	});
	/** The open ideas' arrows and squares (when the explanation has them), on the drill position. */
	const IDEA_BRUSH = { you: 'green', opponent: 'yellow', both: 'blue' } as const;
	const ideaShapes: DrawShape[] = $derived.by(() => {
		if (!(narrow && sheet && sheetView === 'opening') || pv || cursor !== end || !written?.ideas) return [];
		return written.ideas
			.filter((i) => openSections.has(i.title))
			.flatMap((i) => [
				...(i.arrows ?? []).map((a) => ({ orig: a.slice(0, 2) as Key, dest: a.slice(2, 4) as Key, brush: IDEA_BRUSH[i.side] })),
				...(i.squares ?? []).map((q) => ({ orig: q as Key, brush: IDEA_BRUSH[i.side] }))
			]);
	});
	const shapes: DrawShape[] = $derived.by(() => {
		if (phase !== 'result' || !result) return [];
		if (sheet && sheetView === 'opening' && !pv && cursor === end) return ideaShapes;
		const drawn = notesHere.flatMap((n) => toShapes(n.shapes));
		if (pv) {
			if (drawn.length) return drawn;
			// Where the line goes next, as a thinner arrow in its colour; the reply to a mistake in full.
			const next = lineOf(pv.key)[pv.n];
			const reply = pv.n === 1 && result.kind === 'wrong' && pv.key === result.played;
			return arrow(next?.uci, reply ? 'red' : SOLID[kindOf(pv.key)]).map((a) => (reply ? a : { ...a, modifiers: { lineWidth: 6 } }));
		}
		if (cursor !== end || (result.kind === 'wrong' && !revealed)) return [];
		// Played the taught move: back at the position (Reset), the board stays clean.
		if (result.kind === 'correct' && result.played === main) return [];
		// The drill position: every line's first move, labelled with its eval, and the notes about the position.
		const labels = boardWidth >= LABEL_MIN_PX;
		const overview = chips.flatMap((c) =>
			arrow(c.key || lineOf(c.key)[0]?.uci, c.key === selected ? SOLID[c.kind] : PALE[c.kind]).map((s) =>
				labels && evalOf(c.key) ? { ...s, label: { text: formatEvalShort(evalOf(c.key)) } } : s
			)
		);
		return [...overview, ...drawn];
	});
	/** The eval bar, once the card is answered: the drill position, or the line on the board. */
	const shownEval: Eval | undefined = $derived.by(() => {
		if (phase !== 'result' || !result) return undefined;
		if (pv) return evalOf(pv.key);
		return cursor === end ? card?.eval : undefined;
	});
	/** Under the board when there's no note for the move on it: which line and move it is, or what to do. */
	const lineSummary = $derived(
		// After a miss the verdict box already compares the move with the best one.
		viewN === 1 && viewKey !== null && !(result?.kind === 'wrong' && viewKey === result.played) ? summary(viewKey) : ''
	);
	const caption = $derived.by(() => {
		if (phase !== 'result' || !result) return '';
		if (pv) {
			const ply = lineOf(pv.key)[pv.n - 1];
			return ply ? `${chipOf(pv.key)?.tag ?? 'Line'} · ${formatPlies([ply])}` : '';
		}
		if (cursor !== end) return '';
		return result.kind === 'wrong' && !revealed ? 'Play another move to try again.' : 'Tap a line to play it, or try any move on the board.';
	});
	/** Looking at something other than the drill position. */
	const away = $derived((phase === 'ask' || phase === 'result') && (!!pv || cursor < end));
	/** Moves can be made on the drill position: to answer, to retry a miss, or to try another move afterwards. */
	const dests = $derived(
		line && !pv && cursor === end && (phase === 'ask' || phase === 'result') ? (chessgroundDests(line.pos) as Map<Key, Key[]>) : undefined
	);
	/** Pieces slide more slowly during the setup replay so each move is easy to follow. */
	const animationMs = $derived(phase === 'intro' ? Math.min(450, (INTRO_MS[settings.introSpeed] ?? 600) * 0.6) : 200);

	async function load(i: number) {
		clearTimeout(introTimer);
		stopPlay();
		result = null;
		lines = {};
		seed = {};
		engineLine = false;
		sheet = false;
		evals = {};
		threat = null;
		revealed = false;
		firstTry = true;
		recorded = false;
		pv = null;
		selected = null;
		seeking = false;
		found = false;
		tries = [];
		fullPath = false;
		if (i >= queue.length) {
			phase = 'done';
			void refreshDrill();
			return;
		}
		index = i;
		repeat = appeared.has(queue[i]);
		appeared.add(queue[i]);
		const detail = await data().cardDetail(queue[i]);
		if (!detail) return load(i + 1);
		card = detail;
		startIntro();
		settle();
	}

	/** The whole deck in order of need (buildDeck), or the one card picked on the Mistakes page. */
	async function start() {
		if (!settings.username) return;
		await data().syncCards();
		const only = page.url.searchParams.get('card');
		if (only && (await data().cardDetail(only))) return begin([only]);
		const deck = await data().deck(settings.drillOrder);
		if (deck.ids.length) begin(deck.ids);
		else phase = 'empty';
	}

	function begin(ids: string[]) {
		appeared.clear();
		requeued.clear();
		stats = { done: 0, firstTry: 0 };
		queue = ids;
		void load(0);
	}

	function startIntro() {
		const perMove = INTRO_MS[settings.introSpeed] ?? INTRO_MS.normal;
		phase = 'intro';
		cursor = Math.max(0, end - INTRO_PLIES);
		const step = () => {
			cursor = Math.min(cursor + 1, end);
			// Let the last move land at the same pace before handing over to "Your move".
			introTimer = cursor === end ? setTimeout(finishIntro, perMove) : setTimeout(step, perMove);
		};
		introTimer = setTimeout(step, perMove + 400);
	}

	/** Ends the setup replay, on the drill position unless the user took over at another move. */
	function finishIntro(at = end) {
		if (phase !== 'intro') return;
		clearTimeout(introTimer);
		cursor = at;
		phase = 'ask';
	}

	/** Any touch on the board skips the replay, or comes back to the position from earlier moves while answering. A pointerdown,
	 *  because chessground cancels touchstart on and around pieces, so a click never fires there. */
	function boardTouch() {
		if (phase === 'intro') finishIntro();
		else if (phase === 'ask' && cursor < end && !pv) goTo(end);
	}

	/** The opening view of the Why sheet: the board goes back to the position, where an open idea can draw itself. */
	function showOpening(focus?: string) {
		if (!written || !card) return;
		stopPlay();
		sheetView = 'opening';
		goTo(end);
		// Ideas start as a list of titles, with the one this line relates to open (on older cards, the principle).
		const related = focus ?? ideaTag(selected ?? '')?.idea;
		openSections = new Set(written.ideas?.length ? (related ? [related] : []) : ['principle']);
	}

	function toggleSection(id: string) {
		const next = new Set(openSections);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		openSections = next;
		if (pv || cursor !== end) goTo(end);
	}

	/** The opening idea a line carries out or strays from, once the answer may be seen. */
	function ideaTag(key: string): { idea: string; tone: 'good' | 'bad' | 'own' } | null {
		if (!written || !card || !answerShown) return null;
		if (key === card.card.wrong && written.habit?.strays) return { idea: written.habit.strays.idea, tone: 'bad' };
		if (key === (main ?? '') && written.taught?.enforces) return { idea: written.taught.enforces.idea, tone: 'good' };
		const alt = altOf(key);
		return alt?.idea ? { idea: alt.idea, tone: 'own' } : null;
	}

	/** How the habit and the taught move relate to an idea, shown under it. */
	function ideaMoves(title: string): { tone: 'good' | 'bad'; move: string; text: string }[] {
		if (!written || !card) return [];
		const out: { tone: 'good' | 'bad'; move: string; text: string }[] = [];
		if (written.habit?.strays?.idea === title) out.push({ tone: 'bad', move: numbered(card.card.wrong), text: written.habit.strays.text });
		if (written.taught?.enforces?.idea === title && main) out.push({ tone: 'good', move: numbered(main), text: written.taught.enforces.text });
		return out;
	}

	type MoveLink = { key: string; n: number } | { cursor: number };
	/** Where a move written in an explanation is on the board: in the line being read, another line under review, or the game. */
	function linkOf(move: WrittenMove, prefer: string | null): MoveLink | null {
		const keys = chips.map((c) => c.key);
		if (prefer !== null && keys.includes(prefer)) keys.unshift(prefer);
		for (const k of keys) {
			const i = plyIndex(lineOf(k), move);
			if (i >= 0) return { key: k, n: i + 1 };
		}
		const j = line ? plyIndex(line.plies, move) : -1;
		return j >= 0 ? { cursor: j + 1 } : null;
	}
	/** Explanation text as plain runs and move links; consecutive moves ("4...Bc5 5.f4 Nc6") make one link, to the last of them. */
	type Run = { text: string; first?: MoveLink; to?: MoveLink };
	const follows = (a: MoveLink, b: MoveLink) =>
		'key' in a && 'key' in b ? a.key === b.key && b.n === a.n + 1 : 'cursor' in a && 'cursor' in b && b.cursor === a.cursor + 1;
	function linkRuns(text: string, prefer: string | null): Run[] {
		const out: Run[] = [];
		for (const seg of findMoves(text)) {
			const to = seg.move ? linkOf(seg.move, prefer) : null;
			const space = out.at(-1);
			const run = out.at(-2);
			if (to && space && !space.to && /^\s+$/.test(space.text) && run?.to && follows(run.to, to)) {
				out.pop();
				run.text += space.text + seg.text;
				run.to = to;
			} else out.push(to ? { text: seg.text, first: to, to } : { text: seg.text });
		}
		return out;
	}
	/** Whether the board is on a move of the run. */
	const atRun = (r: Run) => {
		const a = r.first, b = r.to;
		if (!a || !b) return false;
		if ('key' in a && 'key' in b) return pv?.key === a.key && pv.n >= a.n && pv.n <= b.n;
		return 'cursor' in a && 'cursor' in b && !pv && cursor >= a.cursor && cursor <= b.cursor;
	};
	/** Shows a written move on the board, keeping the sheet on what's being read. */
	function followLink(l: MoveLink) {
		stopPlay();
		finishIntro(cursor);
		if ('key' in l) pv = { key: l.key, n: l.n };
		else goTo(l.cursor);
	}

	/** The sheet's grabber: a tap toggles full height; a drag up expands, a drag down shrinks, then closes. */
	let grabY: number | null = null;
	function grabStart(e: PointerEvent) {
		grabY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function grabEnd(e: PointerEvent) {
		if (grabY === null) return;
		const dy = e.clientY - grabY;
		grabY = null;
		if (Math.abs(dy) < 10) sheetFull = !sheetFull;
		else if (dy < 0) sheetFull = true;
		else if (sheetFull) sheetFull = false;
		else sheet = false;
	}

	/** Steps through the game up to the drill position, then on into the line under review. */
	function browse(by: number) {
		const follow = phase === 'result' ? selected : null;
		const length = follow === null ? 0 : lineOf(follow).length;
		if (pv) {
			// Back out of the line onto the drill position (all the way back goes there first), or along it.
			if (by === -Infinity || pv.n + by <= 0) return goTo(by === -Infinity ? end : Math.max(0, end + pv.n + by));
			pv = { ...pv, n: Math.min(pv.n + by, lineOf(pv.key).length) };
		} else if (follow !== null && length && cursor + by > end) {
			pv = { key: follow, n: Math.min(cursor + by - end, length) };
		} else cursor = Math.max(0, Math.min(end, cursor + by));
	}

	function goTo(i: number) {
		stopPlay();
		finishIntro(i);
		pv = null;
		cursor = i;
	}

	/** Arrow keys and the buttons under the board. */
	const canBack = $derived(!!pv || cursor > 0);
	const canForward = $derived(
		pv ? pv.n < lineOf(pv.key).length : cursor < end || (phase === 'result' && selected !== null && lineOf(selected).length > 0)
	);
	function step(by: number) {
		stopPlay();
		finishIntro(cursor);
		browse(by);
	}

	/** Shows the board `n` moves into a line (0: the drill position), making it the line under review. */
	function preview(key: string, n: number) {
		stopPlay();
		finishIntro(cursor);
		selected = key;
		if (n > 0) pv = { key, n };
		else goTo(end);
	}

	/**
	 * Plays a line out on the board, lingering on moves with a note: on from the move shown if it's on this line,
	 * otherwise from its first move. Again to stop.
	 */
	function play(key: string) {
		if (playing === key) return stopPlay();
		stopPlay();
		finishIntro(cursor);
		selected = key;
		const length = lineOf(key).length;
		pv = { key, n: pv?.key === key && pv.n < length ? pv.n : 1 };
		playing = key;
		const delay = () => (notesHere.length ? NOTE_MS : PLAY_MS);
		const advance = () => {
			if (!pv || pv.key !== key || pv.n >= lineOf(key).length) return stopPlay();
			pv = { key, n: pv.n + 1 };
			playTimer = setTimeout(advance, delay());
		};
		playTimer = setTimeout(advance, delay());
	}

	function stopPlay() {
		clearTimeout(playTimer);
		playing = null;
	}

	/** The board after playing `plies` from `pos`. */
	function playOut(pos: Chess, plies: Ply[]): Frame | null {
		let last: Frame | null = null;
		for (const ply of plies) {
			const next = after(pos, ply.uci);
			pos = next.pos;
			last = next.frame;
		}
		return last;
	}

	async function onMove(orig: Key, dest: Key) {
		if (!card || !line) return;
		let move = parseUci(orig + dest);
		if (!move || !('from' in move)) return;
		if (line.pos.board.getRole(move.from) === 'pawn' && (dest[1] === '8' || dest[1] === '1')) move = { ...move, promotion: 'queen' };
		const uci = makeUci(normalizeMove(line.pos, move));
		if (phase === 'result') {
			// After a miss, a move on the position is the next attempt; once answered, it's a move to try out.
			if (result?.kind !== 'wrong' || revealed) return tryMove(uci);
			retry();
		}
		if (phase === 'ask') await answer(uci);
	}

	async function answer(uci: string) {
		if (!card || !line) return;
		const next = after(line.pos, uci);
		seed = { ...seed, [uci]: continuation(line.pos, [uci]) };
		selected = uci;
		pv = { key: uci, n: 1 };

		let r: Result;
		const known = card.answers.find((a) => a.uci === uci);
		if (known) r = { kind: 'correct', played: uci, drop: known.drop, eval: known.eval };
		else if (uci === card.card.wrong) r = { kind: 'wrong', played: uci, drop: card.wrongDrop, reply: card.wrongReply, eval: card.wrongEval };
		else {
			// Not in the saved data: let the engine decide, so a good alternative isn't marked wrong.
			phase = 'checking';
			const res = await evaluate(next.frame.fen, 14);
			const ev = toWhite(res, next.pos);
			const drop = dropOf(line.pos, card.eval, ev);
			r =
				drop !== null && drop <= ACCEPT_DROP
					? { kind: 'also', played: uci, drop, eval: ev }
					: { kind: 'wrong', played: uci, drop, reply: chessopsUci(next.pos, res.pv[0]), eval: ev };
		}
		feel(r.kind === 'wrong' ? 'error' : 'success');
		if (r.kind === 'wrong') {
			firstTry = false;
			if (r.reply) seed = { ...seed, [uci]: continuation(line.pos, [uci, r.reply]) };
		}
		// Only the first answer the first time a card comes up in a sitting counts toward its streak.
		if (!repeat && !recorded) {
			recorded = true;
			stats.done++;
			if (firstTry) stats.firstTry++;
			void data()
				.record(card.card.id, firstTry)
				.then(() => refreshDrill());
		}
		result = r;
		// A sound alternative: the main move stays hidden so it can still be found, and the board stays on the drill position
		// (the move shows as its arrow) so the next move can be tried at once.
		seeking = r.kind !== 'wrong' && main !== undefined && uci !== main;
		if (seeking) pv = null;
		phase = 'result';
		void explain(card.card.id, r);
	}

	/** A move played on the drill position after answering: the main move when looking for it, or a new line. */
	async function tryMove(uci: string) {
		if (!card || !line) return;
		feel('move');
		const id = card.card.id;
		if (seeking && uci === main) {
			seeking = false;
			found = true;
		}
		if (uci === main || chips.some((c) => c.key === uci)) {
			preview(uci, 1);
			return;
		}
		seed = { ...seed, [uci]: continuation(line.pos, [uci]) };
		const known = card.answers.some((a) => a.uci === uci) ? true : uci === card.card.wrong ? false : null;
		tries = [...tries.filter((t) => t.key !== uci), { key: uci, sound: known }].slice(-MAX_TRIES);
		preview(uci, 1);
		if (!(await computeLine(id, uci)) || known !== null) return;
		const drop = dropOf(line.pos, card.eval, evals[uci]);
		tries = tries.map((t) => (t.key === uci ? { ...t, sound: drop !== null && drop <= ACCEPT_DROP } : t));
	}

	/**
	 * The engine line starting with a move, and its evaluation. Searching after the move keeps the line on it, even
	 * where the engine would start somewhere else. False if the card changed meanwhile.
	 */
	async function computeLine(id: string, key: string): Promise<boolean> {
		if (!line) return false;
		if (lines[key]) return true;
		const pos = line.pos;
		const next = key ? after(pos, key) : null;
		const res = await evaluate(next ? next.frame.fen : line.fen, 16);
		if (card?.card.id !== id) return false;
		lines = { ...lines, [key]: continuation(pos, key ? [key, ...res.pv] : res.pv).slice(0, 10) };
		evals = { ...evals, [key]: toWhite(res, next ? next.pos : pos) };
		return true;
	}

	/** Lines for the move played, the main move, the failing move and the habit, then the opponent's threat. */
	async function explain(id: string, r: Result) {
		if (!line || !card) return;
		const run = ++explainRun;
		const pos = line.pos;
		const wrong = r.kind === 'wrong' ? r.played : card.card.wrong;
		for (const key of new Set([r.played, main ?? '', wrong, card.card.wrong])) {
			if (!(await computeLine(id, key)) || run !== explainRun) return;
		}
		// What the opponent would do with a free move; the facts call it a threat only if it wins material.
		const passed = passTurn(pos);
		if (threat === null && passed) {
			const res = await evaluate(makeFen(passed.toSetup()), 14);
			if (run !== explainRun || card?.card.id !== id) return;
			threat = continuation(passed, res.pv).slice(0, 10);
		}
	}

	function retry() {
		settle();
		stopPlay();
		sheet = false;
		result = null;
		revealed = false;
		seeking = false;
		pv = null;
		selected = null;
		tries = [];
		cursor = end;
		phase = 'ask';
	}

	/** Phones: opens the explanation under the board, starting just below it so the board stays in view. */
	function openSheet() {
		settle();
		sheetView = 'line';
		// The page may be scrolled a little on short screens: bring the board fully into view first.
		window.scrollTo(0, 0);
		sheetFull = false;
		const bottom = boardEl?.getBoundingClientRect().bottom ?? 0;
		sheetTop = bottom > 0 && bottom < innerHeight * 0.72 ? bottom + 6 : Math.round(innerHeight * 0.45);
		sheet = true;
	}

	/** Shows the main move on the drill position, as the solid green arrow among the lines. */
	function showMain() {
		settle();
		stopPlay();
		revealed = true;
		seeking = false;
		selected = main ?? '';
		goTo(end);
	}

	async function next() {
		if (!card || phase !== 'result') return;
		settle();
		const id = card.card.id;
		phase = 'loading';
		// A miss comes back a few cards later for practice (not in random order: that's purely a shuffle).
		if (!firstTry && settings.drillOrder !== 'random' && (requeued.get(id) ?? 0) < MAX_REPEATS) {
			requeued.set(id, (requeued.get(id) ?? 0) + 1);
			const at = Math.min(queue.length, index + 1 + REPEAT_GAP);
			queue = [...queue.slice(0, at), id, ...queue.slice(at)];
		}
		await load(index + 1);
	}

	/** The streak in a few words, for the phone top bar after answering. */
	function streakShort(c: CardRecord): string {
		if (repeat) return 'Practice';
		if (!firstTry) return 'Back to 0';
		const n = c.streak + 1;
		return n >= KNOWN_STREAK ? 'Known' : `${n} in a row`;
	}

	/** What the answer did to the card's streak, shown above Continue. */
	function outcome(c: CardRecord): string {
		if (repeat) return firstTry ? 'Practice round: right this time.' : 'Practice round: it comes back again soon.';
		if (!firstTry) {
			// Right now, but only after a miss: say so, so "back to 0" doesn't read as contradicting the result.
			const lead = result && result.kind !== 'wrong' ? 'Missed on the first try · back to 0' : 'Back to 0';
			return settings.drillOrder === 'random' ? `${lead}.` : `${lead} · it comes back in a few cards.`;
		}
		const n = c.streak + 1;
		if (n < KNOWN_STREAK) return `${n} in a row · ${KNOWN_STREAK - n} more and it’s known.`;
		return n === KNOWN_STREAK ? 'Known: 3 in a row.' : `Known · ${n} in a row.`;
	}

	/** Where the card stands, shown with the position. */
	function standing(c: CardRecord): string {
		if (repeat) return 'practice round';
		if (c.playedAgain) return `played again in a game on ${new Date(c.playedAgain).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
		if (c.missed) return 'missed last time';
		const status = statusOf(c);
		return status === 'new' ? 'new' : status === 'known' ? 'known' : `${c.streak} in a row`;
	}

	async function skipForGood() {
		if (!card || !line) return;
		const id = card.card.id;
		menuOpen = false;
		await data().suspendCard(id);
		queue = queue.filter((q, i) => i <= index || q !== id);
		clearTimeout(stoppedTimer);
		stopped = { id, san: sanOf(line.pos, card.card.wrong) };
		stoppedTimer = setTimeout(() => (stopped = null), 5000);
		await load(index + 1);
	}

	/** Undo for "stop drilling this": the card is drilled again and comes straight back. */
	async function undoStop() {
		if (!stopped) return;
		const { id } = stopped;
		clearTimeout(stoppedTimer);
		stopped = null;
		await data().unsuspendCard(id);
		queue = [...queue.slice(0, index), id, ...queue.slice(index)];
		await load(index);
		void refreshDrill();
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const nav = NAV_KEYS[e.key];
		if (e.key === 'Escape' && sheet) sheet = false;
		else if (e.key === 'Escape') goto(`${base}/`);
		else if (nav && card && ['intro', 'ask', 'checking', 'result'].includes(phase)) step(nav);
		else if (phase === 'intro') finishIntro();
		else if (phase === 'result') {
			const chip = /^[1-9]$/.test(e.key) ? chips[Number(e.key) - 1] : undefined;
			if (chip) preview(chip.key, 1);
			else if (e.key === 'p' && selected !== null) play(selected);
			else if ((e.key === ' ' || e.key === 'Enter') && (result?.kind !== 'wrong' || revealed)) next();
			else if (e.key === 'r' && result?.kind === 'wrong' && !revealed) retry();
			else return;
		} else return;
		e.preventDefault();
	}

	const moveNo = (p: Ply, i: number) => (p.white ? `${p.moveNumber}.` : i === 0 ? `${p.moveNumber}…` : '');

	onMount(async () => {
		const phone = matchMedia('(max-width: 899px)');
		narrow = phone.matches;
		phone.addEventListener('change', (e) => (narrow = e.matches));
		writtenExplanations().then((e) => (explanations = e));
		await ready;
		if (!settings.username) phase = 'empty';
		else await start();
	});

	/** Scrolls a sideways row just enough to show `item`, and not at all when it's already in view, so rows don't slide under the finger. */
	function reveal(row: HTMLElement | undefined, item: HTMLElement | null | undefined) {
		if (!row || !item) return;
		const pad = 12;
		const left = item.offsetLeft - row.offsetLeft;
		if (left < row.scrollLeft + pad) row.scrollLeft = Math.max(0, left - pad);
		else if (left + item.offsetWidth > row.scrollLeft + row.clientWidth - pad) row.scrollLeft = left + item.offsetWidth - row.clientWidth + pad;
	}

	// Keep the selected line's chip in view.
	$effect(() => {
		void [selected, chips.length];
		reveal(chipsEl, chipsEl?.querySelector<HTMLElement>('.selected'));
	});

	// Keep the move on the board (or the move to find, or the line's first move) in view in the move row.
	$effect(() => {
		void [pv, cursor, phase, selected];
		const row = movesEl;
		reveal(row, row && (row.querySelector<HTMLElement>('.current') ?? row.querySelector<HTMLElement>('.ask') ?? row.querySelector<HTMLElement>('.first')));
	});

	// The "more" menu closes on any touch outside it.
	$effect(() => {
		if (!menuOpen) return;
		const close = (e: PointerEvent) => {
			if (!menuEl?.contains(e.target as Node)) menuOpen = false;
		};
		document.addEventListener('pointerdown', close, true);
		return () => document.removeEventListener('pointerdown', close, true);
	});

	// The first cards are created while the analysis runs: start as soon as they exist.
	$effect(() => {
		if (phase === 'empty' && drill.total) void start();
	});

	// While the sheet is open the page behind it stays put.
	$effect(() => {
		if (!(sheet && narrow)) return;
		document.documentElement.classList.add('sheet-open');
		return () => document.documentElement.classList.remove('sheet-open');
	});

	onDestroy(() => {
		stopPlay();
		clearTimeout(introTimer);
		void engine?.then((e) => e.terminate());
	});
</script>

<svelte:window onkeydown={onKey} />

{#snippet mainNote(pos: Chess, detail: CardDetail)}
	{@const m = detail.main}
	{#if m?.why === 'thematic'}
		The thematic move is <strong>{sanOf(pos, m.uci)}</strong>, the green arrow.
	{:else if m?.why === 'punish'}
		<strong>{sanOf(pos, m.uci)}</strong> (the green arrow) punishes {slip} most directly.
	{:else if m}
		The main move is <strong>{sanOf(pos, m.uci)}</strong>, the green arrow.
	{/if}
{/snippet}

{#snippet storyBlock(key: string)}
	{@const chip = chipOf(key)}
	{@const said = storyFor(key)}
	{@const listed = lineNotes(key)}
	<section class="story">
		{#if chip}
			<div class="story-head {chip.kind}">
				{numbered(key)} · {chip.tag}{#if evalOf(key)}<span class="num"> · {formatEval(evalOf(key))}</span>{/if}
			</div>
		{/if}
		{#if key === (main ?? '') && bookLine.length}
			<p class="line-source">
				{engineLine ? 'The engine’s line.' : 'The moves follow the explanation below.'}
				<button class="text-btn" onclick={() => ((engineLine = !engineLine), preview(key, 1))}>
					{engineLine ? 'Show the explanation’s line' : 'Show the engine’s line'}
				</button>
			</p>
		{/if}
		{#if summary(key)}<p class="said">{summary(key)}</p>{/if}
		{#each said as s, i (i)}<p class="said">{s}</p>{/each}
		{@render lineExtras(key)}
		{#if listed.length}
			<ul class="notes">
				{#each listed as n, i (i)}
					<li class={n.tone}>
						<button class="note-link" class:current={viewKey === key && viewN === n.n} onclick={() => preview(key, n.n)} title="Show on the board">
							{n.text}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/snippet}

{#snippet ideaBlock(w: Explanation)}
	{@const basis = principleById.get(w.principleId)}
	<section class="idea">
		<p class="idea-head">{w.headline}</p>
		{@render ideasList(w)}
		<div class="principle">
			<span class="principle-name">{basis?.title ?? 'Principle'}</span>
			{w.principle}
		</div>
		{#if basis || w.sources?.length}
			<p class="sources faint">
				{#if basis}<span>{basis.source}</span>{/if}
				{#each w.sources ?? [] as src, i (i)}
					{@const link = sourceLink(src)}
					<span>{#if link.url}<a href={link.url} target="_blank" rel="noopener">{link.label}</a>{:else}{link.label}{/if}</span>
				{/each}
			</p>
		{/if}
	</section>
{/snippet}

<!-- How a line relates to the opening's ideas, and (for another common move) how it compares, once shown. -->
{#snippet lineExtras(key: string)}
	{@const alt = altOf(key)}
	{#if answerShown && written}
		{#if key === card?.card.wrong && written.habit?.strays}
			<p class="idea-tag bad">Strays from <strong>{written.habit.strays.idea}</strong>: {written.habit.strays.text}</p>
		{:else if key === (main ?? '') && written.taught?.enforces}
			<p class="idea-tag good">Carries out <strong>{written.taught.enforces.idea}</strong>: {written.taught.enforces.text}</p>
		{:else if alt && main !== undefined}
			<p class="after-head">{alt.label === 'sound' || alt.label === 'slightly worse' ? `Compared with ${numbered(main)}` : `What ${numbered(main)} does instead`}</p>
			<p class="said">{alt.after}</p>
		{/if}
	{/if}
{/snippet}

<!-- The opening's main ideas, researched: one line each. -->
{#snippet ideasList(w: Explanation)}
	{#if w.ideas?.length}
		<section class="ideas">
			<p class="ideas-head">Main ideas</p>
			<ul>
				{#each w.ideas as idea (idea.title)}
					<li><strong>{idea.title}</strong><span class="side">{sideName(idea.side)}</span>{idea.text}</li>
				{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<!-- Explanation text with its moves linked to the board: a tap shows the move; the move on the board is highlighted. -->
{#snippet linked(text: string, prefer: string | null)}
	{#each linkRuns(text, prefer) as run, i (i)}
		{#if run.to}{@const to = run.to}<button class="mv-link" class:current={atRun(run)} onclick={() => followLink(to)}>{run.text}</button>{:else}{run.text}{/if}
	{/each}
{/snippet}

{#snippet moreMenu(pos: Chess)}
	<details class="menu" bind:open={menuOpen} bind:this={menuEl}>
		<summary aria-label="More options" title="More options">⋯</summary>
		<div class="menu-body card">
			<button class="text-btn quiet" onclick={skipForGood}>I play {sanOf(pos, card!.card.wrong)} on purpose · stop drilling this</button>
		</div>
	</details>
{/snippet}

{#snippet verdictLabel(r: Result)}
	{#if r.kind === 'wrong'}Not quite{:else if main !== undefined && r.played !== main}Good move{:else}Correct{/if}
{/snippet}

<div class="drill">
	<header class="bar" class:answered={phase === 'result' && !!result}>
		<a class="icon-btn" href="{base}/" aria-label="End session" title="End session (Esc)"><Icon name="close" /></a>
		<div class="track" aria-hidden="true"><span style:width="{100 * progress}%"></span></div>
		{#if phase === 'result' && result && line}
			<!-- On phones the result sits up here, so the board and the review fit the screen. -->
			<div class="status {tone}">
				<Icon name={result.kind === 'wrong' ? 'close' : 'check'} size={16} />
				{@render verdictLabel(result)}
				<strong>{sanOf(line.pos, result.played)}</strong>
				{#if result.eval}<span class="num faint">{formatEval(result.eval)}</span>{/if}
			</div>
		{/if}
		<span class="num faint count">{Math.min(index + (phase === 'done' ? 0 : 1), queue.length)}/{queue.length}</span>
		{#if narrow && phase === 'result' && result && line && card && (result.kind !== 'wrong' || revealed)}
			<!-- Phones: the streak and the rarely used menu sit up here, far from Continue. -->
			<span class="streak-top" class:miss={!firstTry}>{streakShort(card.card)}</span>
			{@render moreMenu(line.pos)}
		{/if}
	</header>

	{#if phase === 'empty'}
		<section class="center card">
			{#if !settings.username}
				<h2>Import your games first</h2>
				<p class="dim">Drills are built from the first mistakes in the lines you play most.</p>
				<a class="btn btn-primary" href="{base}/">Get started</a>
			{:else if analysis.running}
				<h2>Preparing your cards…</h2>
				<p class="dim">Your games are being analysed. The drill starts here as soon as the first mistakes are found.</p>
			{:else}
				<h2>No cards yet</h2>
				<p class="dim">No costly first mistakes were found in your common lines. Import more games or lower the minimum in Settings.</p>
				<a class="btn btn-quiet" href="{base}/leaks">See your first mistakes</a>
			{/if}
		</section>
	{:else if phase === 'done'}
		<section class="center card">
			<div class="label">{queue.length > 1 ? 'Whole deck done' : 'Done'}</div>
			<h2>{stats.done} {stats.done === 1 ? 'card' : 'cards'} · {pct(stats.done ? stats.firstTry / stats.done : 0)} first try</h2>
			<p class="dim">{drill.known} of {drill.total} cards known.</p>
			<div class="actions">
				<button class="btn btn-primary" onclick={() => ((phase = 'loading'), void start())}>Go again</button>
				<a class="btn btn-quiet" href="{base}/">Done</a>
			</div>
		</section>
	{:else if card && line && shown}
		{@const from = phase === 'result' && !fullPath && cursor >= end ? end : 0}
		<div class="stage">
			<!-- Everything for exploring the lines is on or right under the board. -->
			<div class="board-col">
				<div class="board-row" bind:this={boardEl}>
					<div class="evalbar" title={shownEval ? 'Evaluation, White’s view' : phase === 'result' ? 'No evaluation for this move' : 'Shown once you answer'}>
						<EvalBar value={shownEval} orientation={color} horizontal={narrow} />
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
					<div class="board" bind:clientWidth={boardWidth} onpointerdown={boardTouch}>
						<Board
							fen={shown.fen}
							orientation={color}
							turnColor={shownPos?.turn ?? line.pos.turn}
							check={shownPos?.isCheck() ?? false}
							lastMove={shown.lastMove}
							{dests}
							{shapes}
							{animationMs}
							{onMove}
						/>
					</div>
				</div>

				{#if phase === 'result' && chips.length}
					<div class="chips-row">
					<button
						class="chip-line home"
						class:selected={!pv && cursor === end}
						onclick={() => goTo(end)}
						title="Back to the position, with every line as an arrow"
					>
						<Icon name="refresh" size={15} />
						<span>Position</span>
					</button>
					<div class="chips" role="group" aria-label="Lines to review" bind:this={chipsEl}>
						{#each chips as c, i (c.key)}
							<button
								class="chip-line {c.kind}"
								class:selected={selected === c.key}
								onclick={() => preview(c.key, 1)}
								title="{c.tag}: go to the line ({i + 1})"
							>
								<span class="mark" aria-hidden="true">
									{#if c.kind === 'good'}<Icon name="check" size={13} />{:else if c.kind === 'bad'}<Icon name="close" size={13} />{:else}<span
											class="dot"
										></span>{/if}
								</span>
								<span class="num">{chipSan(c.key)}</span>
								{#if evalOf(c.key)}<span class="num ev">{formatEvalShort(evalOf(c.key))}</span>{/if}
							</button>
						{/each}
					</div>
					</div>
				{/if}

				<!-- The game (folded to its last moves in the review), then the line under review; dots mark notes. -->
				<div class="navrow">
					<button class="icon-btn" disabled={!canBack} onclick={() => step(-1)} aria-label="Previous move" title="Previous move (←)"><Icon name="chevron-left" size={18} /></button>
					<nav class="moves" bind:this={movesEl} aria-label="Moves">
						{#if from > 0}<button class="mv more" onclick={() => (fullPath = true)} title="Show the game’s moves">…</button>{/if}
						{#each line.plies.slice(from) as ply, j (from + j)}
							<button class="mv num past" class:current={!pv && cursor === from + j + 1} onclick={() => goTo(from + j + 1)}>
								{#if ply.white}<span class="faint">{ply.moveNumber}.</span>{:else if j === 0}<span class="faint">{ply.moveNumber}…</span>{/if}{ply.san}
							</button>
						{/each}
						{#if phase === 'result' && viewKey !== null}
							{@const key = viewKey}
							{#each lineOf(key) as ply, i (i)}
								<button
									class="mv num {kindOf(key)}"
									class:first={i === 0}
									class:current={pv?.key === key && pv.n === i + 1}
									class:noted={viewNotes.some((n) => n.n === i + 1)}
									onclick={() => preview(key, i + 1)}
								>
									{moveNo(ply, i)}{ply.san}
								</button>
							{/each}
							{#if !lines[key]}<span class="mv faint">…</span>{/if}
						{:else if phase !== 'result'}
							<span class="mv num ask">{#if line.pos.turn === 'white'}<span class="faint">{line.pos.fullmoves}.</span>{/if}?</span>
						{/if}
					</nav>
					<button class="icon-btn" disabled={!canForward} onclick={() => step(1)} aria-label="Next move" title="Next move (→)"><Icon name="chevron-right" size={18} /></button>
					{#if phase === 'result' && selected !== null}
						{@const key = selected}
						<button
							class="play"
							class:on={playing === key}
							disabled={lineOf(key).length < 2}
							onclick={() => play(key)}
							aria-label={playing === key ? 'Stop' : 'Play the line'}
							title={playing === key ? 'Stop (P)' : 'Play the line from here (P)'}
						>
							<Icon name={playing === key ? 'pause' : 'play'} size={18} />
							<span>{playing === key ? 'Stop' : 'Play'}</span>
						</button>
					{/if}
				</div>

				<!-- What to do, or what's happening on the move on the board (its arrows are drawn). -->
				<div class="note" aria-live="polite">
					{#if phase === 'intro'}
						<p class="phone">Here’s the position… <span class="faint">tap the board to skip</span></p>
						<p class="phone opening-note">{card.opening ?? 'Opening'} · as {color}</p>
					{:else if phase === 'ask'}
						<p class="phone">
							<strong>Your move</strong>
							<span class="faint">· {standing(card.card)} · reached {card.reached}×</span>
						</p>
						<p class="phone opening-note">{card.opening ?? 'Opening'} · as {color}</p>
					{:else if phase === 'checking'}
						<p class="faint">Checking…</p>
					{:else if lineSummary || notesHere.length}
						{#if lineSummary}<p class="summary {kindOf(viewKey ?? '')}">{lineSummary}</p>{/if}
						{#if notesHere.length}
							<ul class="notes">
								{#each notesHere as n, i (i)}<li class={n.tone}>{n.text}</li>{/each}
							</ul>
						{/if}
					{:else if answerShown && written && (viewN === 0 || (viewN > 0 && (viewKey === (main ?? '') || viewKey === card.card.wrong)))}
						<p class="headline-note">{written.headline}</p>
					{:else if caption}
						<p class="faint">{caption}</p>
					{/if}
					{#if away && phase !== 'result'}<button class="text-btn back" onclick={() => goTo(end)}>Back to the position</button>{/if}
				</div>
			</div>

			<aside class="panel">
				<div class="title" class:asking={phase !== 'result'}>
					<span class="opening">{card.opening ?? 'Opening'}</span>
					<span class="faint as">as {color}</span>
				</div>

				{#if phase === 'intro' || phase === 'ask' || phase === 'loading' || phase === 'checking'}
					<div class="prompt desktop">
						<h2>{phase === 'intro' ? 'Here’s the position…' : phase === 'checking' ? 'Checking…' : 'Your move'}</h2>
						<p class="dim">
							You reached this position {card.reached} {card.reached === 1 ? 'time' : 'times'} · {standing(card.card)}
						</p>
						{#if phase === 'intro'}<p class="faint small">Click the board to skip</p>{/if}
						{#if phase === 'ask'}<p class="faint small">← → to step through the moves</p>{/if}
					</div>
				{:else if result}
					<!-- On phones the whole box opens the Why sheet (the › says so): the way in while looking for the taught move,
					     when the footer holds Show it and Continue. -->
					<!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
					<div
						class="verdict {tone}"
						class:opens={narrow}
						role={narrow ? 'button' : undefined}
						tabindex={narrow ? 0 : undefined}
						aria-label={narrow ? 'Why: open the explanation' : undefined}
						onclick={() => narrow && calm(openSheet)()}
						onkeydown={(e) => narrow && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openSheet())}
					>
						{#if narrow}<span class="opens-mark" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>{/if}
						<div class="headline">
							<span class="badge-icon" aria-hidden="true"><Icon name={result.kind === 'wrong' ? 'close' : 'check'} size={18} /></span>
							{@render verdictLabel(result)}
							<span class="san">{sanOf(line.pos, result.played)}</span>
							{#if result.eval}<span class="eval-pill num">{formatEval(result.eval)}</span>{/if}
						</div>
						<!-- While looking for the main move after a sound one, the box says just that (the top bar has the rest). -->
						{#if !seeking && !(narrow && result.played !== main && (revealed || found))}<p class="dim">
							{#if result.kind === 'correct'}
								{@const a = card.answers.find((x) => x.uci === result!.played)}
								{#if result.played !== main}
									{a?.why === 'engine' ? 'The engine’s choice.' : a?.why === 'book' ? 'A book move.' : 'Holds the balance.'}
									{#if a?.share}Masters play it {pct(a.share)} of the time.{/if}
								{:else if why === 'thematic'}
									{@const engine = card.answers.find((x) => x.why === 'engine' && x.uci !== main)}
									The thematic move: masters play it {pct(a?.share ?? 0)} of the time.
									{#if engine}
										The engine’s first choice is <strong>{sanOf(line.pos, engine.uci)}</strong>{engine.eval ? ` (${formatEval(engine.eval)})` : ''}.
									{/if}
								{:else if why === 'punish'}
									It punishes {slip}{#if card.opponentBefore && card.eval}, which took the game from {stateOf(card.opponentBefore)} to
										{stateOf(card.eval)}{/if}.
								{:else}
									{why === 'offbook' ? 'Out of book, so the engine is the guide: this is its choice.' : 'The engine’s choice.'}
									{#if a?.share}Masters play it {pct(a.share)} of the time.{/if}
								{/if}
							{:else if result.kind === 'also'}
								{#if card.eval}The best move keeps {kept(card.eval)}.{/if}
							{:else}
								{#if result.played === card.card.wrong}Your habit: {card.wrongCount}× in your games.{/if}
								{#if result.eval && card.eval}It takes the game from {stateOf(card.eval)} to {stateOf(result.eval)}.{/if}
								{#if result.reply}The red arrow shows {line.pos.turn === 'white' ? 'Black' : 'White'}’s answer.{/if}
							{/if}
						</p>{/if}
						{#if result.kind !== 'wrong' && main !== undefined && result.played !== main && !seeking}
							{#if found}
								<p class="found"><Icon name="check" size={15} /> You found it: <strong>{numbered(main)}</strong> is {theMain}.</p>
							{:else}
								<p class="dim">{@render mainNote(line.pos, card)}</p>
							{/if}
						{:else if seeking}
							<p class="dim seek">
								{why === 'thematic' ? 'Masters mostly play another move.' : why === 'punish' ? `There’s a stronger way to punish ${slip}.` : 'The engine prefers another move.'}
								Find it on the board.
							</p>
						{:else if result.kind === 'wrong' && why === 'punish' && !revealed}
							<p class="faint small">
								{`Hint: ${slip} was a slip. Find the move that punishes it.`}
							</p>
						{/if}
						{#if revealed && !found && result.kind === 'wrong'}
							<p class="answer">
								{why === 'thematic' ? 'The thematic move here is' : why === 'punish' ? 'The punishing move here is' : 'The move here is'}
								<strong>{numbered(main ?? '')}</strong>, the green arrow.
							</p>
						{/if}
					</div>

					{#if !narrow}
						{#if selected !== null}{@render storyBlock(selected)}{/if}
						{#if written && answerShown}{@render ideaBlock(written)}{/if}
					{/if}

					<div class="foot">
						<!-- The right button always goes forward (Try again, or Continue) and the left one is the alternative, so a habitual
						     or double tap lands on something harmless; taps are also ignored for 400 ms after the buttons change. -->
						{#if result.kind === 'wrong' && !revealed}
							<div class="actions">
								<button class="btn btn-quiet" onclick={calm(showMain)}>Show answer</button>
								<button class="btn btn-primary forward" onclick={calm(retry)}>Try again</button>
							</div>
						{:else}
							{#if !narrow}
								<div class="foot-row">
									<p class="small streak" class:miss={!firstTry}>{outcome(card.card)}</p>
									{@render moreMenu(line.pos)}
								</div>
							{/if}
							<div class="actions">
								{#if seeking}
									<button class="btn btn-quiet" onclick={calm(showMain)}>Show it</button>
								{:else if narrow}
									<button class="btn btn-quiet" onclick={calm(openSheet)} aria-haspopup="dialog">Why?</button>
								{/if}
								<button class="btn btn-primary forward" onclick={calm(next)}>Continue</button>
							</div>
						{/if}
					</div>
				{/if}
			</aside>
		</div>

		{#if narrow && sheet && phase === 'result' && result}
			{@const key = selected ?? (main ?? '')}
			{@const said = storyFor(key)}
			{@const at = pv ? lineOf(pv.key)[pv.n - 1] : undefined}
			{@const stepKey = pv?.key ?? key}
			{@const length = lineOf(stepKey).length}
			{@const tag = ideaTag(key)}
			{@const alt = altOf(key)}
			{@const opening = !!written && answerShown}
			<!-- Phones: the explanation under the board, so the board stays in view while reading. Swipes on the
			     board do nothing while it's open; a tap there closes it. -->
			<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
			<div class="sheet-backdrop" onclick={() => (sheet = false)}></div>
			<div class="sheet" class:full={sheetFull} style:top={sheetFull ? undefined : `${sheetTop}px`} role="dialog" aria-label="Why">
				<!-- Tap to expand or shrink; drag up to expand, down to shrink or close. -->
				<button
					class="sheet-grab"
					onpointerdown={grabStart}
					onpointerup={grabEnd}
					onpointercancel={() => (grabY = null)}
					onclick={(e) => e.detail === 0 && (sheetFull = !sheetFull)}
					aria-label={sheetFull ? 'Shrink' : 'Expand'}
				>
					<span class="grabber"></span>
				</button>
				<div class="sheet-head">
					<div class="sheet-lines" role="group" aria-label="Lines">
						{#each chips as c (c.key)}
							<button
								class="chip-line {c.kind}"
								class:selected={sheetView === 'line' && selected === c.key}
								onclick={() => ((sheetView = 'line'), preview(c.key, 1))}
							>
								<span class="mark" aria-hidden="true">
									{#if c.kind === 'good'}<Icon name="check" size={13} />{:else if c.kind === 'bad'}<Icon name="close" size={13} />{:else}<span
											class="dot"
										></span>{/if}
								</span>
								<span class="num">{chipSan(c.key)}</span>
							</button>
						{/each}
						{#if opening}
							<!-- The opening as a whole: its ideas (or, on older cards, the principle) and sources, in one place
							     instead of under every line. Room for more opening-level sections as the explanations grow. -->
							<button class="chip-line opening" class:selected={sheetView === 'opening'} onclick={() => showOpening()}>
								<Icon name="idea" size={16} />
								<span>{written?.ideas?.length ? 'Ideas' : 'Principle'}</span>
							</button>
						{/if}
					</div>
					<button class="icon-btn sheet-close" onclick={() => (sheet = false)} aria-label="Close"><Icon name="close" size={18} /></button>
				</div>

				<!-- The move on the board: step through the line from here. -->
				<div class="sheet-step">
					<button class="icon-btn" disabled={!canBack} onclick={() => step(-1)} aria-label="Previous move"><Icon name="chevron-left" size={20} /></button>
					<div class="step-text">
						<span class="step-move num {pv ? kindOf(pv.key) : ''}">
							{#if at && pv}{formatPlies([at])}<span class="faint">{` · ${pv.n}/${length}`}</span>{:else if cursor === end}The position{:else}Earlier in the game{/if}
						</span>
						{#if sheetView === 'line' && key === (main ?? '') && bookLine.length}
							<button
								class="engine-toggle"
								aria-pressed={engineLine}
								onclick={() => ((engineLine = !engineLine), preview(key, 1))}
								title={engineLine ? 'Showing the engine’s line: tap for the line from the explanation' : 'Showing the line from the explanation: tap for the engine’s line'}
							>
								<span>Engine line</span>
							</button>
						{/if}
					</div>
					<button class="icon-btn" disabled={!canForward} onclick={() => step(1)} aria-label="Next move"><Icon name="chevron-right" size={20} /></button>
					<button class="play" class:on={playing === stepKey} disabled={length < 2} onclick={() => play(stepKey)} aria-label={playing === stepKey ? 'Stop' : 'Play the line'}>
						<Icon name={playing === stepKey ? 'pause' : 'play'} size={18} />
					</button>
				</div>

				<div class="sheet-body">
					{#if sheetView === 'line'}
						{#if tag}
							<button class="idea-pill {tag.tone}" onclick={() => showOpening(tag.idea)} title="Show this idea">
								{#if tag.tone === 'good'}<Icon name="check" size={14} />{:else if tag.tone === 'bad'}<Icon name="close" size={14} />{:else}<Icon
										name="idea"
										size={14}
									/>{/if}
								<span>{tag.tone === 'bad' ? 'Strays from ' : ''}<strong>{tag.idea}</strong></span>
							</button>
						{/if}
						{#if written && answerShown && (key === (main ?? '') || key === card.card.wrong)}
							<h3 class="sheet-headline">{written.headline}</h3>
						{/if}
						{#if said.length}
							<p class="said">{@render linked(said.join(' '), key)}</p>
						{:else if summary(key)}
							<p class="said">{summary(key)}</p>
						{/if}
						<!-- A step's computed note, except on the first move when the written text already covers it. -->
						{#if notesHere.length && !(viewN === 1 && said.length)}
							<ul class="step-notes">
								{#each notesHere as n, i (i)}<li class={n.tone}>{n.text}</li>{/each}
							</ul>
						{/if}
						{#if alt && answerShown && main !== undefined}
							<p class="after-head">
								{alt.label === 'sound' || alt.label === 'slightly worse' ? `Compared with ${numbered(main)}` : `What ${numbered(main)} does better`}
							</p>
							<p class="said">{@render linked(alt.after, key)}</p>
						{/if}
					{:else if written}
						{@const basis = principleById.get(written.principleId)}
						<p class="opening-title">{card.opening ?? 'Opening'} <span class="faint">· as {color}</span></p>
						<div class="opening-meta">
							{#each written.themes ?? [] as t (t)}<span class="theme">{t}</span>{/each}
							{#if written.ideas?.length}
								<span class="side-key faint"><span class="side-dot you"></span>You <span class="side-dot opponent"></span>Them <span class="side-dot both"></span>Both</span>
							{/if}
						</div>
						{#if written.ideas?.length}
							<ul class="idea-list">
								{#each written.ideas as idea (idea.title)}
									{@const isOpen = openSections.has(idea.title)}
									<li>
										<button class="idea-row" aria-expanded={isOpen} onclick={() => toggleSection(idea.title)}>
											<span class="side-dot {idea.side}" title={idea.side === 'you' ? 'Your idea' : idea.side === 'both' ? 'Both sides' : 'Your opponent’s idea'}></span>
											<span class="idea-title">{idea.title}</span>
											<span class="chev" class:up={isOpen}><Icon name="chevron-down" size={16} /></span>
										</button>
										{#if isOpen}
											<div class="idea-more">
												<p>{@render linked(idea.text, null)}</p>
												{#each ideaMoves(idea.title) as r, i (i)}
													<p class="idea-move {r.tone}"><strong>{r.move}</strong> {@render linked(r.text, null)}</p>
												{/each}
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
						<div class="section">
							<button class="idea-row" aria-expanded={openSections.has('principle')} onclick={() => toggleSection('principle')}>
								<span class="idea-title">Principle · {basis?.title ?? 'Why it works'}</span>
								<span class="chev" class:up={openSections.has('principle')}><Icon name="chevron-down" size={16} /></span>
							</button>
							{#if openSections.has('principle')}
								<div class="idea-more">
									<p>{@render linked(written.principle, null)}</p>
									{#if basis}<p class="faint small">{basis.source}</p>{/if}
								</div>
							{/if}
						</div>
						{#if written.sources?.length}
							<div class="section">
								<button class="idea-row" aria-expanded={openSections.has('sources')} onclick={() => toggleSection('sources')}>
									<span class="idea-title">Sources ({written.sources.length})</span>
									<span class="chev" class:up={openSections.has('sources')}><Icon name="chevron-down" size={16} /></span>
								</button>
								{#if openSections.has('sources')}
									<ul class="source-list">
										{#each written.sources as src, i (i)}
											{@const link = sourceLink(src)}
											<li>{#if link.url}<a href={link.url} target="_blank" rel="noopener">{link.label}</a>{:else}<span>{link.label}</span>{/if}</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	{:else}
		<div class="center" aria-busy="true"></div>
	{/if}

	{#if stopped}
		<!-- Undo for "stop drilling this", low on the screen where the next card has nothing yet. -->
		<div class="toast" role="status">
			<span>Stopped drilling <strong>{stopped.san}</strong></span>
			<button class="btn btn-quiet" onclick={undoStop}>Undo</button>
		</div>
	{/if}
</div>

<style>
	.drill {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.track {
		flex: 1;
		height: 5px;
		border-radius: 999px;
		background: var(--bg-elev-2);
		overflow: hidden;
	}

	.track span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 300ms var(--ease);
	}

	.status {
		display: none;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 7px;
		font-weight: 650;
		color: var(--c);
		white-space: nowrap;
		overflow: hidden;
	}

	.status.correct {
		--c: var(--win);
	}

	.status.also {
		--c: var(--book);
	}

	.status.wrong {
		--c: var(--loss);
	}

	.status strong {
		color: var(--text);
	}

	.count {
		min-width: 3.5em;
		text-align: right;
		font-size: 14px;
	}

	.center {
		max-width: 460px;
		margin: 10vh auto 0;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	.center p {
		margin: 0;
	}

	.stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
	}

	/* Board column: eval bar and board, then the lines, the moves and the note. */
	.board-col {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	/* Phones: a thin eval bar above a full-width board. */
	.board-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 4px;
	}

	.evalbar {
		height: 14px;
	}

	/* One row of chips; more scroll sideways. */
	/* Position stays put; the lines scroll sideways next to it, fading at the edge so a cut-off chip reads as "more". */
	.chips-row {
		display: flex;
		gap: 8px;
		min-width: 0;
	}

	.chips {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 8px;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
	}

	.chips::-webkit-scrollbar,
	.moves::-webkit-scrollbar {
		display: none;
	}

	.chip-line {
		--c: var(--book);
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		height: 44px;
		padding: 0 12px 0 7px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, var(--line));
		color: var(--text);
		font-weight: 620;
		font-size: 14px;
		transition:
			background 120ms var(--ease),
			border-color 120ms var(--ease);
	}

	.chip-line.home {
		--c: var(--text-3);
		gap: 5px;
		padding: 0 12px 0 10px;
		color: var(--text-2);
	}

	.chip-line.good {
		--c: var(--win);
	}

	.chip-line.bad {
		--c: var(--loss);
	}

	.chip-line:hover {
		background: color-mix(in srgb, var(--c) 10%, transparent);
	}

	.chip-line.selected {
		border-color: var(--c);
		background: color-mix(in srgb, var(--c) 18%, transparent);
	}

	.chip-line .mark {
		display: inline-grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 20%, transparent);
	}

	.chip-line .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}

	.chip-line .ev {
		color: var(--text-2);
		font-size: 12px;
		font-weight: 600;
	}

	/* ◀ moves ▶ ▶︎: one row, kept scrolled to the move on the board. */
	.navrow {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.navrow .icon-btn {
		flex-shrink: 0;
	}

	/* Play: a labelled button, big enough to hit, that plays the selected line from the move shown. */
	.navrow .play {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 44px;
		padding: 0 14px 0 11px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev));
		border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
		color: var(--accent);
		font-weight: 650;
		font-size: 14px;
	}

	.navrow .play.on {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.navrow .play:disabled {
		opacity: 0.4;
	}

	.moves {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 1px;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
		mask-image: linear-gradient(to right, transparent, #000 10px, #000 calc(100% - 10px), transparent);
	}

	.mv {
		position: relative;
		flex-shrink: 0;
		padding: 4px 6px;
		border-radius: 7px;
		color: var(--text-2);
		font-weight: 550;
		transition:
			background 120ms var(--ease),
			color 120ms var(--ease);
	}

	.mv.past {
		color: var(--text-3);
	}

	button.mv:hover,
	.mv.current {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.mv.good {
		--c: var(--win);
	}

	.mv.bad {
		--c: var(--loss);
	}

	.mv.own {
		--c: var(--book);
	}

	.mv.first {
		color: var(--c);
		font-weight: 680;
	}

	.mv.current {
		box-shadow: inset 0 -2px 0 var(--c, var(--accent));
	}

	.mv.noted::after {
		content: '';
		position: absolute;
		top: 3px;
		right: 1px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--c);
	}

	.mv.ask {
		color: var(--accent);
		font-weight: 650;
	}

	/* The note under the board. */
	.note {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 12px;
		min-height: 42px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-2);
	}

	.note p {
		margin: 0;
	}

	.note .notes {
		flex: 1 1 100%;
		color: var(--text);
	}

	.headline-note {
		font-weight: 650;
		color: var(--text);
	}

	.opening-note {
		flex: 1 1 100%;
		font-size: 13px;
		color: var(--text-3);
	}

	.summary {
		flex: 1 1 100%;
		font-weight: 600;
		color: color-mix(in srgb, var(--c, var(--text)) 75%, var(--text));
	}

	.summary.good {
		--c: var(--win);
	}

	.summary.bad {
		--c: var(--loss);
	}

	.summary.own {
		--c: var(--book);
	}

	.title {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-weight: 650;
		font-size: 17px;
		min-width: 0;
	}

	.opening {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.as {
		flex-shrink: 0;
		white-space: nowrap;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.prompt h2,
	.headline {
		font-size: 22px;
	}

	.prompt p,
	.verdict p {
		margin: 4px 0 0;
	}

	.small {
		font-size: 13px;
	}

	.verdict {
		padding: 12px 16px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--c) 10%, var(--bg-elev));
		border: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
		animation: pop 220ms var(--ease);
	}

	.verdict p {
		font-size: 14px;
	}

	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.98);
		}
	}

	.verdict.correct {
		--c: var(--win);
	}

	.verdict.also {
		--c: var(--book);
	}

	.verdict.wrong {
		--c: var(--loss);
	}

	.headline {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 680;
		color: var(--c);
	}

	.badge-icon {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--c) 22%, transparent);
	}

	.headline .san {
		color: var(--text);
	}

	.eval-pill {
		margin-left: auto;
		padding: 2px 8px;
		border-radius: 7px;
		background: var(--bg-elev-2);
		color: var(--text);
		font-size: 13px;
		font-weight: 650;
	}

	.found {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--win);
	}

	strong {
		color: var(--text);
		font-weight: 650;
	}

	.actions {
		display: flex;
		gap: 10px;
	}

	.actions .btn {
		flex: 1;
	}

	.actions .forward {
		flex: 1.6;
	}

	/* What the explanation says about the selected line, and its notes (each jumps the board to its move). */
	.story {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
	}

	.story-head {
		--c: var(--book);
		font-size: 13px;
		font-weight: 650;
		color: var(--c);
	}

	.story-head.good {
		--c: var(--win);
	}

	.story-head.bad {
		--c: var(--loss);
	}

	.story-head .num {
		color: var(--text-3);
		font-weight: 550;
	}

	.said {
		margin: 0;
		font-size: 15px;
		line-height: 1.5;
	}

	/* Notes: a coloured dot for whose idea it is. */
	.notes {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-2);
	}

	.notes li {
		position: relative;
		padding-left: 16px;
	}

	.notes li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.5em;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dot, var(--text-3));
	}

	.notes li.wrong {
		--dot: var(--loss);
	}

	.notes li.main {
		--dot: var(--win);
	}

	.notes li.position {
		--dot: var(--inaccuracy);
	}

	.note-link {
		text-align: left;
		color: inherit;
		font: inherit;
		border-radius: 4px;
	}

	.note-link:hover,
	.note-link.current {
		color: var(--text);
	}

	.note-link.current {
		background: var(--bg-elev-2);
		box-shadow: 0 0 0 3px var(--bg-elev-2);
	}

	/* The idea: the headline to remember and the principle behind it. */
	.idea {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.idea p {
		margin: 0;
	}

	.idea-head {
		font-size: 17px;
		font-weight: 680;
		line-height: 1.3;
	}

	.principle {
		padding: 8px 12px;
		border-left: 3px solid var(--accent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
		font-size: 14px;
		line-height: 1.45;
		color: var(--text-2);
	}

	.principle-name {
		margin-right: 4px;
		font-weight: 650;
		color: var(--accent);
	}

	.sources {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* "My System · Wikibooks, 2...Bc5 · …" */
	.sources > span + span::before {
		content: '·';
		margin: 0 6px;
	}

	.sources a {
		color: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}

	.text-btn {
		color: var(--accent);
		font-weight: 560;
		font-size: 14px;
	}

	/* "I play … on purpose": a real choice, so it reads as one rather than as fine print. */
	.text-btn.quiet {
		color: var(--text);
		font-weight: 560;
		font-size: 14px;
		text-align: left;
	}

	/* Continue (or Try again) stays in view at the bottom. */
	.foot {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 0 calc(12px + var(--safe-b));
		background: linear-gradient(to bottom, transparent, var(--bg) 14px);
		z-index: 2;
	}

	.foot-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.foot-row p {
		margin: 0;
	}

	.streak {
		color: var(--win);
		font-weight: 600;
	}

	.streak.miss {
		color: var(--text-2);
	}

	.menu {
		position: relative;
	}

	.menu summary {
		list-style: none;
		cursor: pointer;
		padding: 0 8px;
		border-radius: 8px;
		color: var(--text-3);
		font-size: 18px;
		line-height: 28px;
	}

	.menu summary::-webkit-details-marker {
		display: none;
	}

	.menu summary:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.menu-body {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		width: max-content;
		max-width: 280px;
		padding: 10px 12px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	}

	.toast {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: calc(12px + var(--safe-b));
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		max-width: 480px;
		margin: 0 auto;
		padding: 6px 6px 6px 16px;
		border-radius: 14px;
		background: var(--bg-elev-2);
		border: 1px solid var(--line);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		font-size: 14px;
		animation: rise 200ms var(--ease);
	}

	.toast .btn {
		height: 44px;
		background: var(--bg-elev);
		color: var(--accent);
	}

	.line-source {
		margin: 0;
		font-size: 13px;
		color: var(--text-3);
	}

	.line-source .text-btn {
		font-size: 13px;
	}

	/* Phones: the explanation in a sheet from just under the board to the bottom of the screen. */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		background: var(--bg-elev);
		border-top: 1px solid var(--line);
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.45);
		animation: rise 200ms var(--ease);
	}

	/* The grabber: a full-width strip, so it's easy to hit; tap or drag (see grabEnd). */
	.sheet-grab {
		display: grid;
		place-items: center;
		width: 100%;
		height: 22px;
		touch-action: none;
	}

	.grabber {
		width: 36px;
		height: 5px;
		border-radius: 999px;
		background: var(--text-3);
		opacity: 0.6;
	}

	.sheet-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px 6px 12px;
	}

	.chip-line.opening {
		gap: 6px;
		padding: 0 14px 0 11px;
		border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
		color: var(--accent);
	}

	.chip-line.opening.selected {
		background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev));
	}

	.sheet-lines {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 8px;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
	}

	/* The move on the board and its note, with the arrows and Play beside it. */
	.sheet-step {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 12px 8px 6px;
		border-bottom: 1px solid var(--line);
	}

	.step-text {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.step-move {
		font-weight: 650;
		font-size: 15px;
	}

	.step-move.good {
		color: var(--win);
	}

	.step-move.bad {
		color: var(--loss);
	}

	.step-notes {
		margin: 0;
		padding-left: 16px;
		font-size: 14px;
		line-height: 1.4;
		color: color-mix(in srgb, var(--text) 78%, var(--bg-elev));
	}

	.sheet-step .play {
		flex-shrink: 0;
		display: inline-grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev));
		border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
		color: var(--accent);
	}

	.sheet-step .play.on {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.sheet-step .play:disabled {
		opacity: 0.4;
	}

	.sheet-headline {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
		line-height: 1.3;
	}

	/* Reading text: compact, and softer than pure white on the dark sheet. */
	.sheet-body .said {
		margin: 0;
		font-size: 15px;
		line-height: 1.45;
		color: color-mix(in srgb, var(--text) 84%, var(--bg-elev));
	}

	.sheet-body .principle {
		padding: 8px 12px;
		font-size: 14px;
		line-height: 1.45;
	}

	.step-move {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* On: the taught move's line is the engine's; off: the line the explanation walks through. */
	/* 44px to hit, a small pill to look at. */
	.engine-toggle {
		flex-shrink: 0;
		display: inline-grid;
		place-items: center;
		height: 44px;
		padding: 0 4px;
	}

	.engine-toggle span {
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--text-3);
		font-size: 13px;
		font-weight: 600;
	}

	.engine-toggle[aria-pressed='true'] span {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
		background: color-mix(in srgb, var(--accent) 14%, var(--bg-elev));
	}

	/* A move written in the text: tap to see it on the board; the one on the board is filled. */
	.mv-link {
		display: inline;
		padding: 1px 4px;
		margin: 0 -1px;
		border-radius: 6px;
		font: inherit;
		font-weight: 650;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}

	.mv-link.current {
		background: var(--accent);
		color: var(--accent-ink);
	}

	/* The idea a line carries out (green), strays from (red) or relates to (blue): tap to open it. */
	.idea-pill {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		max-width: 100%;
		padding: 0 14px 0 11px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, var(--line));
		background: color-mix(in srgb, var(--c) 10%, var(--bg-elev));
		color: var(--c);
		font-size: 14px;
		text-align: left;
	}

	.idea-pill span {
		color: var(--text-2);
	}

	.idea-pill strong {
		color: var(--text);
	}

	.idea-pill.good {
		--c: var(--win);
	}

	.idea-pill.bad {
		--c: var(--loss);
	}

	.idea-pill.own {
		--c: var(--book);
	}

	/* The opening view: title, themes, then ideas and the principle as rows that open in place. */
	.opening-title {
		margin: 0;
		font-size: 14px;
		font-weight: 650;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Themes, then the colour key, on one row. */
	.opening-meta {
		margin-top: -4px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.theme {
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--bg-elev-2);
		color: var(--text-2);
		font-size: 12px;
	}

	.side-key {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}

	.side-key .side-dot + * {
		margin-right: 6px;
	}

	.side-dot {
		flex-shrink: 0;
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 999px;
	}

	.side-dot.you {
		background: var(--win);
	}

	.side-dot.opponent {
		background: var(--inaccuracy);
	}

	.side-dot.both {
		background: var(--book);
	}

	.idea-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.idea-list li,
	.section {
		border-top: 1px solid var(--line);
	}

	.idea-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 48px;
		text-align: left;
		font-size: 15px;
		font-weight: 620;
	}

	.idea-title {
		flex: 1;
		min-width: 0;
	}

	.chev {
		display: inline-grid;
		color: var(--text-3);
		transition: transform 160ms var(--ease);
	}

	.chev.up {
		transform: rotate(180deg);
	}

	.idea-more {
		padding: 0 0 12px 20px;
		font-size: 15px;
		line-height: 1.45;
		color: color-mix(in srgb, var(--text) 84%, var(--bg-elev));
	}

	.idea-more p {
		margin: 0 0 6px;
	}

	.idea-move {
		font-size: 14px;
	}

	.idea-move.good strong {
		color: var(--win);
	}

	.idea-move.bad strong {
		color: var(--loss);
	}

	.source-list {
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
	}

	.source-list li > * {
		display: block;
		padding: 12px 0 12px 20px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 14px;
		color: var(--text-2);
	}

	.sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 19;
		touch-action: none;
	}

	.sheet.full {
		top: calc(var(--safe-t) + 8px);
	}

	/* The sheet's fixed rows don't drag the page; the chips still scroll sideways. */
	.sheet-head,
	.sheet-step {
		touch-action: none;
	}

	.sheet-lines {
		touch-action: pan-x;
	}

	.sheet-body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 10px 14px calc(14px + var(--safe-b));
	}

	/* Long explanations scroll the sheet instead of squeezing a section until its text spills over the next. */
	.sheet-body > * {
		flex: none;
	}

	/* How a line relates to the opening's ideas: "Strays from …" / "Carries out …". */
	.idea-tag {
		margin: 0;
		font-size: 13px;
		line-height: 1.4;
		color: var(--text-2);
	}

	.idea-tag.bad strong {
		color: var(--loss);
	}

	.idea-tag.good strong {
		color: var(--win);
	}

	.after-head {
		margin: 2px 0 -4px;
		font-size: 13px;
		font-weight: 650;
		color: var(--accent);
	}

	.ideas-head {
		margin: 0 0 4px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.ideas ul {
		margin: 0;
		padding-left: 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
		line-height: 1.4;
		color: color-mix(in srgb, var(--text) 84%, var(--bg-elev));
	}

	.ideas .side {
		margin: 0 6px;
		padding: 0 6px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 11px;
		color: var(--text-3);
		vertical-align: 1px;
	}

	@keyframes rise {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}

	@media (max-width: 899px) {
		/* The result goes in the top bar; the board, lines, moves and note fill the screen above Continue. */
		.bar.answered .track {
			display: none;
		}

		.bar.answered .status {
			display: flex;
		}

		.desktop {
			display: none;
		}

		.drill {
			gap: 6px;
		}

		/* 36px to look at, 44px to hit. */
		.bar .icon-btn {
			width: 44px;
			height: 44px;
			margin: -4px;
		}

		/* After answering: the streak and the menu replace the card count. */
		.bar.answered .count {
			display: none;
		}

		.streak-top {
			flex-shrink: 0;
			font-size: 13px;
			font-weight: 600;
			color: var(--win);
			white-space: nowrap;
		}

		.streak-top.miss {
			color: var(--text-3);
		}

		.bar .menu {
			margin: -4px -4px -4px 0;
		}

		.bar .menu summary {
			display: grid;
			place-items: center;
			width: 44px;
			height: 44px;
			padding: 0;
			line-height: 1;
		}

		/* Footer: a fixed-width alternative on the left, the forward action filling the rest, with a 12px buffer between. */
		.actions {
			gap: 12px;
		}

		.actions .btn {
			height: 48px;
			flex: 0 0 142px;
			padding: 0 12px;
		}

		.actions .forward {
			flex: 1;
		}

		.bar .menu-body .text-btn {
			display: flex;
			align-items: center;
			min-height: 48px;
			text-align: left;
		}

		/* Opens downwards from the top bar, over the board. */
		.bar .menu-body {
			top: calc(100% + 4px);
			bottom: auto;
			z-index: 5;
		}

		/* The moves read as text on phones: the arrows and the chips do the navigating, so there are no 30px targets 1px apart. */
		.moves .mv {
			pointer-events: none;
		}

		.stage {
			gap: 8px;
		}

		.panel {
			gap: 8px;
		}

		/* Fixed heights, so text never pushes the buttons around: the note keeps two lines, the box two lines per paragraph. */
		.note {
			height: 42px;
			min-height: 0;
			overflow: hidden;
		}

		.verdict.opens {
			position: relative;
			padding-right: 34px;
			cursor: pointer;
		}

		.opens-mark {
			position: absolute;
			right: 10px;
			top: 50%;
			transform: translateY(-50%);
			display: inline-grid;
			color: var(--c);
			opacity: 0.8;
		}

		.verdict p {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			overflow: hidden;
		}

		/* The opening's name is under the board while answering and at the top of the Why sheet afterwards. */
		.title {
			display: none;
		}

		.story {
			order: 1;
		}

		.verdict {
			order: 2;
		}

		.idea {
			order: 3;
		}

		.foot {
			order: 4;
		}

		/* The top bar already says Correct / Not quite: keep just the detail. */
		.verdict .headline {
			display: none;
		}

		.verdict {
			padding: 10px 14px;
		}

		.verdict > p:first-of-type {
			margin-top: 0;
		}

		.foot .foot-row p {
			font-size: 12px;
		}
	}

	@media (min-width: 900px) {
		.phone {
			display: none;
		}

		/* Board column and panel fill the window without scrolling; only the panel's text scrolls inside it. */
		.stage {
			--board: clamp(320px, min(calc(100vh - 330px), calc(100vw - 640px)), 860px);
			grid-template-columns: calc(var(--board) + 40px) minmax(380px, 640px);
			justify-content: center;
			gap: 32px;
			align-items: start;
		}

		.board-row {
			grid-template-columns: 32px minmax(0, 1fr);
			gap: 8px;
		}

		.evalbar {
			height: auto;
		}

		.chips,
		.navrow,
		.note {
			margin-left: 40px;
		}

		.note {
			height: 62px;
			overflow-y: auto;
		}

		.panel {
			height: calc(var(--board) + 160px);
		}

		.story {
			flex: 1 1 auto;
			overflow-y: auto;
		}

		.foot {
			margin-top: auto;
			padding-bottom: 0;
		}
	}
</style>
