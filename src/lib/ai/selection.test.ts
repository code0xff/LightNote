import { describe, expect, it } from 'vitest';
import { findExactTextRanges } from './selection';

describe('exact text scope', () => {
	it('finds an exact fragment across adjacent text nodes', () => {
		expect(
			findExactTextRanges(
				[
					{ from: 1, text: '첫 문장' },
					{ from: 5, text: '입니다. 다음 문장입니다.' }
				],
				'첫 문장입니다.'
			)
		).toEqual([{ from: 1, to: 9 }]);
	});

	it('reports every occurrence so callers can reject an ambiguous target', () => {
		expect(findExactTextRanges([{ from: 1, text: 'same and same' }], 'same')).toEqual([
			{ from: 1, to: 5 },
			{ from: 10, to: 14 }
		]);
	});

	it('does not match across a non-text gap such as a hard break', () => {
		expect(
			findExactTextRanges(
				[
					{ from: 1, text: 'before' },
					// Position 7 is a hard break; the next text starts at 8.
					{ from: 8, text: 'after' }
				],
				'beforeafter'
			)
		).toEqual([]);
	});
});
