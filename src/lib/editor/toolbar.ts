import type { ComponentType } from 'svelte';

/**
 * The toolbar is built as data so one description can render three ways: the
 * grouped desktop bar, the dropdown menus inside it, and the compact mobile row
 * plus its overflow sheet. Menus exist to keep the bar short — flattening them
 * is what makes the mobile sheet show every action as a plain button.
 */

export type ToolbarItem = {
	key: string;
	label: string;
	icon: ComponentType;
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
	/** Stays visible in the compact mobile row instead of moving to the sheet. */
	primary?: boolean;
};

export type ToolbarMenu = {
	key: string;
	label: string;
	icon: ComponentType;
	/** Short text next to the icon, e.g. the current block style. */
	caption?: string;
	/**
	 * Mirror the active item on the trigger. Only for menus of mutually
	 * exclusive states (block style, alignment): on an Insert menu it would
	 * relabel the trigger just because the cursor sits in a link.
	 */
	reflectActive?: boolean;
	items: ToolbarItem[];
};

export type ToolbarNode = ({ kind: 'item' } & ToolbarItem) | ({ kind: 'menu' } & ToolbarMenu);

export type ToolbarGroup = {
	id: string;
	label: string;
	nodes: ToolbarNode[];
};

export function toolbarItem(item: ToolbarItem): ToolbarNode {
	return { kind: 'item', ...item };
}

export function toolbarMenu(menu: ToolbarMenu): ToolbarNode {
	return { kind: 'menu', ...menu };
}

/** Every action in a group, with menu contents lifted out of their menus. */
export function flattenGroup(group: ToolbarGroup): ToolbarItem[] {
	return group.nodes.flatMap((node) => (node.kind === 'menu' ? node.items : [node]));
}

export function collectPrimaryItems(groups: ToolbarGroup[]): ToolbarItem[] {
	return groups.flatMap((group) => flattenGroup(group).filter((item) => item.primary));
}

/**
 * The menu trigger reflects the state it controls, so the bar still says which
 * block style or alignment is active once those buttons live behind a menu.
 */
export function activeMenuItem(items: ToolbarItem[]): ToolbarItem | undefined {
	return items.find((item) => item.active);
}
