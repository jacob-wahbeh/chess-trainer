<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import { app, settings } from '$lib/state.svelte';
	import { data } from '$lib/worker/client';
	import { score, type Color } from '$lib/games/types';
	import type { FamilyRow } from '$lib/tree/openings';
	import { count, describeFilter, exploreHref, pct, variationName } from '$lib/format';
	import Icon from '$lib/ui/Icon.svelte';
	import ResultBar from '$lib/ui/ResultBar.svelte';

	const color: Color = $derived(page.url.searchParams.get('c') === 'black' ? 'black' : 'white');
	let families = $state<FamilyRow[] | null>(null);
	const open = new SvelteSet<string>();

	$effect(() => {
		if (!app.summary) return;
		const c = color;
		let cancelled = false;
		data()
			.families(c)
			.then((f) => {
				if (!cancelled) families = f;
			});
		return () => (cancelled = true);
	});

	function setColor(c: Color) {
		open.clear();
		goto(`${base}/lines?c=${c}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	const toggle = (name: string) => (open.has(name) ? open.delete(name) : open.add(name));
	const max = $derived(families?.[0]?.n ?? 1);
</script>

<header class="head">
	<h1>Lines</h1>
	<div class="segmented" role="group" aria-label="Color">
		<button aria-pressed={color === 'white'} onclick={() => setColor('white')}>White</button>
		<button aria-pressed={color === 'black'} onclick={() => setColor('black')}>Black</button>
	</div>
</header>
<p class="meta dim">
	{count(app.summary?.byColor[color].n ?? 0)} games as {color} · {describeFilter(settings)} ·
	<a class="link" href="{base}/settings">Change</a>
</p>

{#if families === null}
	<div class="loading" aria-busy="true"></div>
{:else if families.length === 0}
	<p class="faint">No games as {color} with these filters.</p>
{:else}
	<ul class="families">
		{#each families as fam (fam.name)}
			{@const expanded = open.has(fam.name)}
			<li class="card fam" class:expanded>
				<button class="fam-row" onclick={() => toggle(fam.name)} aria-expanded={expanded}>
					<span class="name">{fam.name}</span>
					<span class="num count">{count(fam.n)}</span>
					<span class="num score">{pct(score(fam))}</span>
					<span class="chev"><Icon name="chevron-down" size={18} /></span>
					<span class="freq"><span style:width="{(100 * fam.n) / max}%"></span></span>
				</button>
				{#if expanded}
					<ul class="vars">
						{#each fam.lines as line (line.name)}
							<li>
								<a class="var" href={exploreHref(color, line.ucis)}>
									<span class="vname">{variationName(line.name)}</span>
									<span class="num dim">{count(line.n)}</span>
									<span class="num score">{pct(score(line))}</span>
									<span class="vbar"><ResultBar stats={line} height={4} /></span>
								</a>
							</li>
						{/each}
						<li>
							<a class="explore" href={exploreHref(color, fam.ucis)}>
								Explore the {fam.name} tree <Icon name="arrow" size={16} />
							</a>
						</li>
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.meta {
		margin: 8px 0 18px;
		font-size: 14px;
	}

	.link {
		color: var(--accent);
	}

	.loading {
		height: 40vh;
	}

	.families {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.fam {
		overflow: hidden;
		transition: border-color 160ms var(--ease);
	}

	.fam.expanded {
		border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
	}

	.fam-row {
		width: 100%;
		display: grid;
		grid-template-columns: 1fr auto 3.2em 20px;
		column-gap: 14px;
		row-gap: 10px;
		align-items: center;
		padding: 14px 16px;
		text-align: left;
	}

	.name {
		font-weight: 600;
		font-size: 16px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		color: var(--text-2);
	}

	.score {
		text-align: right;
		font-weight: 600;
	}

	.chev {
		display: grid;
		color: var(--text-3);
		transition: transform 200ms var(--ease);
	}

	.expanded .chev {
		transform: rotate(180deg);
	}

	.freq {
		grid-column: 1 / -1;
		height: 3px;
		border-radius: 999px;
		background: var(--bg-elev-2);
		overflow: hidden;
	}

	.freq span {
		display: block;
		height: 100%;
		background: var(--accent);
		opacity: 0.75;
		border-radius: 999px;
	}

	.vars {
		list-style: none;
		margin: 0;
		padding: 0 8px 8px;
		border-top: 1px solid var(--line);
		animation: reveal 200ms var(--ease);
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	.var {
		display: grid;
		grid-template-columns: 1fr auto 3.2em;
		column-gap: 14px;
		row-gap: 6px;
		align-items: center;
		padding: 11px 8px;
		border-radius: 10px;
		transition: background 120ms var(--ease);
	}

	.var:hover,
	.explore:hover {
		background: var(--bg-elev-2);
	}

	.vname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vbar {
		grid-column: 1 / -1;
	}

	.explore {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 11px 8px;
		border-radius: 10px;
		color: var(--accent);
		font-weight: 560;
	}
</style>
