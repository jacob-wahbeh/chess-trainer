<script lang="ts">
	import type { Stats } from '$lib/games/types';

	let { stats, height = 6 }: { stats: Stats; height?: number } = $props();
	const pct = (x: number) => (stats.n ? (100 * x) / stats.n : 0);
</script>

<div
	class="bar"
	style:height="{height}px"
	title="{stats.w} won · {stats.d} drawn · {stats.l} lost"
	aria-label="{stats.w} won, {stats.d} drawn, {stats.l} lost"
>
	<span class="w" style:width="{pct(stats.w)}%"></span>
	<span class="d" style:width="{pct(stats.d)}%"></span>
	<span class="l" style:width="{pct(stats.l)}%"></span>
</div>

<style>
	.bar {
		display: flex;
		width: 100%;
		border-radius: 999px;
		overflow: hidden;
		background: var(--bg-elev-2);
		gap: 2px;
	}

	span {
		display: block;
		transition: width 240ms var(--ease);
	}

	.w {
		background: var(--win);
	}

	.d {
		background: var(--draw);
	}

	.l {
		background: var(--loss);
	}
</style>
