// Setup links: a URL like /?user=HipFlexors&period=all&reach=2, sent to a friend, fills in their settings
// the first time they open it (and again whenever they open it), so they don't have to find them.
import type { Settings } from './state.svelte';

const PERIODS = [3, 6, 12, 24];
const REACHES = [2, 3, 5, 10];
/** Chess.com usernames: 3–25 letters, digits, '_' or '-'. */
const USERNAME = /^[A-Za-z0-9_-]{3,25}$/;
export const LINK_PARAMS = ['user', 'period', 'reach'];

/** The settings a setup link gives; anything missing or not one of the app's choices is left out. */
export function linkSettings(search: string): Partial<Settings> {
	const params = new URLSearchParams(search);
	const out: Partial<Settings> = {};
	const user = params.get('user')?.trim();
	if (user && USERNAME.test(user)) out.username = user;
	const period = params.get('period')?.toLowerCase();
	if (period === 'all') out.periodMonths = 0;
	else if (period && PERIODS.includes(Number(period))) out.periodMonths = Number(period);
	const reach = Number(params.get('reach'));
	if (REACHES.includes(reach)) out.minReach = reach;
	return out;
}
