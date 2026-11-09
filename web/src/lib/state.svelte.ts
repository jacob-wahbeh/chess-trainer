import type { Filter, TimeClass } from './games/types';
import type { Summary, SyncProgress } from './worker/data.worker';
import { data, proxy } from './worker/client';

export interface Settings {
	username: string;
	timeClasses: TimeClass[];
	/** 0 = all time. */
	periodMonths: number;
}

const STORAGE_KEY = 'chess-trainer/settings';
const DEFAULTS: Settings = { username: '', timeClasses: ['blitz', 'rapid'], periodMonths: 12 };
/** Re-sync in the background when the last sync is older than this. */
const STALE_SECONDS = 6 * 3600;

function loadSettings(): Settings {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}

export const settings: Settings = $state(loadSettings());

export const app = $state({
	ready: false,
	syncing: false,
	progress: null as SyncProgress | null,
	summary: null as Summary | null,
	error: ''
});

export function saveSettings() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** First month inside the period, e.g. 12 months in Nov 2026 -> '2025-11'. */
export function sinceMonth(periodMonths: number, now = new Date()): string {
	if (!periodMonths) return '0000-00';
	const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - periodMonths;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export const currentFilter = (): Filter => ({ timeClasses: [...settings.timeClasses], sinceMonth: sinceMonth(settings.periodMonths) });

export async function boot() {
	if (settings.username) {
		try {
			app.summary = await data().load(settings.username, currentFilter());
		} catch (err) {
			app.error = String(err);
		}
	}
	app.ready = true;
	const lastSync = app.summary?.lastSync ?? 0;
	if (settings.username && Date.now() / 1000 - lastSync > STALE_SECONDS) void sync();
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
}

/** Re-filters stored games. Pass `widened` when the period grew, so missing months get downloaded. */
export async function applyFilter(widened = false) {
	saveSettings();
	app.summary = await data().setFilter(currentFilter());
	if (widened) void sync();
}
