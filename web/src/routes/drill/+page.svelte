<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { normalizeMove, type Chess } from 'chessops/chess';
	import { chessgroundDests, chessgroundMove } from 'chessops/compat';
	import { makeFen } from 'chessops/fen';
	import { makeUci, parseUci } from 'chessops/util';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { chessopsUci } from '$lib/analysis/runner';
	import { formatEval, type Eval } from '$lib/analysis/score';
	import { continuation, formatPlies, positions, sanOf, walk, type Ply } from '$lib/chess/line';
	import { ACCEPT_DROP, autoGrade, dropOf, Rating, shuffled, State, type Grade } from '$lib/drill/cards';
	import { EnginePool, type EvalResult } from '$lib/engine/pool';
	import { page } from '$app/state';
	import { sourceLink, type Explanation } from '$lib/explain/check';
	import { writtenExplanations } from '$lib/explain/written';
	import { principleById } from '$lib/explain/principles';
	import { explainFacts, passTurn, type Fact, type Shape } from '$lib/explain/facts';
	import { pct } from '$lib/format';
	import { analysis, drill, ready, refreshDrill, settings } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { CardDetail } from '$lib/worker/data.worker';
	import Board from '$lib/ui/Board.svelte';
	import EvalBar from '$lib/ui/EvalBar.svelte';
	import Icon from '$lib/ui/Icon.svelte';

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

	const GRADES: { grade: Grade; label: string; key: string }[] = [
		{ grade: Rating.Again, label: 'Again', key: '1' },
		{ grade: Rating.Hard, label: 'Hard', key: '2' },
		{ grade: Rating.Good, label: 'Good', key: '3' },
		{ grade: Rating.Easy, label: 'Easy', key: '4' }
	];
	/** Plies replayed before each card (the earlier ones appear instantly). */
	const INTRO_PLIES = 8;
	/** Time per replayed move for each setup speed; the start position is held a little longer. */
	const INTRO_MS = { slow: 1000, normal: 600, fast: 300 } as const;
	/** Arrow keys step through the moves; up and down jump to the start and back to the latest. */
	const NAV_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -Infinity, ArrowDown: Infinity };
	/** Time per move when a line plays itself out on the board. */
	const PLAY_MS = 900;

	let phase = $state<Phase>('loading');
	let queue = $state<string[]>([]);
	let index = $state(0);
	let card = $state<CardDetail | null>(null);
	/** Board position along the line: 0 is the start, `end` the drill position, `end + 1` the move played. */
	let cursor = $state(0);
	let played = $state<string | null>(null);
	/** An explanation line being stepped through: its first `n` moves are on the board. */
	let pv = $state<{ key: string; n: number } | null>(null);
	let result = $state<Result | null>(null);
	let revealed = $state(false);
	let firstTry = $state(true);
	let grade = $state<Grade>(Rating.Good);
	/** Engine continuations keyed by their first move ('' = the engine's own choice when no answer is known). */
	let lines = $state.raw<Record<string, Ply[]>>({});
	/** Evaluation of each engine line (White's view), for the eval bar and the line cards. */
	let evals = $state.raw<Record<string, Eval>>({});
	/** The opponent's engine line with a free turn, to find what they threaten. */
	let threat = $state.raw<Ply[] | null>(null);
	/** The fact being shown on the board, with its arrows. */
	let focused = $state<Fact | null>(null);
	/** The line playing itself out on the board. */
	let playing = $state<string | null>(null);
	/** Whether the written explanation is expanded; it stays open from card to card once opened. */
	let fullText = $state(false);
	let explainRun = 0;
	/** Explanations written ahead of time (scripts/explanations.ts), by `${position key}|${habit}`. */
	let explanations = $state.raw<Record<string, Explanation>>({});
	let stats = $state({ done: 0, firstTry: 0 });
	let nextDue = $state<number | undefined>(undefined);
	/** Cards to keep practicing with once this session is done. */
	let more = $state<string[]>([]);
	/** Whether the current card is ahead of schedule: only a miss is recorded. */
	let practicing = $state(false);
	/** Extra-practice cards not yet recorded; new cards among them are learned normally. */
	let practice = new Set<string>();
	const requeued = new Map<string, number>();
	let askedAt = 0;
	let introTimer: ReturnType<typeof setTimeout> | undefined;
	let playTimer: ReturnType<typeof setInterval> | undefined;
	let engine: Promise<EnginePool> | undefined;

	const line = $derived(card ? walk(card.card.path) : null);
	const end = $derived(line?.plies.length ?? 0);
	/** The moves to the position, plus the one played once there is an answer. */
	const trail = $derived(line ? (played ? [...line.plies, ...continuation(line.pos, [played])] : line.plies) : []);
	const frames = $derived(card ? positions(played ? [...card.card.path, played] : card.card.path) : []);
	const color = $derived(card?.card.color ?? 'white');
	const main = $derived(card?.main?.uci);
	const why = $derived(card?.main?.why);
	/** The opponent's last move ("5...h6") when the answer punishes it. */
	const slip = $derived(line && why === 'punish' ? formatPlies(line.plies.slice(-1)) : '');
	const written = $derived(card ? explanations[`${card.card.key}|${card.card.wrong}`] : undefined);
	/** The move explained as failing: the one just played if it was wrong, otherwise the usual habit. */
	const wrongMove = $derived(result?.kind === 'wrong' ? result.played : card?.card.wrong);
	/** Checked facts about the failing move and the taught one, from the engine lines as they arrive. */
	const facts: Fact[] = $derived.by(() => {
		if (!card || !line || !result || !wrongMove) return [];
		return explainFacts({ pos: line.pos, path: card.card.path, wrong: wrongMove, wrongLine: lines[wrongMove], main, mainLine: main ? lines[main] : undefined, threat });
	});
	const about = (a: Fact['about']) => facts.filter((f) => f.about === a);
	const progress = $derived(queue.length ? Math.min(1, index / queue.length) : 0);

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
	/** Whether the board shows the moment a fact is about: its line at its move, or the drill position. */
	const onView = (f: Fact) => (f.line !== undefined && f.n ? pv?.key === f.line && pv.n === f.n : !pv && cursor === end);
	const isFocused = (f: Fact) => focused?.text === f.text && onView(f);
	/** "5...Qc7", the move numbered as in the notation. */
	const numbered = (uci: string) => (line ? formatPlies(continuation(line.pos, [uci])) || uci : uci);
	const lineName = (key: string) =>
		key === (main ?? '') ? (why === 'thematic' ? 'Thematic line' : 'Best line') : key === wrongMove ? `Why ${numbered(key)} fails` : 'Your line';

	const pvPlies = $derived(pv ? (lines[pv.key] ?? []) : []);
	const shown: Frame | null = $derived(pv && line ? playOut(line.pos, pvPlies.slice(0, pv.n)) : (frames[cursor] ?? null));
	const shapes: DrawShape[] = $derived.by(() => {
		if (phase !== 'result' || !result) return [];
		if (focused && onView(focused)) return toShapes(focused.shapes);
		if (pv) return [];
		if (revealed && cursor === end) return arrow(main, 'green');
		if (result.kind === 'wrong' && cursor === end + 1) return arrow(result.reply, 'red');
		return [];
	});
	/** The eval bar, once the card is answered: the drill position, the move played, or the line on the board. */
	const shownEval: Eval | undefined = $derived.by(() => {
		if (phase !== 'result' || !result) return undefined;
		if (pv) return evals[pv.key];
		if (cursor === end) return card?.eval;
		return cursor === end + 1 ? result.eval : undefined;
	});
	/** What the board shows, under it: the fact being shown, or where in a line it is. */
	const caption = $derived.by(() => {
		if (focused && onView(focused)) return focused.text;
		const last = pv && pvPlies[pv.n - 1];
		return pv && last ? `${lineName(pv.key)} · ${formatPlies([last])}` : '';
	});
	/** Looking at something other than the position to answer (or the answer just played). */
	const away = $derived((phase === 'ask' || phase === 'result') && (!!pv || cursor < end));
	/** Moves can only be made on the drill position itself, not while looking back through the line. */
	const dests = $derived(phase === 'ask' && line && cursor === end ? (chessgroundDests(line.pos) as Map<Key, Key[]>) : undefined);
	/** Pieces slide more slowly during the setup replay so each move is easy to follow. */
	const animationMs = $derived(phase === 'intro' ? Math.min(450, (INTRO_MS[settings.introSpeed] ?? 600) * 0.6) : 200);

	async function load(i: number) {
		clearTimeout(introTimer);
		stopPlay();
		result = null;
		lines = {};
		evals = {};
		threat = null;
		focused = null;
		revealed = false;
		firstTry = true;
		played = null;
		pv = null;
		if (i >= queue.length) {
			phase = 'done';
			const s = await data().session(settings.newPerDay);
			nextDue = s.nextDue;
			more = [...shuffled(s.ids), ...shuffled(s.extra)];
			practice = new Set(s.extra);
			void refreshDrill();
			return;
		}
		index = i;
		const detail = await data().cardDetail(queue[i]);
		if (!detail) return load(i + 1);
		card = detail;
		practicing = practice.has(detail.card.id) && detail.card.fsrs.state !== State.New;
		startIntro();
	}

	/** Scheduled cards first; with none left, extra practice so there is always something to drill. */
	async function start() {
		if (!settings.username) return;
		await data().syncCards();
		// One chosen card (Drill on a mistake): practised like extra practice, so only a miss is recorded.
		const only = page.url.searchParams.get('card');
		if (only && (await data().cardDetail(only))) return begin([only], [only]);
		const s = await data().session(settings.newPerDay);
		nextDue = s.nextDue;
		// Scheduled cards come first, then extra practice; each group in a new order every time.
		if (s.ids.length || s.extra.length) begin([...shuffled(s.ids), ...shuffled(s.extra)], s.extra);
		else phase = 'empty';
	}

	function begin(ids: string[], extra: string[]) {
		practice = new Set(extra);
		requeued.clear();
		queue = ids;
		void load(0);
	}

	/** Cards that come due mid-session (learning steps, a miss a few cards ago) move up to come next. */
	async function promoteDue() {
		const s = await data().session(settings.newPerDay);
		const due = s.ids.filter((id) => id !== queue[index]);
		if (!due.length) return;
		for (const id of due) practice.delete(id);
		queue = [...queue.slice(0, index + 1), ...due, ...queue.slice(index + 1).filter((id) => !due.includes(id))];
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
		askedAt = performance.now();
	}

	/** Steps through the line on the board, then on into the continuation of the move played. */
	function browse(by: number) {
		const follow = played && lines[played]?.length ? played : null;
		if (!pv && follow && by > 0 && cursor === frames.length - 1) pv = { key: follow, n: Math.min(1 + by, lines[follow].length) };
		else if (!pv) cursor = Math.max(0, Math.min(frames.length - 1, cursor + by));
		else if (pv.n + by <= 0) goTo(end);
		else pv = { ...pv, n: Math.min(pv.n + by, pvPlies.length) };
	}

	function goTo(i: number) {
		stopPlay();
		finishIntro(i);
		pv = null;
		cursor = i;
	}

	/** Arrow keys and the buttons under the board. */
	function step(by: number) {
		stopPlay();
		finishIntro(cursor);
		browse(by);
	}

	/** Puts a fact on the board: the moment it's about, with its arrows. */
	function show(f: Fact) {
		if (f.line !== undefined && f.n) preview(f.line, f.n);
		else goTo(end);
		focused = f;
	}

	/** Plays a line out on the board from its first move, or stops it. */
	function play(key: string) {
		if (playing === key) return stopPlay();
		stopPlay();
		focused = null;
		playing = key;
		pv = { key, n: 1 };
		playTimer = setInterval(() => {
			if (!pv || pv.key !== key || pv.n >= (lines[key]?.length ?? 0)) stopPlay();
			else pv = { key, n: pv.n + 1 };
		}, PLAY_MS);
	}

	function stopPlay() {
		clearInterval(playTimer);
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
		if (phase !== 'ask' || !card || !line) return;
		let move = parseUci(orig + dest);
		if (!move || !('from' in move)) return;
		if (line.pos.board.getRole(move.from) === 'pawn' && (dest[1] === '8' || dest[1] === '1')) move = { ...move, promotion: 'queen' };
		const uci = makeUci(normalizeMove(line.pos, move));
		const ms = performance.now() - askedAt;
		const next = after(line.pos, uci);
		played = uci;
		cursor = end + 1;

		let r: Result;
		const answer = card.answers.find((a) => a.uci === uci);
		if (answer) r = { kind: 'correct', played: uci, drop: answer.drop, eval: answer.eval };
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
		if (r.kind === 'wrong') firstTry = false;
		result = r;
		phase = 'result';
		grade = autoGrade({ correctFirstTry: firstTry, ms, state: card.card.fsrs.state });
		void explain(card.card.id, r);
	}

	/**
	 * Engine lines, each starting with a given move: the move played when it's a sound alternative, the main
	 * move, and the wrong (or usual) move with its punishment. Searching after the move keeps a line on the
	 * move it is shown for, even where the engine would start somewhere else.
	 */
	async function explain(id: string, r: Result) {
		if (!line || !card) return;
		const run = ++explainRun;
		const pos = line.pos;
		const best = main ?? '';
		const wrong = r.kind === 'wrong' ? r.played : card.card.wrong;
		const own = r.kind !== 'wrong' && r.played !== main ? r.played : null;
		for (const key of new Set(own ? [own, wrong, best] : [best, wrong])) {
			if (lines[key]) continue;
			const next = key ? after(pos, key) : null;
			const res = await evaluate(next ? next.frame.fen : line.fen, 16);
			if (run !== explainRun || card?.card.id !== id) return;
			lines = { ...lines, [key]: continuation(pos, key ? [key, ...res.pv] : res.pv).slice(0, 10) };
			evals = { ...evals, [key]: toWhite(res, next ? next.pos : pos) };
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
		stopPlay();
		focused = null;
		result = null;
		revealed = false;
		played = null;
		pv = null;
		cursor = end;
		phase = 'ask';
		askedAt = performance.now();
	}

	function reveal() {
		stopPlay();
		focused = null;
		revealed = true;
		pv = null;
		cursor = end;
	}

	/** Shows the board after the first `n` plies of an explanation line. */
	function preview(key: string, n: number) {
		stopPlay();
		finishIntro(cursor);
		focused = null;
		pv = { key, n };
	}

	/**
	 * The moment a line card's thumbnail shows: the first fact on that line with arrows (a fork, a mate threat,
	 * what a move attacks), else any fact on it, else the move and the reply.
	 */
	function moment(key: string, notes: Fact[]) {
		const plies = lines[key];
		if (!line || !plies?.length) return null;
		const onLine = notes.filter((f) => f.line === key && f.n);
		const fact = onLine.find((f) => f.shapes?.some((s) => s.dest)) ?? onLine[0];
		const n = Math.min(fact?.n ?? (key === wrongMove ? 2 : 1), plies.length);
		const frame = playOut(line.pos, plies.slice(0, n));
		return frame && { frame, n, fact, shapes: toShapes(fact?.shapes) };
	}

	async function next() {
		if (!card || phase !== 'result') return;
		const id = card.card.id;
		phase = 'loading';
		// Practising ahead never pushes a card further out, but a miss brings it back sooner.
		const record = !practicing || grade === Rating.Again;
		if (record) {
			await data().review(id, grade);
			practice.delete(id);
		}
		stats.done++;
		if (firstTry) stats.firstTry++;
		if (record && grade === Rating.Again && (requeued.get(id) ?? 0) < 2) {
			requeued.set(id, (requeued.get(id) ?? 0) + 1);
			queue = [...queue, id];
		}
		await promoteDue();
		await load(index + 1);
	}

	async function skipForGood() {
		if (!card) return;
		await data().suspendCard(card.card.id);
		queue = queue.filter((id, i) => i <= index || id !== card!.card.id);
		await load(index + 1);
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const nav = NAV_KEYS[e.key];
		if (e.key === 'Escape') goto('/');
		else if (nav && card && ['intro', 'ask', 'checking', 'result'].includes(phase)) step(nav);
		else if (phase === 'intro') finishIntro();
		else if (phase === 'result') {
			const g = GRADES.find((x) => x.key === e.key);
			if (g && !practicing) grade = g.grade;
			else if ((e.key === ' ' || e.key === 'Enter') && (result?.kind !== 'wrong' || revealed)) next();
			else if (e.key === 'r' && result?.kind === 'wrong') retry();
			else return;
		} else return;
		e.preventDefault();
	}

	function interval(dueMs: number) {
		const m = Math.max(1, (dueMs - Date.now()) / 60_000);
		if (m < 60) return `${Math.round(m)}m`;
		if (m < 1440) return `${Math.round(m / 60)}h`;
		const d = m / 1440;
		if (d < 30) return `${Math.round(d)}d`;
		return d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;
	}

	const moveNo = (p: Ply, i: number) => (p.white ? `${p.moveNumber}.` : i === 0 ? `${p.moveNumber}…` : '');

	onMount(async () => {
		writtenExplanations().then((e) => (explanations = e));
		await ready;
		if (!settings.username) phase = 'empty';
		else await start();
	});

	// The first cards are created while the analysis runs: start as soon as they exist.
	$effect(() => {
		if (phase === 'empty' && drill.total) void start();
	});

	// Keep the move on the board in view in its line card's row of moves.
	$effect(() => {
		void pv;
		const chip = document.querySelector<HTMLElement>('.plies .ply.current');
		const row = chip?.parentElement;
		if (chip && row) row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
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
		The thematic move is <strong>{sanOf(pos, m.uci)}</strong>, played by masters {pct(detail.answers.find((x) => x.uci === m.uci)?.share ?? 0)} of the time.
	{:else if m?.why === 'punish'}
		<strong>{sanOf(pos, m.uci)}</strong> punishes {slip} most directly.
	{:else if m}
		The main move is <strong>{sanOf(pos, m.uci)}</strong>.
	{/if}
{/snippet}

{#snippet factList(notes: Fact[])}
	{#if notes.length}
		<ul class="facts">
			{#each notes as f, i (i)}
				<li class={f.about}>
					{#if (f.line !== undefined && f.n) || f.shapes?.length}
						<button class="fact" class:current={isFocused(f)} onclick={() => show(f)} title="Show on the board">{f.text}</button>
					{:else}{f.text}{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet lineCard(kind: 'good' | 'bad' | 'own', key: string, tag: string, notes: Fact[] = [])}
	{@const plies = lines[key]}
	{@const shot = moment(key, notes)}
	<article class="line-card {kind}" aria-label={lineName(key)}>
		<div
			class="thumb"
			role="button"
			tabindex="0"
			title="Show on the board"
			onclick={() => shot && (shot.fact ? show(shot.fact) : preview(key, shot.n))}
			onkeydown={(e) => e.key === 'Enter' && shot && (shot.fact ? show(shot.fact) : preview(key, shot.n))}
		>
			{#if shot}
				<Board fen={shot.frame.fen} orientation={color} lastMove={shot.frame.lastMove} shapes={shot.shapes} coordinates={false} viewOnly />
			{:else}
				<div class="thumb-wait" aria-busy="true"></div>
			{/if}
		</div>
		<div class="line-body">
			<header class="line-head">
				<span class="mark" aria-hidden="true">
					{#if kind === 'good'}<Icon name="check" size={16} />{:else if kind === 'bad'}<Icon name="close" size={16} />{:else}<Icon name="arrow" size={16} />{/if}
				</span>
				<span class="line-title num">{plies?.[0] ? formatPlies([plies[0]]) : numbered(key)}</span>
				<span class="tag">{tag}</span>
				{#if evals[key]}<span class="eval-pill num" title="Evaluation after this line">{formatEval(evals[key])}</span>{/if}
				<button class="play" class:on={playing === key} disabled={!plies?.length} onclick={() => play(key)} aria-label={playing === key ? 'Stop' : 'Play the line on the board'}>
					<Icon name={playing === key ? 'pause' : 'play'} size={15} />
				</button>
			</header>
			{@render factList(notes)}
			{#if plies}
				<div class="plies">
					{#each plies as ply, i (i)}
						<button class="ply num" class:current={pv?.key === key && pv.n === i + 1} onclick={() => preview(key, i + 1)}>
							{moveNo(ply, i)}{ply.san}
						</button>
					{/each}
				</div>
			{:else}<div class="faint small">Calculating…</div>{/if}
		</div>
	</article>
{/snippet}

<div class="drill">
	<header class="bar">
		<a class="icon-btn" href="/" aria-label="End session" title="End session (Esc)"><Icon name="close" /></a>
		<div class="track" aria-hidden="true"><span style:width="{100 * progress}%"></span></div>
		<span class="num faint count">{Math.min(index + (phase === 'done' ? 0 : 1), queue.length)}/{queue.length}</span>
	</header>

	{#if phase === 'empty'}
		<section class="center card">
			{#if !settings.username}
				<h2>Import your games first</h2>
				<p class="dim">Drills are built from the first mistakes in the lines you play most.</p>
				<a class="btn btn-primary" href="/">Get started</a>
			{:else if analysis.running}
				<h2>Preparing your cards…</h2>
				<p class="dim">Your games are being analysed. The drill starts here as soon as the first mistakes are found.</p>
			{:else}
				<h2>No cards yet</h2>
				<p class="dim">No costly first mistakes were found in your common lines. Import more games or lower the minimum in Settings.</p>
				<a class="btn btn-quiet" href="/leaks">See your first mistakes</a>
			{/if}
		</section>
	{:else if phase === 'done'}
		<section class="center card">
			<div class="label">Session complete</div>
			<h2>{stats.done} {stats.done === 1 ? 'card' : 'cards'} · {pct(stats.done ? stats.firstTry / stats.done : 0)} first try</h2>
			<p class="dim">{#if nextDue}Next scheduled review in {interval(nextDue)}.{:else}You're all caught up.{/if}</p>
			<div class="actions">
				{#if more.length}<button class="btn btn-primary" onclick={() => begin(more, [...practice])}>Keep practicing</button>{/if}
				<a class="btn {more.length ? 'btn-quiet' : 'btn-primary'}" href="/">Done</a>
			</div>
		</section>
	{:else if card && line && shown}
		<div class="stage">
			<div class="board-col">
				<div class="board-row">
					<div class="evalbar" title={shownEval ? 'Evaluation, White’s view' : phase === 'result' ? 'No evaluation for this move' : 'Shown once you answer'}>
						<EvalBar value={shownEval} orientation={color} />
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
					<div class="board" onclick={() => phase === 'intro' && finishIntro()}>
						<Board
							fen={shown.fen}
							orientation={color}
							turnColor={line.pos.turn}
							lastMove={shown.lastMove}
							{dests}
							{shapes}
							{animationMs}
							{onMove}
						/>
					</div>
				</div>
				<div class="boardbar">
					<div class="stepper" role="group" aria-label="Step through the moves">
						<button class="icon-btn" onclick={() => step(-Infinity)} aria-label="First move" title="First move (↑)"><Icon name="first" size={18} /></button>
						<button class="icon-btn" onclick={() => step(-1)} aria-label="Previous move" title="Previous move (←)"><Icon name="chevron-left" size={18} /></button>
						<button class="icon-btn" onclick={() => step(1)} aria-label="Next move" title="Next move (→)"><Icon name="chevron-right" size={18} /></button>
						<button class="icon-btn" onclick={() => step(Infinity)} aria-label="Last move" title="Last move (↓)"><Icon name="last" size={18} /></button>
					</div>
					<p class="caption {focused && onView(focused) ? focused.about : ''}" aria-live="polite">{caption}</p>
					{#if away}<button class="text-btn back" onclick={() => goTo(end)}>Back to the position</button>{/if}
				</div>
			</div>

			<aside class="panel">
				<div class="title">
					<span class="opening">{card.opening ?? 'Opening'}</span>
					<span class="faint">as {color}</span>
				</div>
				<nav class="moves" aria-label="Moves to this position" title="← → step through the moves">
					{#each trail as ply, i (i)}
						<button
							class="mv num"
							class:current={!pv && cursor === i + 1}
							class:good={i === end && !!result && result.kind !== 'wrong'}
							class:bad={i === end && result?.kind === 'wrong'}
							onclick={() => goTo(i + 1)}
						>
							{#if ply.white}<span class="faint">{ply.moveNumber}.</span>{:else if i === 0}<span class="faint">{ply.moveNumber}…</span>{/if}{ply.san}
						</button>
					{/each}
					{#if !played}
						<span class="mv num ask">{#if line.pos.turn === 'white'}<span class="faint">{line.pos.fullmoves}.</span>{/if}?</span>
					{/if}
				</nav>

				{#if phase === 'intro' || phase === 'ask' || phase === 'loading'}
					<div class="prompt">
						<h2>{phase === 'intro' ? 'Here’s the position…' : 'Your move'}</h2>
						<p class="dim">
							You reached this position {card.reached} {card.reached === 1 ? 'time' : 'times'}{#if card.card.fsrs.state === State.New} · new card{:else if practicing} · extra practice{/if}
						</p>
						{#if phase === 'intro'}<p class="faint small">Tap the board to skip</p>{/if}
						{#if phase === 'ask'}<p class="faint small keys">← → to step through the moves</p>{/if}
					</div>
				{:else if phase === 'checking'}
					<div class="prompt"><h2>Checking…</h2></div>
				{:else if result}
					<div class="verdict {result.kind}">
						<div class="headline">
							<span class="badge-icon" aria-hidden="true"><Icon name={result.kind === 'wrong' ? 'close' : 'check'} size={18} /></span>
							{#if result.kind === 'correct'}Correct{:else if result.kind === 'also'}Also good{:else}Not quite{/if}
							<span class="san">{sanOf(line.pos, result.played)}</span>
							{#if result.eval}<span class="eval-pill num">{formatEval(result.eval)}</span>{/if}
						</div>
						<p class="dim">
							{#if result.kind === 'correct'}
								{@const a = card.answers.find((x) => x.uci === result!.played)}
								{#if result.played !== main}
									{a?.why === 'engine' ? 'The engine’s choice.' : a?.why === 'book' ? 'A book move.' : 'Holds the balance.'}
									{#if a?.share}Masters play it {pct(a.share)} of the time.{/if}
									{@render mainNote(line.pos, card)}
								{:else if why === 'thematic'}
									{@const engine = card.answers.find((x) => x.why === 'engine' && x.uci !== main)}
									The thematic move: masters play it {pct(a?.share ?? 0)} of the time.
									{#if engine}
										The engine’s first choice is <strong>{sanOf(line.pos, engine.uci)}</strong>{#if engine.eval}
											({formatEval(engine.eval)}){/if}.
									{/if}
								{:else if why === 'punish'}
									It punishes {slip}{#if card.opponentBefore && card.eval}, which took the eval from {formatEval(card.opponentBefore)} to
										{formatEval(card.eval)}{/if}.
								{:else}
									{why === 'offbook' ? 'Out of book, so the engine is the guide: this is its choice.' : 'The engine’s choice.'}
									{#if a?.share}Masters play it {pct(a.share)} of the time.{/if}
								{/if}
							{:else if result.kind === 'also'}
								{#if card.eval}The best move keeps {formatEval(card.eval)}.{/if}
								{@render mainNote(line.pos, card)}
							{:else}
								{#if result.played === card.card.wrong}Your habit: {card.wrongCount}× in your games.{/if}
								{#if result.eval && card.eval}It takes the eval from {formatEval(card.eval)} to {formatEval(result.eval)}.{/if}
								{#if result.reply}The red arrow shows {line.pos.turn === 'white' ? 'Black' : 'White'}’s answer.{/if}
							{/if}
						</p>
						{#if result.kind === 'wrong' && why === 'punish' && !revealed}
							<p class="faint small">
								Hint: {slip}{#if card.opponentBefore && card.eval} took the eval from {formatEval(card.opponentBefore)} to {formatEval(card.eval)}{:else} was a slip{/if}.
								Look for the move that punishes it.
							</p>
						{/if}
					</div>

					{#if result.kind === 'wrong' && !revealed}
						<div class="actions">
							<button class="btn btn-primary" onclick={retry}>Try again</button>
							<button class="btn btn-quiet" onclick={reveal}>Show answer</button>
						</div>
					{:else}
						{#if revealed}
							<p class="answer">
								{why === 'thematic' ? 'The thematic move here is' : why === 'punish' ? 'The punishing move here is' : 'The move here is'}
								<strong>{sanOf(line.pos, main ?? '')}</strong>, the green arrow.
							</p>
						{/if}

						{#if written || about('position').length}
							<section class="idea">
								{#if written}
									{@const basis = principleById.get(written.principleId)}
									<p class="idea-head">{written.headline}</p>
									<div class="principle">
										<div class="principle-name">
											{basis?.title ?? 'Principle'}{#if basis}<span class="faint"> · {basis.source}</span>{/if}
										</div>
										<p>{written.principle}</p>
									</div>
								{/if}
								{@render factList(about('position'))}
								{#if written}
									<details class="more" bind:open={fullText}>
										<summary>{fullText ? 'Hide the explanation' : 'Read the full explanation'}</summary>
										<p>{written.why}</p>
										{#if written.sources?.length}
											<p class="sources faint">
												{#each written.sources as src, i (i)}
													{@const link = sourceLink(src)}
													<span>{#if link.url}<a href={link.url} target="_blank" rel="noopener">{link.label}</a>{:else}{link.label}{/if}</span>
												{/each}
											</p>
										{/if}
									</details>
								{/if}
							</section>
						{/if}

						{@const own = result.kind !== 'wrong' && result.played !== main}
						{@const share = card.answers.find((x) => x.uci === main)?.share}
						<div class="lines">
							{#if own}
								{@render lineCard('own', result.played, result.kind === 'correct' ? 'Your move · also book' : 'Your move · also fine')}
							{/if}
							{@render lineCard(
								'good',
								main ?? '',
								why === 'thematic' ? `Thematic${share ? ` · masters ${pct(share)}` : ''}` : why === 'punish' ? `Punishes ${slip}` : 'Engine’s choice',
								about('main')
							)}
							{@render lineCard(
								'bad',
								wrongMove ?? '',
								wrongMove === card.card.wrong ? `Your habit · ${card.wrongCount}×` : 'Your move',
								about('wrong')
							)}
						</div>

						<div class="foot">
							{#if practicing}
								<p class="faint small">
									Extra practice: {firstTry ? 'this card keeps its schedule' : 'the miss brings this card back sooner'}.
								</p>
							{:else}
								<div class="grades" role="group" aria-label="How well did you know it?">
									{#each GRADES as g (g.grade)}
										<button class:selected={grade === g.grade} onclick={() => (grade = g.grade)} title="{g.label} ({g.key})">
											<span>{g.label}</span>
											<span class="num faint">{interval(card.intervals[g.grade])}</span>
										</button>
									{/each}
								</div>
							{/if}
							<button class="btn btn-primary continue" onclick={next}>Continue</button>
						</div>
						<button class="text-btn quiet" onclick={skipForGood}>I play {sanOf(line.pos, card.card.wrong)} on purpose · stop drilling this</button>
					{/if}
				{/if}
			</aside>
		</div>
	{:else}
		<div class="center" aria-busy="true"></div>
	{/if}
</div>

<style>
	.drill {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
		gap: 18px;
	}

	/* Board column: eval bar, board, and the controls under it. */
	.board-col {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.board-row {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr);
		gap: 8px;
	}

	.boardbar {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding-left: 30px;
	}

	.stepper {
		display: flex;
		flex-shrink: 0;
	}

	.stepper .icon-btn {
		width: 36px;
		height: 36px;
	}

	.caption {
		flex: 1;
		margin: 0;
		font-size: 14px;
		line-height: 1.35;
		color: var(--text-2);
		min-width: 0;
	}

	.caption.wrong {
		color: color-mix(in srgb, var(--loss) 70%, var(--text));
	}

	.caption.main {
		color: color-mix(in srgb, var(--win) 70%, var(--text));
	}

	.caption.position {
		color: color-mix(in srgb, var(--inaccuracy) 70%, var(--text));
	}

	.back {
		flex-shrink: 0;
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

	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.moves {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		margin: -6px -7px 0;
	}

	.mv {
		padding: 4px 7px;
		border-radius: 7px;
		color: var(--text-2);
		font-weight: 550;
		transition:
			background 120ms var(--ease),
			color 120ms var(--ease);
	}

	button.mv:hover,
	.mv.current {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.mv.good {
		color: var(--win);
	}

	.mv.bad {
		color: var(--loss);
	}

	.mv.ask {
		color: var(--accent);
		font-weight: 650;
	}

	@media (hover: none) {
		.keys {
			display: none;
		}
	}

	.prompt h2,
	.headline {
		font-size: 22px;
	}

	.prompt p,
	.verdict p,
	.answer {
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

	/* The idea: headline, the principle behind it, and the full text on request. */
	.idea {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.idea p {
		margin: 0;
	}

	.idea-head {
		font-size: 19px;
		font-weight: 680;
		line-height: 1.3;
		letter-spacing: -0.01em;
	}

	.principle {
		padding: 10px 14px;
		border-left: 3px solid var(--accent);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		background: color-mix(in srgb, var(--accent) 8%, var(--bg-elev));
		font-size: 15px;
		line-height: 1.45;
	}

	.principle-name {
		margin-bottom: 3px;
		font-size: 13px;
		font-weight: 650;
		color: var(--accent);
	}

	.principle-name .faint {
		font-weight: 500;
	}

	.more summary {
		cursor: pointer;
		color: var(--accent);
		font-size: 14px;
		font-weight: 560;
		list-style: none;
	}

	.more summary::-webkit-details-marker {
		display: none;
	}

	.more summary::before {
		content: '▸ ';
	}

	.more[open] summary::before {
		content: '▾ ';
	}

	.more p {
		margin-top: 8px;
		font-size: 15px;
		line-height: 1.55;
		color: var(--text-2);
	}

	.sources {
		font-size: 12px;
	}

	/* "Wikibooks, 2...Bc5 · …" */
	.sources > span + span::before {
		content: '·';
		margin: 0 6px;
	}

	.sources a {
		color: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}

	/* Facts: a coloured dot for whose idea it is; the clickable ones show on the board. */
	.facts {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 14px;
		line-height: 1.4;
		color: var(--text-2);
	}

	.facts li {
		position: relative;
		padding-left: 16px;
	}

	.facts li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.5em;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dot, var(--text-3));
	}

	.facts li.wrong {
		--dot: var(--loss);
	}

	.facts li.main {
		--dot: var(--win);
	}

	.facts li.position {
		--dot: var(--inaccuracy);
	}

	.fact {
		text-align: left;
		color: inherit;
		font: inherit;
		text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent);
		text-underline-offset: 3px;
	}

	.fact:hover,
	.fact.current {
		color: var(--text);
		text-decoration-color: currentColor;
	}

	/* Line cards: a thumbnail of the key moment, what happens, and the moves. */
	.lines {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.line-card {
		--c: var(--book);
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		gap: 14px;
		padding: 12px;
		border-radius: var(--radius);
		background: var(--bg-elev);
		border: 1px solid var(--line);
		border-left: 3px solid var(--c);
	}

	.line-card.good {
		--c: var(--win);
	}

	.line-card.bad {
		--c: var(--loss);
	}

	.thumb {
		align-self: start;
		border-radius: 6px;
		overflow: hidden;
		cursor: pointer;
		outline-offset: 2px;
	}

	.thumb-wait {
		aspect-ratio: 1;
		background: var(--bg-elev-2);
	}

	.line-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.line-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.mark {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 50%;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 18%, transparent);
	}

	.line-title {
		font-size: 16px;
		font-weight: 680;
		white-space: nowrap;
	}

	.tag {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		color: var(--text-3);
	}

	.line-head .eval-pill {
		margin-left: 0;
		background: color-mix(in srgb, var(--c) 14%, var(--bg-elev-2));
	}

	.play {
		display: inline-grid;
		place-items: center;
		flex-shrink: 0;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		color: var(--text-2);
		background: var(--bg-elev-2);
		transition:
			background 120ms var(--ease),
			color 120ms var(--ease);
	}

	.play:hover,
	.play.on {
		color: var(--accent-ink);
		background: var(--accent);
	}

	.play:disabled {
		opacity: 0.4;
	}

	.plies {
		position: relative;
		display: flex;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0 -4px;
	}

	.plies::-webkit-scrollbar {
		display: none;
	}

	.ply {
		flex-shrink: 0;
		padding: 4px 7px;
		border-radius: 7px;
		color: var(--text-2);
		font-size: 14px;
		font-weight: 550;
		transition: background 120ms var(--ease);
	}

	.ply:first-child {
		color: var(--c);
		font-weight: 650;
	}

	.ply:hover,
	.ply.current {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.text-btn {
		align-self: flex-start;
		color: var(--accent);
		font-weight: 560;
		font-size: 14px;
	}

	.text-btn.quiet {
		color: var(--text-3);
		font-weight: 500;
		font-size: 13px;
	}

	/* Grades and Continue stay in view at the bottom while the explanation scrolls. */
	.foot {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 0 calc(12px + var(--safe-b));
		background: linear-gradient(to bottom, transparent, var(--bg) 18px);
		z-index: 2;
	}

	.grades {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}

	.grades button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 7px 4px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--bg);
		font-size: 13px;
		font-weight: 600;
		color: var(--text-2);
		transition:
			background 120ms var(--ease),
			border-color 120ms var(--ease);
	}

	.grades button.selected {
		border-color: var(--accent);
		color: var(--text);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg));
	}

	.continue {
		width: 100%;
	}

	@media (min-width: 900px) {
		/* The board takes the height of the window, the panel the rest of the width. */
		.stage {
			--board: clamp(360px, min(calc(100vh - 236px), calc(100vw - 640px)), 860px);
			grid-template-columns: calc(var(--board) + 38px) minmax(380px, 660px);
			justify-content: center;
			gap: 32px;
			align-items: start;
		}

		.board-col {
			position: sticky;
			top: 16px;
		}

		.board-row {
			grid-template-columns: 30px minmax(0, 1fr);
		}

		.boardbar {
			padding-left: 38px;
		}
	}

	@media (max-width: 899px) {
		.line-card {
			grid-template-columns: 92px minmax(0, 1fr);
			gap: 12px;
		}
	}
</style>
