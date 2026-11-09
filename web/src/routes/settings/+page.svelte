<script lang="ts">
	import { app, applyFilter, currentFilter, saveSettings, settings, sync } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { TimeClass } from '$lib/games/types';
	import { count, timeAgo } from '$lib/format';
	import Icon from '$lib/ui/Icon.svelte';

	const CLASSES: { id: TimeClass; label: string }[] = [
		{ id: 'bullet', label: 'Bullet' },
		{ id: 'blitz', label: 'Blitz' },
		{ id: 'rapid', label: 'Rapid' },
		{ id: 'daily', label: 'Daily' }
	];
	const PERIODS = [
		{ months: 3, label: '3 mo' },
		{ months: 6, label: '6 mo' },
		{ months: 12, label: '1 yr' },
		{ months: 24, label: '2 yr' },
		{ months: 0, label: 'All' }
	];

	let username = $state(settings.username);
	let confirmClear = $state(false);

	function toggleClass(id: TimeClass) {
		const next = settings.timeClasses.includes(id)
			? settings.timeClasses.filter((c) => c !== id)
			: [...settings.timeClasses, id];
		if (!next.length) return;
		settings.timeClasses = next;
		void applyFilter();
	}

	function setPeriod(months: number) {
		const widened = months === 0 ? settings.periodMonths !== 0 : settings.periodMonths !== 0 && months > settings.periodMonths;
		settings.periodMonths = months;
		void applyFilter(widened);
	}

	async function changeUser(event: SubmitEvent) {
		event.preventDefault();
		const name = username.trim();
		if (!name || name.toLowerCase() === settings.username.toLowerCase()) return;
		settings.username = name;
		saveSettings();
		app.summary = await data().load(name, currentFilter());
		await sync();
	}

	async function clearData() {
		if (!confirmClear) {
			confirmClear = true;
			return;
		}
		app.summary = await data().clear(settings.username);
		confirmClear = false;
	}
</script>

<h1>Settings</h1>

<section class="group">
	<div class="label">Chess.com account</div>
	<form class="row" onsubmit={changeUser}>
		<input class="input" bind:value={username} autocapitalize="off" spellcheck="false" placeholder="Chess.com username" />
		<button class="btn btn-quiet" disabled={!username.trim() || username.trim().toLowerCase() === settings.username.toLowerCase()}>
			Switch
		</button>
	</form>
</section>

<section class="group">
	<div class="label">Time controls</div>
	<div class="chips">
		{#each CLASSES as c (c.id)}
			<button class="chip" aria-pressed={settings.timeClasses.includes(c.id)} onclick={() => toggleClass(c.id)}>
				{c.label}
			</button>
		{/each}
	</div>
</section>

<section class="group">
	<div class="label">Period</div>
	<div class="segmented" role="group" aria-label="Period">
		{#each PERIODS as p (p.months)}
			<button aria-pressed={settings.periodMonths === p.months} onclick={() => setPeriod(p.months)}>{p.label}</button>
		{/each}
	</div>
</section>

<section class="group">
	<div class="label">Data</div>
	<div class="card info">
		<div>
			<div class="num">{count(app.summary?.stored ?? 0)} games stored on this device</div>
			<div class="faint small">
				{count(app.summary?.games ?? 0)} match your filters · synced {timeAgo(app.summary?.lastSync ?? 0)}
			</div>
		</div>
		<button class="btn btn-quiet" onclick={sync} disabled={app.syncing || !settings.username}>
			<Icon name="refresh" size={18} />{app.syncing ? 'Syncing…' : 'Sync now'}
		</button>
	</div>
	{#if app.error}<p class="error">{app.error}</p>{/if}
	<button class="danger" onclick={clearData} disabled={!app.summary?.stored}>
		{confirmClear ? 'Tap again to delete all stored games' : 'Clear stored games'}
	</button>
</section>

<section class="group">
	<div class="label">Developer</div>
	<a class="card link-row" href="/bench">
		<div>
			<div>Engine benchmark</div>
			<div class="faint small">Measure Stockfish speed on this device</div>
		</div>
		<Icon name="chevron-right" />
	</a>
</section>

<style>
	h1 {
		margin-bottom: 8px;
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 22px;
		max-width: 560px;
	}

	.row {
		display: flex;
		gap: 10px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.segmented {
		align-self: flex-start;
	}

	.info,
	.link-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
	}

	.link-row {
		color: var(--text);
		transition: background 120ms var(--ease);
	}

	.link-row:hover {
		background: var(--bg-elev-2);
	}

	.small {
		font-size: 13px;
	}

	.error {
		color: var(--loss);
		margin: 0;
	}

	.danger {
		align-self: flex-start;
		color: var(--loss);
		font-weight: 560;
		padding: 6px 0;
	}

	.danger:disabled {
		opacity: 0.4;
	}
</style>
