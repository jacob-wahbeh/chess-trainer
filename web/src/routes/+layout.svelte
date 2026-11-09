<script lang="ts">
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { dev } from '$app/environment';
	import { page } from '$app/state';
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

	function isActive(href: string) {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href === '/lines') return path.startsWith('/lines') || path.startsWith('/explore');
		return path.startsWith(href);
	}

	const progress = $derived(app.progress ? app.progress.done / app.progress.total : 0.04);
	const todo = $derived(drill.due + drill.fresh);
	/** Drills are a focus mode: no tab bar on phones. */
	const focus = $derived(page.url.pathname.startsWith('/drill'));

	onMount(() => {
		void boot();
		if (!dev && 'serviceWorker' in navigator) {
			// After a deploy the new worker takes over; reload once so the page and its cached assets match.
			const updating = !!navigator.serviceWorker.controller;
			navigator.serviceWorker.addEventListener('controllerchange', () => updating && location.reload(), { once: true });
			void navigator.serviceWorker.register('/service-worker.js');
		}
	});
</script>

{#if app.syncing}
	<div class="sync-bar" style:transform="scaleX({progress})" aria-hidden="true"></div>
{/if}

<header class="top">
	<a href="/" class="brand"><img src="/favicon.svg" alt="" width="24" height="24" />Openings</a>
	<nav>
		{#each NAV as item (item.href)}
			<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
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
		<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
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

	.top nav a:hover {
		color: var(--text);
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
		color: var(--text-3);
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
