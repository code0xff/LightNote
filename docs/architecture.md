# Architecture

How the app is put together at runtime, and how it is built. The premises this
follows from (client-only, no backend, static deploy) are in `AGENTS.md`.

## Editor is the whole app

`src/routes/+page.svelte` renders a single component, `src/lib/editor/editor.svelte`, which contains the toolbar, sidebar/document list, bubble menus, dialogs, and the Tiptap editor instance. This is a large stateful component and the primary file to touch for UI changes.

The editor decides its **runtime mode once, in `onMount`**, based on URL query params:

- **Normal mode** — loads documents from IndexedDB, autosaves edits. Uses `getExtensions()` from `extensions.ts`.
- **Sharing (collaboration) mode** — triggered when `?endpoint=` or `?workspace=` is present. Connects a Hocuspocus/Yjs provider over WebSocket and uses `getExtensionsOnSharing()` (`sharing.ts`), which disables Tiptap's local history (Yjs owns undo/redo) and adds the Collaboration extension. In this mode local IndexedDB saving is skipped (`isSharingMode` guards `scheduleCurrentDocumentSave`/`flushCurrentDocument`). Collaboration deps are dynamically imported so they stay out of the initial bundle.

## UI components

`src/lib/components/ui/` holds shadcn-style wrappers over `bits-ui` (Button, Dialog, Input, Label). Reuse these rather than raw elements; icons come from `lucide-svelte`. New dialogs follow the pattern in `editor.svelte` (e.g. the Share and AI dialogs).

## Build / bundle notes

- `vite.config.ts` defines manual chunks (`tiptap`, `prosemirror`, `collaboration`, `editor-ui`, `dialog-ui`) to split the large editor dependencies.
- `svelte.config.js` sets `paths.base` to `/LightNote` in production (empty in dev) because the site is served from a GitHub Pages subpath. Keep this in mind for any hardcoded links/asset paths.
- Path aliases: `$lib` → `src/lib` (SvelteKit default) and `@/*` → `src/*`.
- `src/service-worker.js` precaches the built assets (workbox) to enable offline use.
