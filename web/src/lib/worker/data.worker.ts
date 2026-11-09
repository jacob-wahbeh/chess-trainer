// Owns games, IndexedDB and the position trees so the UI thread never parses or counts anything.
import * as Comlink from 'comlink';
import { fetchArchiveList, fetchMonth, isFinal, normalizeGame } from '../games/chesscom';
import { db, monthId, PARSE_VERSION } from '../games/db';
import { addResult, emptyStats, type Color, type Filter, type Game, type Stats, type TimeClass } from '../games/types';
import { buildOpeningIndex, deepestOpening, groupLines, type Opening, type OpeningIndex } from '../tree/openings';
import { buildTree, mainLine, nodeView, type Tree } from '../tree/tree';

export interface Summary {
	user: string;
	/** Games stored for the user, before filtering. */
	stored: number;
	games: number;
	byColor: Record<Color, Stats>;
	byTimeClass: Partial<Record<TimeClass, number>>;
	/** Unix seconds of the last successful sync, or 0. */
	lastSync: number;
}

export interface SyncProgress {
	done: number;
	total: number;
	month: string;
	games: number;
}

let user = '';
let filter: Filter = { timeClasses: [], sinceMonth: '0000-00' };
let all: Game[] = [];
let filtered: Record<Color, Game[]> = { white: [], black: [] };
let trees: Record<Color, Tree> = { white: new Map(), black: new Map() };
let openings: Promise<OpeningIndex> | undefined;

const loadOpenings = () =>
	(openings ??= fetch('/openings.json')
		.then((r) => r.json())
		.then(buildOpeningIndex));

const monthStart = (month: string) => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) / 1000;
const lastSyncKey = () => `lastSync/${user.toLowerCase()}`;

async function apply(): Promise<Summary> {
	const since = filter.sinceMonth === '0000-00' ? 0 : monthStart(filter.sinceMonth);
	const classes = new Set(filter.timeClasses);
	const games = all.filter((g) => g.end >= since && classes.has(g.timeClass));
	filtered = { white: games.filter((g) => g.color === 'white'), black: games.filter((g) => g.color === 'black') };
	trees = { white: buildTree(filtered.white), black: buildTree(filtered.black) };
	const byTimeClass: Summary['byTimeClass'] = {};
	const byColor = { white: emptyStats(), black: emptyStats() };
	for (const g of games) {
		byTimeClass[g.timeClass] = (byTimeClass[g.timeClass] ?? 0) + 1;
		addResult(byColor[g.color], g.result);
	}
	const lastSync = ((await db.meta.get(lastSyncKey()))?.value as number) ?? 0;
	return { user, stored: all.length, games: games.length, byColor, byTimeClass, lastSync };
}

const api = {
	/** Loads stored games (no network) and builds the trees for `f`. */
	async load(u: string, f: Filter): Promise<Summary> {
		user = u;
		filter = f;
		const months = await db.months.where('user').equals(u.toLowerCase()).toArray();
		all = months.filter((m) => m.version === PARSE_VERSION).flatMap((m) => m.games);
		return apply();
	},

	/** Downloads months from Chess.com that aren't final yet, then reloads. */
	async sync(u: string, f: Filter, onProgress?: (p: SyncProgress) => void): Promise<Summary> {
		const months = (await fetchArchiveList(u)).filter((m) => f.sinceMonth === '0000-00' || m.month >= f.sinceMonth);
		let games = 0;
		for (const [i, { month, url }] of months.entries()) {
			const id = monthId(u, month);
			const stored = await db.months.get(id);
			if (!stored || stored.version !== PARSE_VERSION || !isFinal(month, stored.fetchedAt)) {
				const parsed = (await fetchMonth(url)).map((r) => normalizeGame(r, u)).filter((g): g is Game => g !== null);
				await db.months.put({ id, user: u.toLowerCase(), month, fetchedAt: Date.now() / 1000, version: PARSE_VERSION, games: parsed });
				games += parsed.length;
			} else {
				games += stored.games.length;
			}
			onProgress?.({ done: i + 1, total: months.length, month, games });
		}
		user = u;
		await db.meta.put({ key: lastSyncKey(), value: Math.floor(Date.now() / 1000) });
		return api.load(u, f);
	},

	async setFilter(f: Filter): Promise<Summary> {
		filter = f;
		return apply();
	},

	async families(color: Color) {
		return groupLines(filtered[color], await loadOpenings());
	},

	node(color: Color, key: number) {
		return nodeView(trees[color], key);
	},

	mainLine(color: Color, key: number) {
		return mainLine(trees[color], key);
	},

	/** Name of the deepest named position along a path's keys. */
	async openingAt(keys: number[]): Promise<Opening | undefined> {
		return deepestOpening(keys, await loadOpenings());
	},

	async clear(u: string) {
		await db.months.where('user').equals(u.toLowerCase()).delete();
		await db.meta.delete(`lastSync/${u.toLowerCase()}`);
		all = [];
		return apply();
	}
};

export type DataApi = typeof api;

Comlink.expose(api);
