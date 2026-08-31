import { describe, expect, it } from 'vitest';
import {
	DRAG_ACTIVATION_DISTANCE,
	EDGE_SCROLL_MARGIN,
	EDGE_SCROLL_MAX_STEP,
	edgeScrollStep,
	hasDragStarted
} from './dragging';

describe('hasDragStarted', () => {
	const origin = { x: 100, y: 100 };

	it('ignores the wobble between pressing and releasing a card', () => {
		expect(hasDragStarted(origin, { x: 102, y: 101 })).toBe(false);
		expect(hasDragStarted(origin, origin)).toBe(false);
	});

	it('starts once the pointer has travelled the activation distance', () => {
		expect(hasDragStarted(origin, { x: 100 + DRAG_ACTIVATION_DISTANCE, y: 100 })).toBe(true);
		expect(hasDragStarted(origin, { x: 100, y: 100 - DRAG_ACTIVATION_DISTANCE })).toBe(true);
	});

	it('measures the distance, not either axis alone', () => {
		// 5px across and 5px down is 7px of travel, past the threshold, even though
		// neither axis reaches it.
		expect(hasDragStarted(origin, { x: 105, y: 105 })).toBe(true);
	});
});

describe('edgeScrollStep', () => {
	const top = 100;
	const bottom = 500;

	it('does not scroll away from the edges', () => {
		expect(edgeScrollStep(300, top, bottom)).toBe(0);
		expect(edgeScrollStep(top + EDGE_SCROLL_MARGIN, top, bottom)).toBe(0);
		expect(edgeScrollStep(bottom - EDGE_SCROLL_MARGIN, top, bottom)).toBe(0);
	});

	it('scrolls up near the top and down near the bottom', () => {
		expect(edgeScrollStep(top + 10, top, bottom)).toBeLessThan(0);
		expect(edgeScrollStep(bottom - 10, top, bottom)).toBeGreaterThan(0);
	});

	it('speeds up the deeper the pointer is into the margin', () => {
		expect(Math.abs(edgeScrollStep(top + 5, top, bottom))).toBeGreaterThan(
			Math.abs(edgeScrollStep(top + 40, top, bottom))
		);
	});

	it('clamps past the edge instead of extrapolating', () => {
		// A finger dragged off the top of the screen scrolls no faster than one
		// resting on the edge.
		expect(edgeScrollStep(top, top, bottom)).toBe(-EDGE_SCROLL_MAX_STEP);
		expect(edgeScrollStep(top - 900, top, bottom)).toBe(-EDGE_SCROLL_MAX_STEP);
		expect(edgeScrollStep(bottom + 900, top, bottom)).toBe(EDGE_SCROLL_MAX_STEP);
	});
});
