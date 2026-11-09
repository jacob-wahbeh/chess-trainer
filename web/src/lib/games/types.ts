export type Color = 'white' | 'black';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type Result = 'win' | 'draw' | 'loss';

/** Plies kept per game: the opening is all the tree needs. */
export const MAX_PLY = 30;

export interface Game {
	id: string;
	url: string;
	/** Unix seconds. */
	end: number;
	timeClass: TimeClass;
	color: Color;
	result: Result;
	myRating: number;
	oppRating: number;
	opponent: string;
	/** First MAX_PLY moves in UCI. */
	ucis: string[];
	/** Position keys before each move and after the last one (length ucis.length + 1). */
	keys: number[];
}

export interface Filter {
	timeClasses: TimeClass[];
	/** First month included, 'YYYY-MM'. */
	sinceMonth: string;
}

export interface Stats {
	n: number;
	w: number;
	d: number;
	l: number;
}

export const emptyStats = (): Stats => ({ n: 0, w: 0, d: 0, l: 0 });

export function addResult(s: Stats, result: Result) {
	s.n++;
	if (result === 'win') s.w++;
	else if (result === 'draw') s.d++;
	else s.l++;
}

/** Score from the user's point of view, 0..1. */
export const score = (s: Stats) => (s.n ? (s.w + s.d / 2) / s.n : 0);
