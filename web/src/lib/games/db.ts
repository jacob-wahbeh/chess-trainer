import Dexie, { type Table } from 'dexie';
import type { Eval, Masters } from '../analysis/score';
import type { CardRecord } from '../drill/cards';
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

/** Evaluations are facts about positions, shared by every user and kept forever. */
export interface EvalRecord extends Eval {
	key: number;
}

export interface MastersRecord extends Masters {
	key: number;
	/** Not looked up because the line had already left master theory. */
	skipped?: boolean;
}

class Db extends Dexie {
	months!: Table<MonthRecord, string>;
	meta!: Table<MetaRecord, string>;
	evals!: Table<EvalRecord, number>;
	masters!: Table<MastersRecord, number>;
	cards!: Table<CardRecord, string>;

	constructor() {
		super('chess-trainer');
		this.version(1).stores({ months: 'id, user', meta: 'key' });
		this.version(2).stores({ months: 'id, user', meta: 'key', evals: 'key', masters: 'key' });
		this.version(3).stores({ months: 'id, user', meta: 'key', evals: 'key', masters: 'key', cards: 'id, user' });
	}
}

export const db = new Db();
export const monthId = (user: string, month: string) => `${user.toLowerCase()}/${month}`;
