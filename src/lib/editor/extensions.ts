import type { Extension, Extensions } from '@tiptap/core';
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

type ExtensionOptions = {
	starterKit?: Extension;
	extraExtensions?: Extensions;
};

export function getExtensions(bubbleMenu: HTMLElement, options: ExtensionOptions = {}) {
	return [
		options.starterKit ?? StarterKit,
		...(options.extraExtensions ?? []),
		BubbleMenu.configure({
			element: bubbleMenu
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
