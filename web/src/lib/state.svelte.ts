import type { AnalysisProgress } from './analysis/runner';
import { EnginePool } from './engine/pool';
import type { Filter, TimeClass } from './games/types';
import { revokeToken, type LichessAuth } from './lichess/oauth';
import type { Summary, SyncProgress } from './worker/data.worker';
import { data, proxy } from './worker/client';

export interface Settings {
	username: string;
	timeClasses: TimeClass[];
	/** 0 = all time. */
	periodMonths: number;
	/** Positions reached fewer times than this are not analysed. */
	minReach: number;
	/** New drill cards introduced per day. */
	newPerDay: number;
	/** How fast drills replay the moves leading to each position. */
	introSpeed: 'slow' | 'normal' | 'fast';
}

const STORAGE_KEY = 'chess-trainer/settings';
const LICHESS_KEY = 'chess-trainer/lichess';
const DEFAULTS: Settings = { username: '', timeClasses: ['blitz', 'rapid'], periodMonths: 12, minReach: 3, newPerDay: 10, introSpeed: 'normal' };
/** Re-sync in the background when the last sync is older than this. */
const STALE_SECONDS = 6 * 3600;
/** Local Stockfish depth: matched deep Lichess evals as well as native Stockfish in the research. */
const ENGINE_DEPTH = 16;

function load<T>(key: string, fallback: T): T {
	try {
		return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
	} catch {
		return { ...fallback };
	}
}

export const settings: Settings = $state(load(STORAGE_KEY, DEFAULTS));
export const lichess: LichessAuth = $state(load(LICHESS_KEY, { token: '', username: '' }));

export const app = $state({
	ready: false,
	syncing: false,
	progress: null as SyncProgress | null,
	summary: null as Summary | null,
	error: ''
});

export const analysis = $state({
	running: false,
	progress: null as AnalysisProgress | null,
	/** Bumped every few seconds while results arrive, so views can refresh. */
	version: 0
});

export const drill = $state({
	due: 0,
	fresh: 0,
	total: 0,
	nextDue: undefined as number | undefined
});

/** Recounts today's drill queue (and the home-screen badge, where supported). */
export async function refreshDrill() {
	if (!settings.username) return;
	const s = await data().session(settings.newPerDay);
	drill.due = s.due;
	drill.fresh = s.fresh;
	drill.total = s.total;
	drill.nextDue = s.nextDue;
	const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> };
	nav.setAppBadge?.(s.due + s.fresh).catch(() => {});
}

async function syncCards() {
	await data().syncCards();
	await refreshDrill();
}

export function saveSettings() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function setLichess(auth: LichessAuth | null) {
	if (!auth && lichess.token) revokeToken(lichess.token);
	lichess.token = auth?.token ?? '';
	lichess.username = auth?.username ?? '';
	localStorage.setItem(LICHESS_KEY, JSON.stringify(lichess));
}

/** First month inside the period, e.g. 12 months in Nov 2026 -> '2025-11'. */
export function sinceMonth(periodMonths: number, now = new Date()): string {
	if (!periodMonths) return '0000-00';
	const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - periodMonths;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export const currentFilter = (): Filter => ({ timeClasses: [...settings.timeClasses], sinceMonth: sinceMonth(settings.periodMonths) });

let markReady: () => void;
/** Resolves once stored games are loaded (pages opened directly wait on this). */
export const ready = new Promise<void>((resolve) => (markReady = resolve));

export async function boot() {
	if (settings.username) {
		try {
			app.summary = await data().load(settings.username, currentFilter());
		} catch (err) {
			app.error = String(err);
		}
	}
	app.ready = true;
	markReady();
	// Evaluations saved by earlier sessions are enough to create cards right away.
	if (app.summary?.games) void syncCards();
	const lastSync = app.summary?.lastSync ?? 0;
	if (settings.username && Date.now() / 1000 - lastSync > STALE_SECONDS) void sync();
	else void analyze();
}

export async function sync() {
	if (app.syncing || !settings.username) return;
	app.syncing = true;
	app.error = '';
	app.progress = null;
	try {
		app.summary = await data().sync(
			settings.username,
			currentFilter(),
			proxy((p: SyncProgress) => (app.progress = p))
		);
	} catch (err) {
		app.error = err instanceof Error ? err.message : String(err);
	} finally {
		app.syncing = false;
		app.progress = null;
	}
	void analyze();
}

/** Re-filters stored games. Pass `widened` when the period grew, so missing months get downloaded. */
export async function applyFilter(widened = false) {
	saveSettings();
	app.summary = await data().setFilter(currentFilter());
	if (widened) void sync();
	else void analyze();
}

let analysisId = 0;
let pool: Promise<EnginePool> | undefined;

/** Starts (or restarts) the background analysis; engines are only started if a position needs one. */
export async function analyze() {
	if (!app.summary?.games) return;
	const id = ++analysisId;
	// Each engine needs ~20 MB; phones (coarse pointer) get two so iOS doesn't kill the page.
	const phone = matchMedia('(pointer: coarse)').matches;
	const engines = Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, phone ? 2 : 6));
	analysis.running = true;
	let lastBump = 0;
	let cardsSynced = false;
	let lastCardSync = Date.now();
	try {
		const result = await data().analyze(
			{ minReach: settings.minReach, depth: ENGINE_DEPTH, engines, token: lichess.token || undefined },
			proxy({
				evaluate: async (fen: string, depth: number) => (await (pool ??= EnginePool.create(engines))).evaluate(fen, depth),
				progress: (p: AnalysisProgress) => {
					if (id !== analysisId) return;
					analysis.progress = p;
					// Cards only need engine verdicts: create them when the engine pass finishes (and every
					// 20 s before that), without waiting for the slow masters lookups.
					const evalsDone = p.evals.done >= p.evals.total;
					if ((evalsDone && !cardsSynced) || Date.now() - lastCardSync > 20_000) {
						cardsSynced ||= evalsDone;
						lastCardSync = Date.now();
						void syncCards();
					}
					if (Date.now() - lastBump > 2500) {
						lastBump = Date.now();
						analysis.version++;
					}
				}
			})
		);
		if (id === analysisId) {
			analysis.progress = result;
			await syncCards();
		}
	} catch (err) {
		if (id === analysisId) app.error = err instanceof Error ? err.message : String(err);
	} finally {
		if (id === analysisId) {
			analysis.running = false;
			analysis.version++;
			const done = pool;
			pool = undefined;
			void done?.then((p) => p.terminate());
		}
	}
}
