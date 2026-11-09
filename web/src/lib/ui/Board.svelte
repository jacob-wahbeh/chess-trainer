<script lang="ts">
	import { onMount } from 'svelte';
	import { Chessground } from 'chessground';
	import type { Api } from 'chessground/api';
	import type { Config } from 'chessground/config';
	import type { DrawShape } from 'chessground/draw';
	import type { Key } from 'chessground/types';
	import 'chessground/assets/chessground.base.css';
	import 'chessground/assets/chessground.cburnett.css';

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
				events: { after: (orig, dest) => onMove?.(orig, dest) }
			},
			premovable: { enabled: false },
			draggable: { enabled: !!dests },
			selectable: { enabled: !!dests },
			animation: { enabled: !viewOnly, duration: animationMs },
			highlight: { lastMove: true, check: true },
			drawable: { enabled: true, visible: true, autoShapes: shapes }
		};
	}

	onMount(() => {
		cg = Chessground(el, config());
		return () => cg?.destroy();
	});

	$effect(() => {
		const next = config();
		cg?.set(next);
	});
</script>

<div class="board"><div bind:this={el}></div></div>

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
</style>
