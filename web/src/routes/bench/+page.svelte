<script lang="ts">
	import { onDestroy } from 'svelte';
	import { makeFen } from 'chessops/fen';
	import { Chess } from 'chessops/chess';
	import { parseSan } from 'chessops/san';
	import { EnginePool } from '$lib/engine/pool';
	import { count } from '$lib/format';

	// Typical opening positions (a few moves past theory), so timings resemble real analysis.
	const LINES = [
		'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5',
		'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6',
		'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6',
		'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5',
		'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5',
		'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7',
		'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O',
		'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6',
		'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5',
		'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7',
		'c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6',
		'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7',
		'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6',
		'e4 d6 d4 Nf6 Nc3 g6 f4 Bg7 Nf3 O-O',
		'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O c4 d6',
		'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4'
	];

	function fenOf(sans: string) {
		const pos = Chess.default();
		for (const san of sans.split(' ')) {
			const move = parseSan(pos, san);
			if (!move) break;
			pos.play(move);
		}
		return makeFen(pos.toSetup());
	}

	const FENS = LINES.map(fenOf);
	const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
	const workerOptions = [...new Set([1, 2, Math.max(1, Math.min(4, cores - 1)), Math.max(1, cores - 1)])].sort((a, b) => a - b);

	interface Run {
		workers: number;
		depth: number;
		initMs: number;
		wallMs: number;
		medianMs: number;
		knps: number;
	}

	let depth = $state(14);
	let workers = $state(workerOptions[Math.min(2, workerOptions.length - 1)]);
	let running = $state(false);
	let done = $state(0);
	let runs = $state<Run[]>([]);
	let error = $state('');
	let pool: EnginePool | undefined;

	async function run() {
		running = true;
		done = 0;
		error = '';
		try {
			const t0 = performance.now();
			pool = await EnginePool.create(workers);
			const initMs = performance.now() - t0;
			const t1 = performance.now();
			const results = await Promise.all(
				FENS.map((fen) =>
					pool!.evaluate(fen, depth).then((r) => {
						done++;
						return r;
					})
				)
			);
			const wallMs = performance.now() - t1;
			const times = results.map((r) => r.ms).sort((a, b) => a - b);
			const nodes = results.reduce((s, r) => s + r.nodes, 0);
			const engineMs = times.reduce((s, t) => s + t, 0);
			runs = [{ workers, depth, initMs, wallMs, medianMs: times[times.length >> 1], knps: nodes / engineMs }, ...runs];
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			pool?.terminate();
			pool = undefined;
			running = false;
		}
	}

	onDestroy(() => pool?.terminate());

	/** Time to analyse the ~2,600 positions in a year of blitz + rapid (measured in research). */
	const estimate = (r: Run) => {
		const seconds = (2600 * r.wallMs) / FENS.length / 1000;
		return seconds < 90 ? `${Math.round(seconds)} s` : `${(seconds / 60).toFixed(1)} min`;
	};
</script>

<h1>Engine benchmark</h1>
<p class="dim intro">
	Stockfish 19 lite (WebAssembly, single-threaded per worker) on {FENS.length} typical opening positions.
	This device reports <strong class="num">{cores}</strong> logical cores.
</p>

<div class="controls">
	<div>
		<div class="label">Depth</div>
		<div class="segmented" role="group" aria-label="Depth">
			{#each [12, 14, 16, 18] as d (d)}
				<button aria-pressed={depth === d} onclick={() => (depth = d)} disabled={running}>{d}</button>
			{/each}
		</div>
	</div>
	<div>
		<div class="label">Workers</div>
		<div class="segmented" role="group" aria-label="Workers">
			{#each workerOptions as w (w)}
				<button aria-pressed={workers === w} onclick={() => (workers = w)} disabled={running}>{w}</button>
			{/each}
		</div>
	</div>
	<button class="btn btn-primary" onclick={run} disabled={running}>
		{running ? `Running… ${done}/${FENS.length}` : 'Run benchmark'}
	</button>
</div>

{#if error}<p class="error">{error}</p>{/if}

{#if runs.length}
	<div class="card table">
		<div class="tr th">
			<span>Workers</span><span>Depth</span><span>Startup</span><span>Per position</span><span>Speed</span><span>~2,600 positions</span>
		</div>
		{#each runs as r, i (i)}
			<div class="tr num">
				<span>{r.workers}</span>
				<span>{r.depth}</span>
				<span>{Math.round(r.initMs)} ms</span>
				<span>{Math.round(r.medianMs)} ms</span>
				<span>{count(Math.round(r.knps))}k nps</span>
				<strong>{estimate(r)}</strong>
			</div>
		{/each}
	</div>
	<p class="faint small">
		"Per position" is the median time one engine needs; "~2,600 positions" uses the measured throughput with all
		workers running. Reference (M3 Pro, Node): ~230 ms per position at depth 16.
	</p>
{/if}

<style>
	.intro {
		max-width: 620px;
	}

	.intro strong {
		color: var(--text);
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 18px;
		margin: 20px 0;
	}

	.controls .label {
		margin-bottom: 8px;
	}

	.table {
		overflow-x: auto;
	}

	.tr {
		display: grid;
		grid-template-columns: repeat(6, minmax(84px, 1fr));
		gap: 10px;
		padding: 12px 16px;
		border-top: 1px solid var(--line);
		white-space: nowrap;
	}

	.th {
		border-top: 0;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.small {
		font-size: 13px;
	}

	.error {
		color: var(--loss);
	}
</style>
