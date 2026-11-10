<script lang="ts">
	import { formatEval, formatEvalShort, whiteCp, winPercent, type Eval } from '$lib/analysis/score';

	/**
	 * No value: an empty bar (the eval isn't known, or not shown yet). Vertical beside the board with the player's side
	 * at the bottom, or horizontal above it with the player's side on the left.
	 */
	let { value, orientation = 'white', horizontal = false }: { value?: Eval; orientation?: 'white' | 'black'; horizontal?: boolean } = $props();

	/** White's share of the bar, by win chance like the Lichess bar. */
	const white = $derived(value ? winPercent(whiteCp(value)) : 50);
	/** The number sits at the end of the side that's ahead. */
	const leader = $derived(white >= 50 ? 'white' : 'black');
</script>

<div class="eval" class:flip={orientation === 'black'} class:horizontal class:empty={!value} aria-label={value ? `Evaluation ${formatEval(value)}` : 'Evaluation'}>
	<span class="fill" style:height={horizontal ? null : `${white}%`} style:width={horizontal ? `${white}%` : null}></span>
	{#if value}
		<!-- "near": on the player's side (bottom, or left when horizontal). -->
		<span class="value num {leader}" class:near={leader === orientation} title={formatEval(value)}>{formatEvalShort(value)}</span>
	{/if}
</div>

<style>
	.eval {
		container-type: inline-size;
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
		letter-spacing: -0.02em;
	}

	/* The narrow bar on phones. */
	@container (max-width: 27px) {
		.value {
			font-size: 9.5px;
		}
	}

	.value.near {
		top: auto;
		bottom: 6px;
	}

	.eval.horizontal {
		flex-direction: row;
	}

	.eval.horizontal.flip {
		flex-direction: row-reverse;
	}

	.horizontal .fill {
		height: 100%;
		transition: width 450ms var(--ease);
	}

	.horizontal .value,
	.horizontal .value.near {
		top: 0;
		bottom: 0;
		left: auto;
		right: 6px;
		display: flex;
		align-items: center;
		font-size: 10px;
	}

	.horizontal .value.near {
		left: 6px;
		right: auto;
	}

	.value.white {
		color: #17181c;
	}

	.value.black {
		color: #eceef1;
	}
</style>
