import type { HocuspocusProvider } from '@hocuspocus/provider';
import StarterKit from '@tiptap/starter-kit';
import { getExtensions } from './extensions';

export async function getExtensionsOnSharing(
	provider: HocuspocusProvider,
	bubbleMenu: HTMLElement
) {
	const { default: Collaboration } = await import('@tiptap/extension-collaboration');

	return getExtensions(bubbleMenu, {
		starterKit: StarterKit.configure({
			history: false
		}),
		extraExtensions: [
			Collaboration.configure({
				document: provider.document
			})
		]
	});
}
