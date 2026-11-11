<script lang="ts">
	import { base } from '$app/paths';
	import { chessgroundMove } from 'chessops/compat';
	import { parseUci } from 'chessops/util';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { formatPlies, sanOf, walk } from '$lib/chess/line';
	import { cardId, cardWorthy } from '$lib/drill/cards';
	import { writtenExplanations } from '$lib/explain/written';
	import { exploreHref, pct } from '$lib/format';
	import { settings } from '$lib/state.svelte';
	import type { LeakView } from '$lib/worker/data.worker';
	import Board from './Board.svelte';
	import LabelChip from './LabelChip.svelte';

	let { leak }: { leak: LeakView } = $props();

	const line = $derived(walk(leak.path));
	const mySan = $derived(sanOf(line.pos, leak.uci));
	const better = $derived(
		[...new Set([leak.best, ...leak.masters.map((m) => m.uci)].filter((u): u is string => !!u && u !== leak.uci))]
			.slice(0, 2)
			.map((u) => sanOf(line.pos, u))
	);
	const arrow = (uci: string | undefined, brush: string): DrawShape[] => {
		const move = uci ? parseUci(uci) : undefined;
		if (!move) return [];
		const [orig, dest] = chessgroundMove(move) as Key[];
		return [{ orig, dest, brush }];
	};
	const shapes = $derived([...arrow(leak.uci, 'red'), ...arrow(leak.best !== leak.uci ? leak.best : undefined, 'green')]);
	const recent = $derived(formatPlies(line.plies.slice(-6)));
	const drillHref = $derived(cardWorthy(leak) ? `${base}/drill?card=${encodeURIComponent(cardId(settings.username, leak.color, leak.key, leak.uci))}` : null);
	let explained = $state(false);
	$effect(() => {
		const id = `${leak.key}|${leak.uci}`;
		writtenExplanations().then((all) => (explained = !!all[id]));
	});
</script>

<div class="leak card">
<a class="main" href={exploreHref(leak.color, leak.path)} title="See this line in the explorer">
	<div class="thumb">
		<Board fen={line.fen} orientation={leak.color} lastMove={line.lastMove} {shapes} coordinates={false} viewOnly />
	</div>
	<div class="body">
		<div class="top">
			<span class="opening">{leak.opening ?? 'Opening'}</span>
			<span class="pts num" title="Approximate game points lost here">−{leak.points.toFixed(1)} pts</span>
		</div>
		<div class="line num faint">{line.plies.length > 6 ? '… ' : ''}{recent}</div>
		<div class="verdict">
			<span>You play <strong>{mySan}</strong></span>
			<LabelChip label={leak.label} drop={leak.drop} before={leak.before} after={leak.after} />
		</div>
		<div class="meta dim">
			{#if better.length}Better: <strong>{better.join(' or ')}</strong> · {/if}first mistake in {leak.first}
			{leak.first === 1 ? 'game' : 'games'}{#if leak.share !== null} · masters {pct(leak.share)}{/if}
		</div>
	</div>
</a>
{#if drillHref}
	<div class="actions">
		{#if explained}<span class="tag">Explained</span>{/if}
		<a class="btn btn-quiet drill" href={drillHref}>Drill</a>
	</div>
{/if}
</div>

<style>
	.leak {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		transition:
			background 120ms var(--ease),
			border-color 120ms var(--ease);
	}

	/* Hover only with a pointer that hovers: on iPhone it sticks after a tap. */
	@media (hover: hover) {
		.leak:hover {
			background: var(--bg-elev-2);
		}
	}

	.main {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr);
		gap: 14px;
		color: inherit;
	}

	/* A full-width Drill button, 12px below the card's explorer link. */
	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 4px;
	}

	.tag {
		font-size: 12px;
		font-weight: 600;
		color: var(--book);
	}

	.drill {
		flex: 1;
	}

	.thumb {
		width: 96px;
		pointer-events: none;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.opening {
		font-weight: 620;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pts {
		flex: none;
		font-weight: 650;
		color: var(--loss);
	}

	.line {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.verdict {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.meta {
		font-size: 13px;
	}

	strong {
		color: var(--text);
		font-weight: 650;
	}
</style>
