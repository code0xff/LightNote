/** Position-mapped text from one editable document block. */
export type TextSegment = { from: number; text: string };

export type TextRange = { from: number; to: number };

/**
 * Finds every exact occurrence of text in one block. The returned positions are
 * ProseMirror positions when `segments` came from the block's descendants.
 */
export function findExactTextRanges(segments: TextSegment[], target: string): TextRange[] {
	if (!target) {
		return [];
	}

	const contiguousGroups: TextSegment[][] = [];
	let group: TextSegment[] = [];
	let end: number | undefined;

	for (const segment of segments) {
		if (end !== undefined && segment.from !== end) {
			contiguousGroups.push(group);
			group = [];
		}

		group.push(segment);
		end = segment.from + segment.text.length;
	}

	if (group.length > 0) {
		contiguousGroups.push(group);
	}

	return contiguousGroups.flatMap((segmentsInGroup) => {
		const characters = segmentsInGroup.flatMap((segment) =>
			segment.text.split('').map((character, index) => ({
				character,
				from: segment.from + index,
				to: segment.from + index + 1
			}))
		);
		const source = characters.map(({ character }) => character).join('');
		const matches: TextRange[] = [];
		let start = source.indexOf(target);

		while (start !== -1) {
			const end = start + target.length - 1;
			matches.push({ from: characters[start].from, to: characters[end].to });
			start = source.indexOf(target, start + 1);
		}

		return matches;
	});
}
