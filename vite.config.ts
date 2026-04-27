import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import devtoolsJson from 'vite-plugin-devtools-json';

export default defineConfig({
	plugins: [sveltekit(), devtoolsJson()],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes('node_modules')) {
						return;
					}

					if (id.includes('/@tiptap/')) {
						return 'tiptap';
					}
					if (id.includes('/prosemirror-') || id.includes('/rope-sequence/')) {
						return 'prosemirror';
					}
					if (
						id.includes('/@hocuspocus/') ||
						id.includes('/yjs/') ||
						id.includes('/y-prosemirror/') ||
						id.includes('/lib0/')
					) {
						return 'collaboration';
					}
					if (
						id.includes('/tippy.js/') ||
						id.includes('/@popperjs/') ||
						id.includes('/linkifyjs/')
					) {
						return 'editor-ui';
					}
					if (
						id.includes('/bits-ui/') ||
						id.includes('/@melt-ui/') ||
						id.includes('/focus-trap/') ||
						id.includes('/tabbable/')
					) {
						return 'dialog-ui';
					}
				}
			}
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
