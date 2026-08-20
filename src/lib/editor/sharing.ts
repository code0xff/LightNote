import type { HocuspocusProvider } from '@hocuspocus/provider';
import StarterKit from '@tiptap/starter-kit';
import { getExtensions, type BubbleMenuElements } from './extensions';

export async function getExtensionsOnSharing(
	provider: HocuspocusProvider,
	menus: BubbleMenuElements
) {
	const { default: Collaboration } = await import('@tiptap/extension-collaboration');

	return getExtensions(menus, {
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
