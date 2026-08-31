/**
 * Geometry for dragging cards with pointer events. HTML5 drag events fire for
 * mouse only, so touch had no way to reorder anything; pointer events cover
 * mouse, touch, and pen with one code path, at the cost of having to decide for
 * ourselves what counts as a drag and when to scroll.
 */

/**
 * How far a pointer must travel before a press becomes a drag. Without it every
 * click on a card would arm a reorder, and a hand that moves a pixel between
 * press and release would reorder the list instead of opening the document.
 */
export const DRAG_ACTIVATION_DISTANCE = 6;

export function hasDragStarted(
	origin: { x: number; y: number },
	point: { x: number; y: number }
): boolean {
	return Math.hypot(point.x - origin.x, point.y - origin.y) >= DRAG_ACTIVATION_DISTANCE;
}

/** Distance from an edge of the list within which dragging scrolls it. */
export const EDGE_SCROLL_MARGIN = 56;

/** Fastest scroll, in pixels per frame, reached at the very edge. */
export const EDGE_SCROLL_MAX_STEP = 14;

/**
 * Pixels to scroll the list this frame — negative up, positive down, zero away
 * from both edges. A dragging finger cannot also scroll, so without this a card
 * can only be moved as far as the list happens to be showing.
 *
 * The step grows with how deep into the margin the pointer is, and is clamped
 * rather than extrapolated: a pointer dragged well past the edge of the list (or
 * off the screen entirely) scrolls at the same speed as one exactly on it.
 */
export function edgeScrollStep(pointerY: number, top: number, bottom: number): number {
	const depthFromTop = top + EDGE_SCROLL_MARGIN - pointerY;

	if (depthFromTop > 0) {
		return -scale(depthFromTop);
	}

	const depthFromBottom = pointerY - (bottom - EDGE_SCROLL_MARGIN);

	if (depthFromBottom > 0) {
		return scale(depthFromBottom);
	}

	return 0;
}

function scale(depth: number) {
	return Math.ceil(
		(Math.min(depth, EDGE_SCROLL_MARGIN) / EDGE_SCROLL_MARGIN) * EDGE_SCROLL_MAX_STEP
	);
}
