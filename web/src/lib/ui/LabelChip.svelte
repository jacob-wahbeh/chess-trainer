<script lang="ts" module>
	import { formatEval, type Eval, type Label } from '$lib/analysis/score';

	export const LABELS: Record<Label, string> = {
		book: 'Book',
		repertoire: 'Your system',
		offbook: 'Off-book',
		ok: 'Sound',
		inaccuracy: 'Inaccuracy',
		mistake: 'Mistake',
		blunder: 'Blunder'
	};
</script>

<script lang="ts">
	/** `before` and `after`: evaluations around the move, shown for mistakes like an eval bar ("+0.45 → −1.21"). */
	let { label, drop = null, before, after }: { label: Label; drop?: number | null; before?: Eval; after?: Eval } = $props();
	const showEval = $derived(!!before && !!after && drop !== null && drop >= 1 && ['inaccuracy', 'mistake', 'blunder', 'offbook'].includes(label));
</script>

<span class="chip {label}">
	{LABELS[label]}{#if showEval}<span class="drop num">{formatEval(before)} → {formatEval(after)}</span>{/if}
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 8px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 650;
		white-space: nowrap;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
	}

	.drop {
		font-weight: 600;
		opacity: 0.85;
	}

	.book {
		--c: var(--book);
	}

	.repertoire {
		--c: var(--accent);
	}

	.offbook {
		--c: var(--text-2);
	}

	.ok {
		--c: var(--win);
	}

	.inaccuracy {
		--c: var(--inaccuracy);
	}

	.mistake {
		--c: var(--mistake);
	}

	.blunder {
		--c: var(--blunder);
	}
</style>
