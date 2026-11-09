<script lang="ts">
	import { analysis, lichess } from '$lib/state.svelte';
	import { count } from '$lib/format';

	const p = $derived(analysis.progress);
	const evalPct = $derived(p && p.evals.total ? p.evals.done / p.evals.total : 1);
	const mastersPct = $derived(p?.masters && p.masters.total ? p.masters.done / p.masters.total : 1);
	/** Remaining masters lookups at ~28/minute, as a rough time. */
	const mastersEta = $derived.by(() => {
		const left = p?.masters ? p.masters.total - p.masters.done : 0;
		const minutes = Math.ceil(left / 28);
		return minutes > 1 ? `~${minutes} min left` : left ? 'almost done' : '';
	});
</script>

{#if p && (analysis.running || p.authError || p.error || !lichess.token)}
	<section class="status card">
		{#if p.evals.total && p.evals.done < p.evals.total}
			<div class="row">
				<span>Evaluating positions</span>
				<span class="num dim">{count(p.evals.done)} / {count(p.evals.total)}</span>
			</div>
			<div class="track"><span style:width="{100 * evalPct}%"></span></div>
			<div class="faint small num">{count(p.evals.cloud)} from Lichess's cache · {count(p.evals.local)} by Stockfish on this device</div>
		{/if}

		{#if p.masters && p.masters.done < p.masters.total}
			<div class="row">
				<span>Checking master theory</span>
				<span class="num dim">{count(p.masters.done)} / {count(p.masters.total)}</span>
			</div>
			<div class="track book"><span style:width="{100 * mastersPct}%"></span></div>
			<div class="faint small">
				{p.masters.waiting ? 'Lichess asked us to slow down; resuming in a minute.' : `Lichess allows ~30 lookups a minute · ${mastersEta}`}
				{#if p.masters.skipped}· {count(p.masters.skipped)} skipped (already out of theory){/if}
			</div>
		{/if}

		{#if p.authError}
			<p class="warn">Your Lichess login expired. <a href="/settings">Reconnect</a> to keep checking theory.</p>
		{:else if !lichess.token}
			<p class="dim small">
				Moves are judged by the engine only. <a href="/settings">Connect Lichess</a> to also check them against master games.
			</p>
		{/if}
		{#if p.error}<p class="warn small">{p.error}</p>{/if}
	</section>
{/if}

<style>
	.status {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 16px;
	}

	.row {
		display: flex;
		justify-content: space-between;
		font-weight: 560;
	}

	.track {
		height: 5px;
		border-radius: 999px;
		background: var(--bg-elev-2);
		overflow: hidden;
	}

	.track span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 400ms var(--ease);
	}

	.track.book span {
		background: var(--book);
	}

	.small {
		font-size: 13px;
	}

	p {
		margin: 2px 0 0;
	}

	a {
		color: var(--accent);
		font-weight: 560;
	}

	.warn {
		color: var(--mistake);
	}
</style>
