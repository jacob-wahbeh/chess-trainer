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
	import { sourceLink, type Explanation } from '$lib/explain/check';
	import { principleById } from '$lib/explain/principles';
	import { explainFacts, passTurn, type Fact } from '$lib/explain/facts';
	import { pct } from '$lib/format';
	import { analysis, drill, ready, refreshDrill, settings } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { CardDetail } from '$lib/worker/data.worker';
	import Board from '$lib/ui/Board.svelte';
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
	/** The opponent's engine line with a free turn, to find what they threaten. */
	let threat = $state.raw<Ply[] | null>(null);
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
	/** Checked facts about the failing move and the taught one, from the engine lines as they arrive. */
	const facts: Fact[] = $derived.by(() => {
		if (!card || !line || !result) return [];
		const wrong = result.kind === 'wrong' ? result.played : card.card.wrong;
		return explainFacts({ pos: line.pos, path: card.card.path, wrong, wrongLine: lines[wrong], main, mainLine: main ? lines[main] : undefined, threat });
	});
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

	const pvPlies = $derived(pv ? (lines[pv.key] ?? []) : []);
	const shown: Frame | null = $derived(pv && line ? playOut(line.pos, pvPlies.slice(0, pv.n)) : (frames[cursor] ?? null));
	const shapes: DrawShape[] = $derived.by(() => {
		if (phase !== 'result' || !result || pv) return [];
		if (revealed && cursor === end) return arrow(main, 'green');
		if (result.kind === 'wrong' && cursor === end + 1) return arrow(result.reply, 'red');
		return [];
	});
	/** Moves can only be made on the drill position itself, not while looking back through the line. */
	const dests = $derived(phase === 'ask' && line && cursor === end ? (chessgroundDests(line.pos) as Map<Key, Key[]>) : undefined);
	/** Pieces slide more slowly during the setup replay so each move is easy to follow. */
	const animationMs = $derived(phase === 'intro' ? Math.min(450, (INTRO_MS[settings.introSpeed] ?? 600) * 0.6) : 200);

	async function load(i: number) {
		clearTimeout(introTimer);
		result = null;
		lines = {};
		threat = null;
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
		finishIntro(i);
		pv = null;
		cursor = i;
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
			const res = await evaluate(key ? after(pos, key).frame.fen : line.fen, 16);
			if (run !== explainRun || card?.card.id !== id) return;
			lines = { ...lines, [key]: continuation(pos, key ? [key, ...res.pv] : res.pv).slice(0, 10) };
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
		result = null;
		revealed = false;
		played = null;
		pv = null;
		cursor = end;
		phase = 'ask';
		askedAt = performance.now();
	}

	function reveal() {
		revealed = true;
		pv = null;
		cursor = end;
	}

	/** Shows the board after the first `n` plies of an explanation line. */
	function preview(key: string, n: number) {
		pv = { key, n };
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
		else if (nav && card && ['intro', 'ask', 'checking', 'result'].includes(phase)) {
			finishIntro(cursor);
			browse(nav);
		} else if (phase === 'intro') finishIntro();
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
		fetch('/explanations.json')
			.then((r) => (r.ok ? r.json() : {}))
			.then((e) => (explanations = e))
			.catch(() => {});
		await ready;
		if (!settings.username) phase = 'empty';
		else await start();
	});

	// The first cards are created while the analysis runs: start as soon as they exist.
	$effect(() => {
		if (phase === 'empty' && drill.total) void start();
	});

	onDestroy(() => {
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
				<li>
					{#if f.line && f.n}
						<button class="fact" class:current={pv?.key === f.line && pv.n === f.n} onclick={() => preview(f.line!, f.n!)}>{f.text}</button>
					{:else}{f.text}{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet engineLine(label: string, key: string, bad = false, notes: Fact[] = [])}
	<div class="line-block">
		<div class="label">{label}</div>
		{@render factList(notes)}
		{#if lines[key]}
			<div class="plies">
				{#each lines[key] as ply, i (i)}
					<button class="ply num" class:bad={bad && i === 0} class:current={pv?.key === key && pv.n === i + 1} onclick={() => preview(key, i + 1)}>
						{moveNo(ply, i)}{ply.san}
					</button>
				{/each}
			</div>
		{:else}<div class="faint small">Calculating…</div>{/if}
	</div>
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
				<div class="title">
					<span class="opening">{card.opening ?? 'Opening'}</span>
					<span class="faint">as {color}</span>
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

			<aside class="panel">
				<div class="notation">
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
					{#if phase === 'ask' && cursor < end}
						<button class="text-btn" onclick={() => goTo(end)}>Back to the position</button>
					{/if}
				</div>

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
							{#if result.kind === 'correct'}Correct{:else if result.kind === 'also'}Also good{:else}Not quite{/if}
							<span class="san">{sanOf(line.pos, result.played)}</span>
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
										The engine’s first choice is <strong>{sanOf(line.pos, engine.uci)}</strong>{#if engine.eval && a?.eval}
											({formatEval(engine.eval)}; this move {formatEval(a.eval)}){/if}.
									{/if}
								{:else if why === 'punish'}
									It punishes {slip}{#if card.opponentBefore && card.eval}, which took the eval from {formatEval(card.opponentBefore)} to
										{formatEval(card.eval)}{/if}.
								{:else}
									{why === 'offbook' ? 'Out of book, so the engine is the guide: this is its choice.' : 'The engine’s choice.'}
									{#if a?.share}Masters play it {pct(a.share)} of the time.{/if}
								{/if}
							{:else if result.kind === 'also'}
								{#if result.eval && card.eval}Eval {formatEval(result.eval)}, against {formatEval(card.eval)} for the best move.{/if}
								{@render mainNote(line.pos, card)}
							{:else}
								{#if result.played === card.card.wrong}This is your habit ({card.wrongCount}× in your games).{/if}
								{#if result.eval && card.eval}It takes the eval from {formatEval(card.eval)} to {formatEval(result.eval)}.{/if}
								{#if result.reply}{line.pos.turn === 'white' ? 'Black' : 'White'} answers with the arrow’s move.{/if}
							{/if}
						</p>
						{#if result.kind !== 'wrong' && card.wrongEval && card.eval}
							<p class="faint small">
								Your usual {sanOf(line.pos, card.card.wrong)} here takes the eval from {formatEval(card.eval)} to {formatEval(card.wrongEval)}.
							</p>
						{:else if result.kind === 'wrong' && why === 'punish' && !revealed}
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
								<strong>{sanOf(line.pos, main ?? '')}</strong>.
							</p>
						{/if}

						{@const about = (a: Fact['about']) => facts.filter((f) => f.about === a)}
						{#if written || about('position').length}
							<div class="why">
								{#if written}
									{@const basis = principleById.get(written.principleId)}
									<p class="why-head">{written.headline}</p>
									<p class="dim">{written.why}</p>
									<p class="principle"><span class="label">Principle</span> {written.principle}</p>
									{#if basis || written.sources?.length}
										<p class="sources faint">
											{#if basis}{basis.title} · {basis.source}{/if}
											{#each written.sources ?? [] as src, i (i)}
												{@const link = sourceLink(src)}
												· {#if link.url}<a href={link.url} target="_blank" rel="noopener">{link.label}</a>{:else}{link.label}{/if}
											{/each}
										</p>
									{/if}
								{/if}
								{@render factList(about('position'))}
							</div>
						{/if}

						{@const wrong = result.kind === 'wrong' ? result.played : card.card.wrong}
						<div class="lines">
							{#if result.kind !== 'wrong' && result.played !== main}
								{@render engineLine('Your line', result.played)}
								{@render engineLine(why === 'thematic' ? 'Thematic line' : 'Main line', main ?? '', false, about('main'))}
							{:else}
								{@render engineLine(why === 'thematic' ? 'Thematic line' : 'Best line', main ?? '', false, about('main'))}
							{/if}
							{@render engineLine(`Why ${sanOf(line.pos, wrong)} fails`, wrong, true, about('wrong'))}
							{#if pv || cursor < end}<button class="text-btn" onclick={() => goTo(end)}>Back to the position</button>{/if}
						</div>

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
		gap: 16px;
	}

	.board-col {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	.title {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-weight: 600;
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

	.notation {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.moves {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		margin: 0 -7px;
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
		padding: 14px 16px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--c) 10%, var(--bg-elev));
		border: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
		animation: pop 220ms var(--ease);
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
		align-items: baseline;
		gap: 10px;
		font-weight: 680;
		color: var(--c);
	}

	.headline .san {
		color: var(--text);
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

	.why {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.why p {
		margin: 0;
	}

	.why-head {
		font-weight: 650;
	}

	.principle {
		font-size: 14px;
		color: var(--text-2);
	}

	.sources {
		font-size: 12px;
	}

	.sources a {
		color: inherit;
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}

	.facts {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
		color: var(--text-2);
	}

	.fact {
		text-align: left;
		color: inherit;
		font: inherit;
	}

	.fact:hover,
	.fact.current {
		color: var(--text);
		text-decoration: underline dotted;
		text-underline-offset: 3px;
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.line-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.plies {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.ply {
		padding: 5px 8px;
		border-radius: 8px;
		color: var(--text-2);
		font-weight: 550;
		transition: background 120ms var(--ease);
	}

	.ply:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.ply.bad {
		color: var(--loss);
	}

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
		padding: 8px 4px;
		border-radius: 10px;
		border: 1px solid var(--line);
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
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.continue {
		width: 100%;
	}

	@media (min-width: 900px) {
		.stage {
			grid-template-columns: minmax(0, min(600px, calc(100vh - 170px))) minmax(320px, 1fr);
			gap: 28px;
			align-items: start;
		}

		.panel {
			padding-top: 34px;
		}
	}

	@media (max-width: 899px) {
		.continue {
			position: sticky;
			bottom: calc(12px + var(--safe-b));
		}
	}
</style>
