import type { HocuspocusProvider } from '@hocuspocus/provider';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import StarterKit from '@tiptap/starter-kit';

export function getExtensions(bubbleMenu: HTMLElement, provider?: HocuspocusProvider) {
	return [
		provider
			? StarterKit.configure({
					history: false
				})
			: StarterKit,
		...(provider
			? [
					Collaboration.configure({
						document: provider.document
					})
				]
			: []),
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
		Youtube.configure({
			inline: true
		}),
		Underline
	];
}
