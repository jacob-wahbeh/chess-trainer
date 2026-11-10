<script lang="ts">
	import { base } from '$app/paths';
	import { analysis, app, drill, saveSettings, settings, sync } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { LeakList } from '$lib/worker/data.worker';
	import AnalysisStatus from '$lib/ui/AnalysisStatus.svelte';
	import LeakCard from '$lib/ui/LeakCard.svelte';
	import { score, type Color } from '$lib/games/types';
	import type { FamilyRow } from '$lib/tree/openings';
	import { count, describeFilter, exploreHref, pct, timeAgo } from '$lib/format';
	import Icon from '$lib/ui/Icon.svelte';
	import InstallHint from '$lib/ui/InstallHint.svelte';
	import ResultBar from '$lib/ui/ResultBar.svelte';

	let username = $state(settings.username);
	let top = $state<Record<Color, FamilyRow[]> | null>(null);
	let leaks = $state<LeakList | null>(null);

	$effect(() => {
		void analysis.version;
		if (!app.summary) return;
		let cancelled = false;
		data()
			.leaks()
			.then((l) => {
				if (!cancelled) leaks = l;
			});
		return () => (cancelled = true);
	});

	$effect(() => {
		if (!app.summary) return;
		let cancelled = false;
		Promise.all([data().families('white'), data().families('black')]).then(([white, black]) => {
			if (!cancelled) top = { white: white.slice(0, 5), black: black.slice(0, 5) };
		});
		return () => (cancelled = true);
	});

	async function start(event: SubmitEvent) {
		event.preventDefault();
		const name = username.trim();
		if (!name) return;
		settings.username = name;
		saveSettings();
		await sync();
	}

	const summary = $derived(app.summary);
	const firstImport = $derived(app.syncing && !summary?.stored);
</script>

{#if app.ready}<InstallHint />{/if}

{#if !app.ready}
	<div class="skeleton" aria-busy="true"></div>
{:else if !settings.username || (!summary?.stored && !app.syncing)}
	<section class="hero">
		<div class="art" aria-hidden="true">
			{#each Array(16) as _, i (i)}<span class:dark={(Math.floor(i / 4) + i) % 2 === 1}></span>{/each}
		</div>
		<h1>Train the openings you actually play.</h1>
		<p class="dim">
			Import your Chess.com games and your lines get sorted by how often you reach them, so you know
			exactly where to focus.
		</p>
		<form onsubmit={start}>
			<input
				class="input"
				placeholder="Chess.com username"
				bind:value={username}
				autocapitalize="off"
				autocomplete="username"
				spellcheck="false"
			/>
			<button class="btn btn-primary" disabled={!username.trim() || app.syncing}>Import games</button>
		</form>
		{#if app.error}<p class="error">{app.error}</p>{/if}
		<p class="faint small">Blitz and rapid from the last 12 months by default. Games stay on this device.</p>
	</section>
{:else if firstImport}
	<section class="importing card">
		<div class="label">Importing</div>
		<h2>
			{#if app.progress}{app.progress.month} · {app.progress.done} of {app.progress.total} months{:else}Finding your games…{/if}
		</h2>
		<div class="track"><span style:width="{app.progress ? (100 * app.progress.done) / app.progress.total : 3}%"></span></div>
		<p class="dim num">{count(app.progress?.games ?? 0)} games so far</p>
	</section>
{:else if summary}
	<header class="head">
		<div>
			<div class="label">{settings.username}</div>
			<h1>Your openings</h1>
		</div>
		<button class="icon-btn" onclick={sync} disabled={app.syncing} title="Sync with Chess.com" aria-label="Sync with Chess.com">
			<span class:spin={app.syncing}><Icon name="refresh" /></span>
		</button>
	</header>
	<p class="meta dim">
		{describeFilter(settings)} · synced {timeAgo(summary.lastSync)}
		{#if app.error}<span class="error"> · {app.error}</span>{/if}
	</p>

	{@const needs = [
		drill.playedAgain && `${drill.playedAgain} played again in your games`,
		drill.missed && `${drill.missed} missed last time`,
		drill.recent && `${drill.recent} new from your recent games`
	].filter(Boolean)}
	<a class="drill-cta card" class:done={!needs.length} href={`${base}${drill.total ? '/drill' : '/leaks'}`}>
		<div class="cta-body">
			<div class="label">Drill</div>
			<div class="cta-title">
				{#if needs.length}
					{needs.join(' · ')}
				{:else if drill.total}
					{drill.known} of {drill.total} known
				{:else if analysis.running}
					Preparing your cards…
				{:else}
					No cards yet
				{/if}
			</div>
			{#if drill.total}
				<div class="deck-bar" aria-hidden="true">
					<span class="known" style:width="{(100 * drill.known) / drill.total}%"></span>
					<span class="learning" style:width="{(100 * drill.learning) / drill.total}%"></span>
				</div>
				<div class="faint small num">{drill.known} known · {drill.learning} learning · {drill.fresh} new</div>
			{:else}
				<div class="faint small">
					{#if analysis.running}
						Cards are created from your first mistakes as soon as the engine pass finishes.
					{:else}
						No costly first mistakes found in your common lines yet.
					{/if}
				</div>
			{/if}
		</div>
		{#if drill.total}<span class="play"><Icon name="play" size={22} /></span>{/if}
	</a>

	<div class="stats">
		<div class="card stat">
			<div class="label">Games</div>
			<div class="big num">{count(summary.games)}</div>
			<div class="faint small num">{count(summary.stored)} stored</div>
		</div>
		{#each ['white', 'black'] as const as color (color)}
			{@const stats = summary.byColor[color]}
			<div class="card stat">
				<div class="label">As {color}</div>
				<div class="big num">{stats.n ? pct(score(stats)) : '–'}</div>
				<div class="faint small num">{count(stats.n)} games</div>
				<ResultBar {stats} />
			</div>
		{/each}
	</div>

	<div class="columns">
		{#each ['white', 'black'] as const as color (color)}
			<section class="card list">
				<div class="list-head">
					<h2>Most played as {color}</h2>
					<a class="faint small" href="{base}/lines?c={color}">All</a>
				</div>
				{#each top?.[color] ?? [] as fam (fam.name)}
					<a class="row" href={exploreHref(color, fam.ucis)}>
						<span class="name">{fam.name}</span>
						<span class="num dim">{count(fam.n)}</span>
						<span class="num score">{pct(score(fam))}</span>
						<span class="bar"><ResultBar stats={fam} height={4} /></span>
					</a>
				{:else}
					<p class="faint small">No games as {color} with these filters.</p>
				{/each}
			</section>
		{/each}
	</div>

	<a class="btn btn-quiet all" href="{base}/lines">Browse all your lines <Icon name="arrow" size={18} /></a>

	<section class="leaks">
		<div class="list-head">
			<h2>Costliest first mistakes</h2>
			{#if leaks?.leaks.length}<a class="faint small" href="{base}/leaks">All {leaks.leaks.length}</a>{/if}
		</div>
		<AnalysisStatus />
		{#each leaks?.leaks.slice(0, 3) ?? [] as leak (`${leak.key} ${leak.uci}`)}
			<LeakCard {leak} />
		{:else}
			{#if !analysis.running}<p class="faint small">No costly first mistakes found in your common lines yet.</p>{/if}
		{/each}
	</section>
{/if}

<style>
	.skeleton {
		height: 60vh;
	}

	.hero {
		max-width: 520px;
		margin: 6vh auto 0;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.art {
		display: grid;
		grid-template-columns: repeat(4, 22px);
		gap: 0;
		border-radius: 8px;
		overflow: hidden;
		width: max-content;
		margin-bottom: 8px;
	}

	.art span {
		width: 22px;
		height: 22px;
		background: var(--sq-light);
	}

	.art span.dark {
		background: var(--sq-dark);
	}

	.hero h1 {
		font-size: clamp(28px, 6vw, 38px);
		line-height: 1.1;
	}

	.hero form {
		display: flex;
		gap: 10px;
		margin-top: 8px;
	}

	.hero form .btn {
		flex: none;
	}

	.small {
		font-size: 13px;
	}

	.error {
		color: var(--loss);
		margin: 0;
	}

	.importing {
		max-width: 520px;
		margin: 10vh auto 0;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.track {
		height: 6px;
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

	.importing p {
		margin: 0;
	}

	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
	}

	.meta {
		margin: 6px 0 20px;
		font-size: 14px;
	}

	.spin {
		display: inline-grid;
		animation: spin 900ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.drill-cta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px;
		margin-bottom: 12px;
		border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
		background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--bg-elev)), var(--bg-elev));
		transition: transform 140ms var(--ease);
	}

	.drill-cta:active {
		transform: scale(0.99);
	}

	.drill-cta.done {
		border-color: var(--line);
		background: var(--bg-elev);
	}

	.cta-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
		min-width: 0;
	}

	/* The deck at a glance: known (green), learning (blue), the rest new. */
	.deck-bar {
		display: flex;
		height: 6px;
		margin-top: 6px;
		border-radius: 999px;
		overflow: hidden;
		background: var(--bg-elev-2);
	}

	.deck-bar span {
		display: block;
		transition: width 240ms var(--ease);
	}

	.deck-bar .known {
		background: var(--win);
	}

	.deck-bar .learning {
		background: var(--book);
	}

	.cta-title {
		font-size: 22px;
		font-weight: 680;
		letter-spacing: -0.015em;
		margin: 2px 0;
	}

	.play {
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		flex: none;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-ink);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.stat {
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.big {
		font-size: 28px;
		font-weight: 650;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}

	.columns {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-top: 12px;
	}

	.list {
		padding: 16px 8px 8px;
	}

	.list-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 0 10px 8px;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto 3.2em;
		grid-template-rows: auto auto;
		column-gap: 12px;
		row-gap: 6px;
		align-items: center;
		padding: 10px;
		border-radius: 10px;
		transition: background 120ms var(--ease);
	}

	.row:hover {
		background: var(--bg-elev-2);
	}

	.name {
		font-weight: 560;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.score {
		text-align: right;
		font-weight: 600;
	}

	.bar {
		grid-column: 1 / -1;
	}

	.all {
		margin-top: 16px;
		width: 100%;
	}

	.leaks {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 28px;
	}

	.leaks .list-head {
		padding: 0 2px;
	}

	@media (max-width: 720px) {
		.stats {
			grid-template-columns: 1fr 1fr;
		}

		.stats .stat:first-child {
			grid-column: 1 / -1;
		}

		.columns {
			grid-template-columns: 1fr;
		}

		.hero form {
			flex-direction: column;
		}
	}
</style>
