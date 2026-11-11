<script lang="ts">
	import { base } from '$app/paths';
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { LINK_PARAMS } from '$lib/link';
	import Icon, { type IconName } from '$lib/ui/Icon.svelte';
	import { app, boot, drill } from '$lib/state.svelte';

	let { children }: { children: Snippet } = $props();

	const NAV: { href: string; label: string; icon: IconName }[] = [
		{ href: '/', label: 'Today', icon: 'home' },
		{ href: '/drill', label: 'Drill', icon: 'drill' },
		{ href: '/lines', label: 'Lines', icon: 'lines' },
		{ href: '/leaks', label: 'Mistakes', icon: 'target' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	/** By route, so it works under a base path (GitHub Pages). */
	function isActive(href: string) {
		const route = page.route.id ?? '';
		if (href === '/') return route === '/';
		if (href === '/lines') return route.startsWith('/lines') || route.startsWith('/explore');
		return route.startsWith(href);
	}

	const progress = $derived(app.progress ? app.progress.done / app.progress.total : 0.04);
	/** Cards that need attention: mistakes played again, misses, and new ones from recent games. */
	const todo = $derived(drill.attention);
	/** Drills are a focus mode: no tab bar on phones. */
	const focus = $derived(page.route.id?.startsWith('/drill') ?? false);

	/** A new version is ready, waiting for the drill to be left before reloading. */
	let reloadPending = $state(false);
	$effect(() => {
		if (reloadPending && !focus) location.reload();
	});

	onMount(() => {
		void boot();
		// A setup link's settings are saved now; drop them from the address so a reload doesn't re-apply them.
		// (On the next task: mount effects run before SvelteKit counts the router as started.)
		const url = new URL(location.href);
		if (LINK_PARAMS.some((p) => url.searchParams.has(p))) {
			for (const p of LINK_PARAMS) url.searchParams.delete(p);
			setTimeout(() => replaceState(url, page.state));
		}
		if (!dev && 'serviceWorker' in navigator) {
			// After a deploy the new worker takes over; reload once so the page and its cached assets match, but not in the
			// middle of a drill: then it waits until the drill is left.
			const updating = !!navigator.serviceWorker.controller;
			navigator.serviceWorker.addEventListener(
				'controllerchange',
				() => {
					if (!updating) return;
					if (focus) reloadPending = true;
					else location.reload();
				},
				{ once: true }
			);
			void navigator.serviceWorker.register(`${base}/service-worker.js`);
		}
	});
</script>

{#if app.syncing}
	<div class="sync-bar" style:transform="scaleX({progress})" aria-hidden="true"></div>
{/if}

<header class="top" class:focus>
	<a href="{base}/" class="brand"><img src="{base}/favicon.svg" alt="" width="24" height="24" />Openings</a>
	<nav>
		{#each NAV as item (item.href)}
			<a href={base + item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
				{item.label}{#if item.href === '/drill' && todo}<span class="badge num">{todo}</span>{/if}
			</a>
		{/each}
	</nav>
</header>

<main class:focus>
	{@render children()}
</main>

<nav class="tabbar" class:hidden={focus}>
	{#each NAV as item (item.href)}
		<a href={base + item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
			<span class="icon">
				<Icon name={item.icon} size={22} />
				{#if item.href === '/drill' && todo}<span class="badge num">{todo}</span>{/if}
			</span>
			<span>{item.label}</span>
		</a>
	{/each}
</nav>

<style>
	.sync-bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--accent);
		transform-origin: left;
		transition: transform 300ms var(--ease);
		z-index: 50;
	}

	.top {
		display: none;
		align-items: center;
		justify-content: space-between;
		max-width: 1160px;
		margin: 0 auto;
		padding: 18px 24px 6px;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 680;
		letter-spacing: -0.01em;
	}

	.top nav {
		display: flex;
		gap: 4px;
	}

	.top nav a {
		padding: 8px 14px;
		border-radius: 10px;
		color: var(--text-2);
		font-weight: 550;
		transition:
			background 120ms var(--ease),
			color 120ms var(--ease);
	}

	/* Hover only with a pointer that hovers: on iPhone it sticks after a tap. */
	@media (hover: hover) {
		.top nav a:hover {
			color: var(--text);
		}
	}

	.top nav a[aria-current='page'] {
		color: var(--text);
		background: var(--bg-elev-2);
	}

	main {
		max-width: 1160px;
		margin: 0 auto;
		padding: calc(var(--safe-t) + 16px) 16px calc(var(--nav-h) + var(--safe-b) + 24px);
	}

	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		height: calc(var(--nav-h) + var(--safe-b));
		padding-bottom: var(--safe-b);
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: saturate(1.6) blur(18px);
		-webkit-backdrop-filter: saturate(1.6) blur(18px);
		border-top: 1px solid var(--line);
		z-index: 40;
	}

	.tabbar a {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
		transition: color 120ms var(--ease);
	}

	.tabbar a[aria-current='page'] {
		color: var(--accent);
	}

	.icon {
		position: relative;
		display: grid;
	}

	.badge {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		margin-left: 6px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 11px;
		font-weight: 700;
		line-height: 1;
	}

	.tabbar .badge {
		position: absolute;
		top: -6px;
		left: 14px;
		margin: 0;
		border: 2px solid var(--bg);
		height: 20px;
	}

	.tabbar.hidden {
		display: none;
	}

	main.focus {
		padding-bottom: calc(var(--safe-b) + 24px);
	}

	/* Drills on phones: the board goes nearly edge to edge. */
	@media (max-width: 899px) {
		main.focus {
			padding-top: calc(var(--safe-t) + 4px);
			/* The board runs edge to edge; the drill pads its other rows itself. */
			padding-left: 0;
			padding-right: 0;
			/* Continue's sticky footer already clears the home bar. */
			padding-bottom: 0;
		}
	}

	/* Drills use the whole width for a big board next to the explanation. */
	.top.focus,
	main.focus {
		max-width: 1600px;
	}

	@media (min-width: 900px) {
		.top {
			display: flex;
		}

		.tabbar {
			display: none;
		}

		main {
			padding: 18px 24px 48px;
		}
	}
</style>
