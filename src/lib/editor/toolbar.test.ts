import { describe, expect, it } from 'vitest';
import type { ComponentType } from 'svelte';
import {
	activeMenuItem,
	collectPrimaryItems,
	flattenGroup,
	toolbarItem,
	toolbarMenu,
	type ToolbarGroup,
	type ToolbarItem
} from './toolbar';

const icon = {} as ComponentType;

function item(key: string, overrides: Partial<ToolbarItem> = {}): ToolbarItem {
	return { key, label: key, icon, onClick: () => {}, ...overrides };
}

const group: ToolbarGroup = {
	id: 'insert',
	label: 'Insert',
	nodes: [
		toolbarItem(item('bold', { primary: true })),
		toolbarMenu({
			key: 'align',
			label: 'Align',
			icon,
			reflectActive: true,
			items: [item('left'), item('center', { active: true, primary: true })]
		})
	]
};

describe('flattenGroup', () => {
	it('lifts menu items out of their menus so every action stays reachable', () => {
		expect(flattenGroup(group).map((entry) => entry.key)).toEqual(['bold', 'left', 'center']);
	});

	it('keeps a plain item usable as an item', () => {
		const [bold] = flattenGroup(group);

		expect(bold.label).toBe('bold');
		expect(bold.primary).toBe(true);
	});
});

describe('collectPrimaryItems', () => {
	it('collects primary items from items and from inside menus', () => {
		expect(collectPrimaryItems([group]).map((entry) => entry.key)).toEqual(['bold', 'center']);
	});

	it('is empty when nothing is marked primary', () => {
		const plain: ToolbarGroup = { id: 'x', label: 'X', nodes: [toolbarItem(item('a'))] };

		expect(collectPrimaryItems([plain])).toEqual([]);
	});
});

describe('activeMenuItem', () => {
	it('finds the active entry so a menu trigger can mirror it', () => {
		expect(activeMenuItem([item('a'), item('b', { active: true })])?.key).toBe('b');
	});

	it('returns nothing when no entry is active', () => {
		expect(activeMenuItem([item('a'), item('b')])).toBeUndefined();
	});
});
