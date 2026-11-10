import { describe, expect, it } from 'vitest';
import { linkSettings } from './link';

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
