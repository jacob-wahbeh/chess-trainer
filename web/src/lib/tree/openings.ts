import { replayUcis } from '../chess/pgn';
import { addResult, emptyStats, type Game, type Stats } from '../games/types';

export interface Opening {
	eco: string;
	name: string;
	/** Canonical move order reaching the named position. */
	ucis: string[];
}

export type OpeningIndex = Map<number, Opening>;

/** Indexes static/openings.json rows ([eco, name, "uci uci ..."]) by the key of their final position. */
export function buildOpeningIndex(rows: [string, string, string][]): OpeningIndex {
	const index: OpeningIndex = new Map();
	for (const [eco, name, moves] of rows) {
		const ucis = moves.split(' ');
		const { keys } = replayUcis(ucis);
		const key = keys[keys.length - 1];
		const existing = index.get(key);
		if (!existing || ucis.length < existing.ucis.length) index.set(key, { eco, name, ucis });
	}
	return index;
}

/** The deepest named position along a game's (or path's) position keys. */
export function deepestOpening(keys: number[], index: OpeningIndex): Opening | undefined {
	for (let i = keys.length - 1; i >= 0; i--) {
		const opening = index.get(keys[i]);
		if (opening) return opening;
	}
	return undefined;
}

/** 'Sicilian Defense: Najdorf Variation, English Attack' -> 'Sicilian Defense' */
export const familyOf = (name: string) => name.split(':')[0].trim();

export interface LineRow extends Stats {
	name: string;
	eco: string;
	ucis: string[];
}

export interface FamilyRow extends Stats {
	name: string;
	/** Move order of the family's shallowest named line: where "explore" starts. */
	ucis: string[];
	lines: LineRow[];
}

const OTHER: Opening = { eco: '', name: 'Other', ucis: [] };

/** Groups games by their deepest named opening, then by family; most played first. */
export function groupLines(games: Iterable<Game>, index: OpeningIndex): FamilyRow[] {
	const lines = new Map<string, LineRow>();
	for (const game of games) {
		const opening = deepestOpening(game.keys, index) ?? OTHER;
		let row = lines.get(opening.name);
		if (!row) lines.set(opening.name, (row = { ...emptyStats(), name: opening.name, eco: opening.eco, ucis: opening.ucis }));
		addResult(row, game.result);
	}
	const families = new Map<string, FamilyRow>();
	for (const line of lines.values()) {
		const name = familyOf(line.name);
		let fam = families.get(name);
		if (!fam) families.set(name, (fam = { ...emptyStats(), name, ucis: line.ucis, lines: [] }));
		fam.n += line.n;
		fam.w += line.w;
		fam.d += line.d;
		fam.l += line.l;
		if (line.ucis.length < fam.ucis.length) fam.ucis = line.ucis;
		fam.lines.push(line);
	}
	for (const fam of families.values()) fam.lines.sort((a, b) => b.n - a.n);
	return [...families.values()].sort((a, b) => b.n - a.n);
}
