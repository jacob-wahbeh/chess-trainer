<script lang="ts">
	import { formatEval, whiteCp, winPercent, type Eval } from '$lib/analysis/score';

	/** No value: an empty bar (the eval isn't known, or not shown yet). */
	let { value, orientation = 'white' }: { value?: Eval; orientation?: 'white' | 'black' } = $props();

	/** White's share of the bar, by win chance like the Lichess bar. */
	const white = $derived(value ? winPercent(whiteCp(value)) : 50);
	/** The number sits at the end of the side that's ahead. */
	const leader = $derived(white >= 50 ? 'white' : 'black');
</script>

<div class="eval" class:flip={orientation === 'black'} class:empty={!value} aria-label={value ? `Evaluation ${formatEval(value)}` : 'Evaluation'}>
	<span class="fill" style:height="{white}%"></span>
	{#if value}
		<span class="value num {leader}" class:bottom={leader === orientation}>{formatEval(value)}</span>
	{/if}
</div>

<style>
	.eval {
		position: relative;
		display: flex;
		flex-direction: column-reverse;
		height: 100%;
		border-radius: 6px;
		overflow: hidden;
		background: #2b2e35;
		box-shadow: inset 0 0 0 1px var(--line);
		transition: opacity 200ms var(--ease);
	}

	.eval.flip {
		flex-direction: column;
	}

	.eval.empty {
		opacity: 0.35;
	}

	.fill {
		display: block;
		background: #eceef1;
		transition: height 450ms var(--ease);
	}

	.value {
		position: absolute;
		left: 0;
		right: 0;
		top: 6px;
		text-align: center;
		font-size: 10.5px;
		font-weight: 680;
		letter-spacing: -0.03em;
	}

	.value.bottom {
		top: auto;
		bottom: 6px;
	}

	.value.white {
		color: #17181c;
	}

	.value.black {
		color: #eceef1;
	}
</style>
