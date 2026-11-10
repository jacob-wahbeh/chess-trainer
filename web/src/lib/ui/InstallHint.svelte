<script lang="ts">
	// On iPhone and iPad, a site in a Safari tab loses its data after 7 days of Safari use without a visit, and a
	// Home Screen app keeps its own storage, separate from Safari's. So suggest adding the app, early: progress made
	// in the tab doesn't move over (settings do, through the settings cookie).
	const DISMISSED = 'chess-trainer/install-hint-dismissed';
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
	let show = $state(ios && !standalone && !localStorage.getItem(DISMISSED));

	function dismiss() {
		localStorage.setItem(DISMISSED, '1');
		show = false;
	}
</script>

{#if show}
	<aside class="card hint">
		<div>
			<strong>Add this app to your Home Screen</strong>
			<p class="dim">
				Tap Share, then Add to Home Screen, and open it from there from now on. Safari clears a website's data after a
				week without a visit; the Home Screen app keeps your progress. Your settings come with you.
			</p>
		</div>
		<button onclick={dismiss} aria-label="Dismiss">Got it</button>
	</aside>
{/if}

<style>
	.hint {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.hint p {
		margin: 4px 0 0;
		font-size: 13px;
	}
	strong {
		font-weight: 650;
	}
	button {
		flex: none;
		color: var(--accent);
		font-weight: 560;
		font-size: 14px;
	}
</style>
