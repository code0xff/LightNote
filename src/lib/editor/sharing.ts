import type { HocuspocusProvider } from '@hocuspocus/provider';
import { getExtensions } from './extensions';

export function getExtensionsOnSharing(provider: HocuspocusProvider, bubbleMenu: HTMLElement) {
	return getExtensions(bubbleMenu, provider);
}
