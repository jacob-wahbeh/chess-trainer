import Dexie, { type Table } from 'dexie';
import type { Game } from './types';

/** Bump when Game's shape or MAX_PLY changes: stored months are then re-fetched. */
export const PARSE_VERSION = 1;

export interface MonthRecord {
	/** `${user}/${YYYY-MM}` */
	id: string;
	user: string;
	month: string;
	/** Unix seconds. */
	fetchedAt: number;
	version: number;
	games: Game[];
}

export interface MetaRecord {
	key: string;
	value: unknown;
}

class Db extends Dexie {
	months!: Table<MonthRecord, string>;
	meta!: Table<MetaRecord, string>;

	constructor() {
		super('chess-trainer');
		this.version(1).stores({ months: 'id, user', meta: 'key' });
	}
}

export const db = new Db();
export const monthId = (user: string, month: string) => `${user.toLowerCase()}/${month}`;
