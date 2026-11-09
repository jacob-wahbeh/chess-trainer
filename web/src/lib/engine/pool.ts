// Stockfish 19 lite (single-threaded WebAssembly) in Web Workers. Batches run on a pool of
// single-threaded engines: near-linear throughput and no cross-origin-isolation headers needed.
import { base } from '$app/paths';
import { parseInfo, type EvalResult } from './uci';

export type { EvalResult };

const BUILD = 'stockfish-19-lite-single';

export class Engine {
	private worker: Worker;
	private listener: ((line: string) => void) | null = null;

	private constructor() {
		const wasm = `${base}/engine/${BUILD}.wasm`;
		this.worker = new Worker(`${base}/engine/${BUILD}.js#${encodeURIComponent(wasm)}`);
		this.worker.onmessage = (e) => {
			for (const line of String(e.data).split('\n')) this.listener?.(line.trim());
		};
	}

	static async create(hashMb = 16): Promise<Engine> {
		const engine = new Engine();
		await engine.command('uci', (l) => l === 'uciok');
		engine.worker.postMessage(`setoption name Hash value ${hashMb}`);
		await engine.command('isready', (l) => l === 'readyok');
		return engine;
	}

	private command(cmd: string, done: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
		return new Promise((resolve) => {
			this.listener = (line) => {
				onLine?.(line);
				if (done(line)) {
					this.listener = null;
					resolve(line);
				}
			};
			this.worker.postMessage(cmd);
		});
	}

	async evaluate(fen: string, depth: number): Promise<EvalResult> {
		this.worker.postMessage('ucinewgame');
		this.worker.postMessage(`position fen ${fen}`);
		await this.command('isready', (l) => l === 'readyok');
		const start = performance.now();
		let last: Omit<EvalResult, 'ms'> = { depth: 0, pv: [], nodes: 0 };
		await this.command(
			`go depth ${depth}`,
			(l) => l.startsWith('bestmove'),
			(l) => (last = parseInfo(l) ?? last)
		);
		return { ...last, ms: performance.now() - start };
	}

	terminate() {
		this.worker.terminate();
	}
}

export class EnginePool {
	private idle: Engine[];
	private waiting: ((engine: Engine) => void)[] = [];

	private constructor(private engines: Engine[]) {
		this.idle = [...engines];
	}

	static async create(size: number): Promise<EnginePool> {
		return new EnginePool(await Promise.all(Array.from({ length: size }, () => Engine.create())));
	}

	get size() {
		return this.engines.length;
	}

	async evaluate(fen: string, depth: number): Promise<EvalResult> {
		const engine = this.idle.pop() ?? (await new Promise<Engine>((r) => this.waiting.push(r)));
		try {
			return await engine.evaluate(fen, depth);
		} finally {
			const next = this.waiting.shift();
			if (next) next(engine);
			else this.idle.push(engine);
		}
	}

	terminate() {
		for (const engine of this.engines) engine.terminate();
	}
}
