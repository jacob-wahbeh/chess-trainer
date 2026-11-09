<script lang="ts">
	import { chessgroundMove } from 'chessops/compat';
	import { parseUci } from 'chessops/util';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import { formatPlies, sanOf, walk } from '$lib/chess/line';
	import { exploreHref, pct } from '$lib/format';
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
</script>

<a class="leak card" href={exploreHref(leak.color, leak.path)}>
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
			<LabelChip label={leak.label} drop={leak.drop} />
		</div>
		<div class="meta dim">
			{#if better.length}Better: <strong>{better.join(' or ')}</strong> · {/if}first mistake in {leak.first}
			{leak.first === 1 ? 'game' : 'games'}{#if leak.share !== null} · masters {pct(leak.share)}{/if}
		</div>
	</div>
</a>

<style>
	.leak {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr);
		gap: 14px;
		padding: 12px;
		transition:
			background 120ms var(--ease),
			border-color 120ms var(--ease);
	}

	.leak:hover {
		background: var(--bg-elev-2);
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
