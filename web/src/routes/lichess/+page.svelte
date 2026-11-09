<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { finishLichessLogin } from '$lib/lichess/oauth';
	import { analyze, setLichess } from '$lib/state.svelte';

	let error = $state('');

	onMount(async () => {
		try {
			setLichess(await finishLichessLogin(page.url));
			await goto('/settings', { replaceState: true });
			void analyze();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		}
	});
</script>

<section class="card box">
	{#if error}
		<h2>Couldn't connect to Lichess</h2>
		<p class="dim">{error}</p>
		<a class="btn btn-quiet" href="/settings">Back to settings</a>
	{:else}
		<h2>Connecting to Lichess…</h2>
	{/if}
</section>

<style>
	.box {
		max-width: 460px;
		margin: 12vh auto 0;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: flex-start;
	}

	p {
		margin: 0;
	}
</style>
