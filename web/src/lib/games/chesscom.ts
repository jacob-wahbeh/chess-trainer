// Chess.com Published-Data API: https://www.chess.com/news/view/published-data-api
// Requests are serial (parallel ones get rate limited) and retried with backoff on 429.

import { pgnSans, replaySans } from '../chess/pgn';
import { MAX_PLY, type Color, type Game, type Result, type TimeClass } from './types';

const BASE = 'https://api.chess.com/pub';
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const TIME_CLASSES = new Set<TimeClass>(['bullet', 'blitz', 'rapid', 'daily']);

interface RawPlayer {
	username: string;
	rating: number;
	result: string;
}

export interface RawGame {
	url: string;
	pgn?: string;
	end_time: number;
	time_class: string;
	rules: string;
	white: RawPlayer;
	black: RawPlayer;
}

async function getJson<T>(url: string, retries = 5): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await fetch(url);
		} catch (err) {
			if (attempt >= retries) throw err;
			await sleep(1000 * 2 ** attempt);
			continue;
		}
		if (res.ok) return res.json();
		if (res.status === 429 && attempt < retries) {
			await sleep(1000 * 2 ** attempt);
			continue;
		}
		if (res.status === 404) throw new Error(`Chess.com user not found (${url})`);
		throw new Error(`Chess.com API: HTTP ${res.status} for ${url}`);
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Archive months on record for a user, oldest first, as { month: 'YYYY-MM', url }. */
export async function fetchArchiveList(user: string) {
	const { archives } = await getJson<{ archives: string[] }>(
		`${BASE}/player/${encodeURIComponent(user.toLowerCase())}/games/archives`
	);
	return archives.map((url) => {
		const [year, month] = url.replace(/\/$/, '').split('/').slice(-2);
		return { month: `${year}-${month}`, url };
	});
}

export async function fetchMonth(url: string): Promise<RawGame[]> {
	return (await getJson<{ games: RawGame[] }>(url)).games;
}

function outcome(me: RawPlayer): Result {
	if (me.result === 'win') return 'win';
	return DRAWS.has(me.result) ? 'draw' : 'loss';
}

/** Standard-chess games in a compact form, or null for variants and malformed games. */
export function normalizeGame(raw: RawGame, user: string): Game | null {
	if (raw.rules !== 'chess' || !raw.pgn || !TIME_CLASSES.has(raw.time_class as TimeClass)) return null;
	const color: Color = raw.white.username.toLowerCase() === user.toLowerCase() ? 'white' : 'black';
	const me = color === 'white' ? raw.white : raw.black;
	const opp = color === 'white' ? raw.black : raw.white;
	const { ucis, keys } = replaySans(pgnSans(raw.pgn, MAX_PLY));
	return {
		id: raw.url.replace(/\/$/, '').split('/').pop()!,
		url: raw.url,
		end: raw.end_time,
		timeClass: raw.time_class as TimeClass,
		color,
		result: outcome(me),
		myRating: me.rating,
		oppRating: opp.rating,
		opponent: opp.username,
		ucis,
		keys
	};
}

/** Last second of a 'YYYY-MM' month, UTC, in unix seconds. */
export function monthEnd(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return Date.UTC(y, m, 1) / 1000 - 1;
}

/** A month is final once fetched after it ended, plus the API's ~24h cache window. */
export const isFinal = (month: string, fetchedAt: number) => fetchedAt > monthEnd(month) + 2 * 24 * 3600;
