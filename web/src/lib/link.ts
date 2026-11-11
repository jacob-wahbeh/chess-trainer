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

/**
 * Settings mirrored into a cookie. On iPhone, a Home Screen app gets its own storage, separate from Safari's, but
 * Safari's cookies are copied into it once when it's added: so a friend who opens a setup link in Safari and then
 * adds the app keeps their settings. Only the choices travel (never the Lichess token: cookies go to the server).
 */
export const SETTINGS_COOKIE = 'chess-trainer-settings';
type CookieSettings = Pick<Settings, 'username' | 'timeClasses' | 'periodMonths' | 'minReach' | 'introSpeed' | 'drillOrder' | 'haptics' | 'moveInput'>;

export function settingsCookie(s: Settings, path: string, secure: boolean): string {
	const value: CookieSettings = {
		username: s.username,
		timeClasses: s.timeClasses,
		periodMonths: s.periodMonths,
		minReach: s.minReach,
		introSpeed: s.introSpeed,
		drillOrder: s.drillOrder,
		haptics: s.haptics,
		moveInput: s.moveInput
	};
	const attrs = [`path=${path}`, 'max-age=34560000', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
	return `${SETTINGS_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; ${attrs.join('; ')}`;
}

/** The settings saved in the cookie, if any (`cookies` is document.cookie). */
export function readSettingsCookie(cookies: string): Partial<Settings> {
	for (const part of cookies.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name !== SETTINGS_COOKIE) continue;
		try {
			const value = JSON.parse(decodeURIComponent(rest.join('='))) as Partial<CookieSettings>;
			const out: Partial<Settings> = {};
			if (typeof value.username === 'string') out.username = value.username;
			if (Array.isArray(value.timeClasses) && value.timeClasses.length) out.timeClasses = value.timeClasses;
			if (typeof value.periodMonths === 'number') out.periodMonths = value.periodMonths;
			if (typeof value.minReach === 'number') out.minReach = value.minReach;
			if (value.introSpeed === 'slow' || value.introSpeed === 'normal' || value.introSpeed === 'fast') out.introSpeed = value.introSpeed;
			if (value.drillOrder === 'need' || value.drillOrder === 'random') out.drillOrder = value.drillOrder;
			if (typeof value.haptics === 'boolean') out.haptics = value.haptics;
			if (value.moveInput === 'both' || value.moveInput === 'tap' || value.moveInput === 'drag') out.moveInput = value.moveInput;
			return out;
		} catch {
			return {};
		}
	}
	return {};
}
