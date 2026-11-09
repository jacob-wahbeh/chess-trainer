import type { Color, TimeClass } from './games/types';
import type { Settings } from './state.svelte';

export const pct = (x: number) => `${Math.round(100 * x)}%`;
export const count = (n: number) => n.toLocaleString('en-US');

export const exploreHref = (color: Color, ucis: string[]) =>
	`/explore?c=${color}${ucis.length ? `&m=${ucis.join(',')}` : ''}`;

const LABELS: Record<TimeClass, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
const ORDER: TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily'];

export function describeFilter(s: Settings): string {
	const classes = ORDER.filter((c) => s.timeClasses.includes(c)).map((c) => LABELS[c]);
	const period = s.periodMonths ? `last ${s.periodMonths} months` : 'all time';
	return `${classes.join(' · ') || 'No time controls'} · ${period}`;
}

export function timeAgo(unixSeconds: number, now = Date.now() / 1000): string {
	if (!unixSeconds) return 'never';
	const s = Math.max(0, now - unixSeconds);
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}

/** 'Sicilian Defense: Najdorf Variation' -> 'Najdorf Variation'; the family's own name -> 'Main line'. */
export function variationName(name: string): string {
	const i = name.indexOf(':');
	return i < 0 ? 'Main line' : name.slice(i + 1).trim();
}
