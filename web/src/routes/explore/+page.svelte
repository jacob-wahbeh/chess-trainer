<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { normalizeMove } from 'chessops/chess';
	import { chessgroundDests, chessgroundMove } from 'chessops/compat';
	import { makeUci, parseUci } from 'chessops/util';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { app } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import { score, type Color } from '$lib/games/types';
	import type { NodeView } from '$lib/tree/tree';
	import type { Opening } from '$lib/tree/openings';
	import { continuation, sanOf, walk } from '$lib/chess/line';
	import { count, pct } from '$lib/format';
	import Board from '$lib/ui/Board.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ResultBar from '$lib/ui/ResultBar.svelte';

	const color: Color = $derived(page.url.searchParams.get('c') === 'black' ? 'black' : 'white');
	const path = $derived((page.url.searchParams.get('m') ?? '').split(',').filter(Boolean));
	const line = $derived(walk(path));
	const ucis = $derived(line.plies.map((p) => p.uci));
	const key = $derived(line.keys[line.keys.length - 1]);

	let flipped = $state(false);
	let node = $state<NodeView | null | undefined>(undefined);
	let main = $state<string[]>([]);
	let opening = $state<Opening | undefined>(undefined);

	$effect(() => {
		if (!app.summary) return;
		const [c, k] = [color, key];
		let cancelled = false;
		Promise.all([data().node(c, k), data().mainLine(c, k)]).then(([n, m]) => {
			if (cancelled) return;
			node = n;
			main = m;
		});
		return () => (cancelled = true);
	});

	$effect(() => {
		const keys = line.keys;
		let cancelled = false;
		data()
			.openingAt(keys)
			.then((o) => {
				if (!cancelled) opening = o;
			});
		return () => (cancelled = true);
	});

	const orientation: Color = $derived(flipped ? (color === 'white' ? 'black' : 'white') : color);
	const yourTurn = $derived(line.pos.turn === color);
	const dests = $derived(chessgroundDests(line.pos) as Map<Key, Key[]>);
	const mainPlies = $derived(continuation(line.pos, main));

	// The most common moves as arrows: the top one solid, the next two faint.
	const shapes: DrawShape[] = $derived(
		(node?.moves ?? []).slice(0, 3).flatMap((m, i) => {
			const move = parseUci(m.uci);
			if (!move) return [];
			const [orig, dest] = chessgroundMove(move) as Key[];
			return [{ orig, dest, brush: i === 0 ? 'blue' : 'paleBlue' }];
		})
	);

	function go(next: string[]) {
		const m = next.length ? `&m=${next.join(',')}` : '';
		goto(`/explore?c=${color}${m}`, { keepFocus: true, noScroll: true });
	}

	function onMove(orig: Key, dest: Key) {
		let move = parseUci(orig + dest);
		if (!move || !('from' in move)) return;
		const piece = line.pos.board.get(move.from);
		if (piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1')) move = { ...move, promotion: 'queen' };
		go([...ucis, makeUci(normalizeMove(line.pos, move))]);
	}

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'ArrowLeft' && ucis.length) go(ucis.slice(0, -1));
		else if (e.key === 'ArrowRight' && node?.moves[0]) go([...ucis, node.moves[0].uci]);
		else if (e.key === 'Home' || e.key === 'ArrowUp') go([]);
		else if (e.key === 'f') flipped = !flipped;
		else return;
		e.preventDefault();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="explore">
	<div class="board-col">
		<div class="title">
			{#if opening}<span class="eco num">{opening.eco}</span>{/if}
			<span class="opening">{opening?.name ?? 'Starting position'}</span>
		</div>
		<Board
			fen={line.fen}
			{orientation}
			turnColor={line.pos.turn}
			lastMove={line.lastMove}
			check={line.pos.isCheck()}
			{dests}
			{shapes}
			{onMove}
		/>
		<div class="controls">
			<button class="icon-btn" onclick={() => go([])} disabled={!ucis.length} aria-label="Start position" title="Start (Home)">
				<Icon name="first" />
			</button>
			<button class="icon-btn" onclick={() => go(ucis.slice(0, -1))} disabled={!ucis.length} aria-label="Back" title="Back (←)">
				<Icon name="chevron-left" />
			</button>
			<button
				class="icon-btn"
				onclick={() => node?.moves[0] && go([...ucis, node.moves[0].uci])}
				disabled={!node?.moves.length}
				aria-label="Most common move"
				title="Most common move (→)"
			>
				<Icon name="chevron-right" />
			</button>
			<button class="icon-btn" onclick={() => (flipped = !flipped)} aria-label="Flip board" title="Flip (F)">
				<Icon name="flip" />
			</button>
		</div>
	</div>

	<aside class="panel">
		<nav class="crumbs" aria-label="Moves">
			<button class="crumb" class:current={!ucis.length} onclick={() => go([])}>Start</button>
			{#each line.plies as ply, i (i)}
				<button class="crumb num" class:current={i === line.plies.length - 1} onclick={() => go(ucis.slice(0, i + 1))}>
					{#if ply.white}<span class="faint">{ply.moveNumber}.</span>{:else if i === 0}<span class="faint">{ply.moveNumber}…</span>{/if}{ply.san}
				</button>
			{/each}
		</nav>

		{#if node === undefined}
			<div class="loading" aria-busy="true"></div>
		{:else if node}
			<div class="reach">
				<div class="reach-top">
					<span class="big num">{count(node.n)}</span>
					<span class="dim">{node.n === 1 ? 'game' : 'games'} reached this position · you scored <strong class="num">{pct(score(node))}</strong></span>
				</div>
				<ResultBar stats={node} height={8} />
			</div>

			{#if node.moves.length}
				<h2 class="section">{yourTurn ? 'Your moves' : 'Their replies'}</h2>
				<ul class="moves">
					{#each node.moves as m (m.uci)}
						<li>
							<button class="move" onclick={() => go([...ucis, m.uci])}>
								<span class="san">{sanOf(line.pos, m.uci)}</span>
								<span class="num dim">{count(m.n)}</span>
								<span class="num share">{pct(m.n / node.n)}</span>
								<span class="mbar"><ResultBar stats={m} height={5} /></span>
								<span class="num score">{pct(score(m))}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="faint">Your games stop here (only the first 15 moves of each game are kept).</p>
			{/if}

			{#if mainPlies.length}
				<h2 class="section">Your most common continuation</h2>
				<div class="mainline">
					{#each mainPlies as ply, i (i)}
						<button class="ply num" onclick={() => go([...ucis, ...main.slice(0, i + 1)])}>
							{#if ply.white}<span class="faint">{ply.moveNumber}.</span>{:else if i === 0}<span class="faint">{ply.moveNumber}…</span>{/if}{ply.san}
						</button>
					{/each}
				</div>
			{/if}
		{:else}
			<div class="empty card">
				<h2>None of your games reached this position</h2>
				<p class="dim">Go back, or try a move your opponents actually played.</p>
			</div>
		{/if}
	</aside>
</div>

<style>
	.explore {
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
		align-items: baseline;
		gap: 8px;
		min-height: 24px;
		font-weight: 600;
	}

	.eco {
		font-size: 12px;
		font-weight: 650;
		color: var(--text-3);
		padding: 2px 6px;
		border: 1px solid var(--line);
		border-radius: 6px;
	}

	.opening {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.controls {
		display: flex;
		justify-content: center;
		gap: 6px;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.crumbs {
		display: flex;
		gap: 2px;
		overflow-x: auto;
		scrollbar-width: none;
		padding-bottom: 2px;
		mask-image: linear-gradient(to right, black 92%, transparent);
	}

	.crumb,
	.ply {
		flex: none;
		padding: 6px 9px;
		border-radius: 8px;
		color: var(--text-2);
		font-weight: 550;
		white-space: nowrap;
		transition:
			background 120ms var(--ease),
			color 120ms var(--ease);
	}

	.crumb:hover,
	.ply:hover {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.crumb.current {
		background: var(--bg-elev-2);
		color: var(--text);
	}

	.loading {
		height: 200px;
	}

	.reach {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.reach-top {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}

	.reach strong {
		color: var(--text);
	}

	.big {
		font-size: 30px;
		font-weight: 680;
		letter-spacing: -0.02em;
	}

	.section {
		margin-top: 6px;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.moves {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.move {
		width: 100%;
		display: grid;
		grid-template-columns: 4.2em 3.4em 3em minmax(40px, 1fr) 3em;
		gap: 12px;
		align-items: center;
		padding: 10px 8px;
		border-radius: 10px;
		text-align: left;
		transition: background 120ms var(--ease);
	}

	.move:hover {
		background: var(--bg-elev-2);
	}

	.san {
		font-weight: 650;
		font-size: 16px;
	}

	.share {
		color: var(--text-2);
	}

	.score {
		text-align: right;
		font-weight: 600;
	}

	.mainline {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.empty {
		padding: 18px;
	}

	.empty p {
		margin: 6px 0 0;
	}

	@media (min-width: 900px) {
		.explore {
			grid-template-columns: minmax(0, min(600px, calc(100vh - 170px))) minmax(320px, 1fr);
			gap: 28px;
			align-items: start;
		}

		.panel {
			padding-top: 34px;
		}
	}
</style>
