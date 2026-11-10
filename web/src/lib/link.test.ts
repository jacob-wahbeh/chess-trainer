import { describe, expect, it } from 'vitest';
import { linkSettings, readSettingsCookie, settingsCookie } from './link';

describe('linkSettings', () => {
	it('reads the username, period and reach', () => {
		expect(linkSettings('?user=HipFlexors&period=all&reach=2')).toEqual({ username: 'HipFlexors', periodMonths: 0, minReach: 2 });
		expect(linkSettings('?period=24')).toEqual({ periodMonths: 24 });
		expect(linkSettings('?user=juwumy')).toEqual({ username: 'juwumy' });
	});

	it('ignores anything that is not one of the choices', () => {
		expect(linkSettings('')).toEqual({});
		expect(linkSettings('?user=a&period=7&reach=4')).toEqual({});
		expect(linkSettings('?user=<script>&period=forever')).toEqual({});
	});
});

describe('settings cookie', () => {
	const s = { username: 'HipFlexors', timeClasses: ['blitz', 'rapid'] as ('blitz' | 'rapid')[], periodMonths: 12, minReach: 2, introSpeed: 'fast' as const, drillOrder: 'random' as const, haptics: false };

	it('round-trips the settings', () => {
		const cookie = settingsCookie(s, '/chess-trainer/', true);
		expect(cookie).toContain('path=/chess-trainer/');
		expect(cookie).toContain('Secure');
		const pair = cookie.split(';')[0];
		expect(readSettingsCookie(`other=1; ${pair}; more=2`)).toEqual(s);
	});

	it('ignores a missing or broken cookie', () => {
		expect(readSettingsCookie('')).toEqual({});
		expect(readSettingsCookie('chess-trainer-settings=%7Bnope')).toEqual({});
	});
});
