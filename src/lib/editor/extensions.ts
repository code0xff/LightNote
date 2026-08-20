import { isTextSelection, type Extension, type Extensions } from '@tiptap/core';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import StarterKit from '@tiptap/starter-kit';
import { isCellSelection } from './editor';

type ExtensionOptions = {
	starterKit?: Extension;
	extraExtensions?: Extensions;
};

/**
 * The two floating menus. `format` follows a text selection; `table` follows the
 * cursor inside a table, which keeps the row/column tools next to the table
 * instead of in the toolbar, where they would shift every button to their right
 * whenever the cursor entered a cell.
 */
export type BubbleMenuElements = {
	format: HTMLElement;
	table: HTMLElement;
};

export function getExtensions(menus: BubbleMenuElements, options: ExtensionOptions = {}) {
	return [
		options.starterKit ?? StarterKit,
		...(options.extraExtensions ?? []),
		BubbleMenu.configure({
			element: menus.format,
			// Tiptap's default rule (focused, editable, a selection that is not an
			// empty text block) plus one exclusion: selecting cells is a table
			// gesture, so it belongs to the table menu instead of stacking both
			// menus over the same selection.
			shouldShow: ({ editor, view, state, from, to }) => {
				const { selection } = state;
				const isEmptyTextBlock =
					!state.doc.textBetween(from, to).length && isTextSelection(selection);

				return (
					view.hasFocus() &&
					editor.isEditable &&
					!selection.empty &&
					!isEmptyTextBlock &&
					!isCellSelection(selection)
				);
			}
		}),
		// Two BubbleMenu instances need distinct extension names and plugin keys.
		BubbleMenu.extend({ name: 'tableBubbleMenu' }).configure({
			element: menus.table,
			pluginKey: 'tableBubbleMenu',
			// Unlike the format menu this one shows for a plain cursor, because the
			// row/column tools act on the cell the cursor sits in.
			shouldShow: ({ editor, view, state }) =>
				view.hasFocus() &&
				editor.isEditable &&
				editor.isActive('table') &&
				(state.selection.empty || isCellSelection(state.selection))
		}),
		Link.configure({
			HTMLAttributes: {
				target: '_self'
			}
		}),
		Image.configure({
			inline: true
		}),
		TextAlign.configure({
			types: ['heading', 'paragraph']
		}),
		Placeholder,
		Table.configure({
			resizable: true
		}),
		TableRow,
		TableHeader,
		TableCell,
		Youtube.configure({
			inline: true
		}),
		Underline
	];
}
