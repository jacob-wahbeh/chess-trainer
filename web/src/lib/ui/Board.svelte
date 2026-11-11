<script lang="ts">
	import { onMount } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Config } from 'chessground/config';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import 'chessground/assets/chessground.base.css';
	import 'chessground/assets/chessground.cburnett.css';
	import { settings } from '$lib/state.svelte';

	interface Props {
		fen: string;
		orientation?: 'white' | 'black';
		turnColor?: 'white' | 'black';
		lastMove?: Key[];
		check?: boolean;
		/** Legal destinations; omit for a board that can't be moved on. */
		dests?: Map<Key, Key[]>;
		shapes?: DrawShape[];
		coordinates?: boolean;
		/** A static thumbnail: no interaction or animation. */
		viewOnly?: boolean;
		/** Piece animation duration. */
		animationMs?: number;
		onMove?: (orig: Key, dest: Key) => void;
	}

	let {
		fen,
		orientation = 'white',
		turnColor = 'white',
		lastMove,
		check = false,
		dests,
		shapes = [],
		coordinates = true,
		viewOnly = false,
		animationMs = 180,
		onMove
	}: Props = $props();

	let el: HTMLDivElement;
	let cg: Api | undefined;

	/** While a piece is dragged by touch: the square under the finger, ringed so the drop is visible under the lifted piece. */
	let over = $state<Key | null>(null);
	const track = (e: TouchEvent) => {
		const t = e.touches[0];
		over = t && cg?.state.draggable.current?.started ? (cg.getKeyAtDomPos([t.clientX, t.clientY]) ?? null) : null;
	};
	const untrack = () => (over = null);
	/** The ring's place: a circle two squares wide, centred on the square. */
	const ringAt = (key: Key) => {
		const file = key.charCodeAt(0) - 97;
		const rank = Number(key[1]) - 1;
		const col = orientation === 'white' ? file : 7 - file;
		const row = orientation === 'white' ? 7 - rank : rank;
		return { left: `${col * 12.5 - 6.25}%`, top: `${row * 12.5 - 6.25}%` };
	};

	// Chessground reports a move a moment later (setTimeout), outside the touch that made it, and iPhone only
	// plays haptics during a touch. So a move finished during a touch is handed over right away, and the
	// delayed report of the same move is skipped.
	let before = '';
	let handled = '';
	const snapshot = () => {
		before = cg?.getFen() ?? '';
		handled = '';
	};
	const settle = () => {
		const last = cg?.state.lastMove;
		if (!cg || !onMove || !dests || !last || last.length < 2 || cg.getFen() === before) return;
		before = cg.getFen();
		handled = last[0] + last[1];
		onMove(last[0], last[1]);
	};
	const delayed = (orig: Key, dest: Key) => {
		if (handled === orig + dest) {
			handled = '';
			return;
		}
		onMove?.(orig, dest);
	};

	function config(): Config {
		return {
			fen,
			orientation,
			turnColor,
			lastMove,
			check,
			coordinates,
			viewOnly,
			movable: {
				free: false,
				color: dests ? turnColor : undefined,
				dests: dests ?? new Map(),
				showDests: true,
				events: { after: delayed }
			},
			premovable: { enabled: false },
			// A drag needs 10px of movement every time; with chessground's default autoDistance, the next drag after a drag move
			// starts at 0px, so a thumb rolling across a square edge became a (graded) move.
			draggable: { enabled: !!dests && settings.moveInput !== 'tap', distance: 10, autoDistance: false },
			selectable: { enabled: !!dests && settings.moveInput !== 'drag' },
			animation: { enabled: !viewOnly, duration: animationMs },
			highlight: { lastMove: true, check: true },
			drawable: { enabled: true, visible: true, autoShapes: shapes }
		};
	}

	onMount(() => {
		cg = Chessground(el, config());
		// Registered after chessground's own listeners, so these run once it has handled the touch.
		window.addEventListener('touchstart', snapshot, { capture: true, passive: true });
		document.addEventListener('touchstart', settle, { passive: true });
		document.addEventListener('touchend', settle, { passive: true });
		document.addEventListener('touchmove', track, { passive: true });
		document.addEventListener('touchend', untrack, { passive: true });
		document.addEventListener('touchcancel', untrack, { passive: true });
		return () => {
			document.removeEventListener('touchmove', track);
			document.removeEventListener('touchend', untrack);
			document.removeEventListener('touchcancel', untrack);
			window.removeEventListener('touchstart', snapshot, { capture: true });
			document.removeEventListener('touchstart', settle);
			document.removeEventListener('touchend', settle);
			cg?.destroy();
		};
	});

	$effect(() => {
		const next = config();
		cg?.set(next);
	});
</script>

<div class="board">
	<div bind:this={el}></div>
	{#if over}{@const at = ringAt(over)}<span class="drop-ring" style:left={at.left} style:top={at.top} aria-hidden="true"></span>{/if}
</div>

<style>
	.board {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		touch-action: none;
		user-select: none;
	}

	.board > div {
		position: absolute;
		inset: 0;
	}

	/* Above the resting pieces, below the dragged one (chessground gives it z-index 11). */
	.drop-ring {
		position: absolute;
		z-index: 3;
		width: 25%;
		height: 25%;
		border-radius: 50%;
		background: rgba(20, 85, 30, 0.3);
		pointer-events: none;
	}

	/* Touch: the dragged piece is drawn bigger and lifted above the thumb, so it isn't hidden under it. It still lands on
	   the square under the finger, which the ring marks. */
	@media (pointer: coarse) {
		.board :global(cg-board piece.dragging) {
			width: 20%;
			height: 20%;
			margin: -15% 0 0 -3.75%;
		}
	}
</style>
