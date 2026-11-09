<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { analysis, app } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import type { Color } from '$lib/games/types';
	import type { LeakList } from '$lib/worker/data.worker';
	import { count, pct } from '$lib/format';
	import AnalysisStatus from '$lib/ui/AnalysisStatus.svelte';
	import LeakCard from '$lib/ui/LeakCard.svelte';

	/** Played as a first mistake at least this often: a habit worth drilling first. */
	const HABIT = 5;

	const param = $derived(page.url.searchParams.get('c'));
	const color: Color | undefined = $derived(param === 'white' || param === 'black' ? param : undefined);
	let list = $state<LeakList | null>(null);

	$effect(() => {
		void analysis.version;
		if (!app.summary) return;
		const c = color;
		let cancelled = false;
		data()
			.leaks(c)
			.then((l) => {
				if (!cancelled) list = l;
			});
		return () => (cancelled = true);
	});

	const habits = $derived(list?.leaks.filter((l) => l.first >= HABIT) ?? []);
	const oneOffs = $derived(list?.leaks.filter((l) => l.first < HABIT) ?? []);
	const points = $derived(list?.leaks.reduce((s, l) => s + l.points, 0) ?? 0);
	const show = (c?: Color) => goto(`${base}/leaks${c ? `?c=${c}` : ''}`, { replaceState: true, noScroll: true, keepFocus: true });
</script>

<header class="head">
	<h1>First mistakes</h1>
	{#if list?.leaks.length}<a class="btn btn-primary drill-btn" href="{base}/drill">Drill these</a>{/if}
	<div class="segmented" role="group" aria-label="Color">
		<button aria-pressed={!color} onclick={() => show()}>All</button>
		<button aria-pressed={color === 'white'} onclick={() => show('white')}>White</button>
		<button aria-pressed={color === 'black'} onclick={() => show('black')}>Black</button>
	</div>
</header>

{#if list}
	<p class="meta dim">
		In <strong class="num">{count(list.departures)}</strong> of {count(list.games)} games ({pct(list.games ? list.departures / list.games : 0)})
		you leave theory or lose ground inside your common lines. These {list.leaks.length} spots cost about
		<strong class="num">{points.toFixed(0)}</strong> points.
	</p>
{/if}

<AnalysisStatus />

{#if list && habits.length}
	<h2 class="section">Habits <span class="faint">· first mistake in {HABIT}+ games</span></h2>
	<div class="grid">
		{#each habits as leak (`${leak.key} ${leak.uci}`)}<LeakCard {leak} />{/each}
	</div>
{/if}

{#if list && oneOffs.length}
	<h2 class="section">One-offs <span class="faint">· fewer than {HABIT} games</span></h2>
	<div class="grid">
		{#each oneOffs as leak (`${leak.key} ${leak.uci}`)}<LeakCard {leak} />{/each}
	</div>
{/if}

{#if list && !list.leaks.length && !analysis.running}
	<p class="faint">No first mistakes found in your common lines with these filters.</p>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.drill-btn {
		height: 36px;
		margin-left: auto;
	}

	.meta {
		margin: 8px 0 16px;
		max-width: 720px;
	}

	.meta strong {
		color: var(--text);
	}

	.section {
		margin: 26px 0 10px;
	}

	.section .faint {
		font-weight: 500;
		font-size: 14px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
		gap: 10px;
	}
</style>
