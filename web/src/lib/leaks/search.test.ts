import { describe, expect, it } from 'vitest';
import { matches, searchText } from './search';

const kennedy = searchText({ opening: 'Nimzowitsch Defense: Kennedy Variation', path: ['e2e4', 'b8c6', 'd2d4', 'e7e5'], uci: 'c2c3' });
const alapin = searchText({ opening: 'Sicilian Defense: Alapin Variation', path: ['e2e4', 'c7c5', 'c2c3'], uci: 'd7d6' });

describe('leak search', () => {
	it('finds the opening by any of its words, in any case', () => {
		expect(matches(kennedy, 'kennedy')).toBe(true);
		expect(matches(kennedy, 'Nimzowitsch Kennedy')).toBe(true);
		expect(matches(kennedy, 'alapin')).toBe(false);
	});

	it('finds the moves, the mistake included, numbered or not', () => {
		expect(matches(kennedy, '3.c3')).toBe(true);
		expect(matches(kennedy, '3. c3')).toBe(true);
		expect(matches(kennedy, '1.e4 Nc6 2.d4 e5 3.c3')).toBe(true);
		expect(matches(alapin, '2...d6')).toBe(true);
		expect(matches(alapin, '2… d6')).toBe(true);
		expect(matches(alapin, '2.d6')).toBe(false);
		expect(matches(alapin, 'alapin d6')).toBe(true);
	});

	it('matches everything for an empty query', () => {
		expect(matches(kennedy, '  ')).toBe(true);
	});
});
