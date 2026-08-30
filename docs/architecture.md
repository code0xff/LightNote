# Architecture

How the app is put together at runtime, and how it is built. The premises this
follows from (client-only, no backend, static deploy) are in `AGENTS.md`.

## Editor is the whole app

`src/routes/+page.svelte` renders a single component, `src/lib/editor/editor.svelte`, which contains the toolbar, sidebar/document list, bubble menus, dialogs, and the Tiptap editor instance. This is a large stateful component and the primary file to touch for UI changes.

The editor decides its **runtime mode once, in `onMount`**, based on URL query params:

- **Normal mode** — loads documents from IndexedDB, autosaves edits. Uses `getExtensions()` from `extensions.ts`.
- **Sharing (collaboration) mode** — triggered when `?endpoint=` or `?workspace=` is present. Connects a Hocuspocus/Yjs provider over WebSocket and uses `getExtensionsOnSharing()` (`sharing.ts`), which disables Tiptap's local history (Yjs owns undo/redo) and adds the Collaboration extension. In this mode local IndexedDB saving is skipped (`isSharingMode` guards `scheduleCurrentDocumentSave`/`flushCurrentDocument`). Collaboration deps are dynamically imported so they stay out of the initial bundle.

The mode **is** the URL, and switching modes is a `location.replace`. That is not a shortcut: an editor's extension list is fixed when it is created, and the two modes differ in it (history off, Collaboration on), so there is nothing to toggle at runtime. Making the session a link is what falls out of it — a share can be sent, bookmarked, and refreshed.

### Staying connected

A shared document has no local row, so its content exists in this page and on the relay and nowhere else. Every rule below follows from that.

**Reconnection belongs to the provider.** `SHARE_SOCKET_OPTIONS` gives it `maxAttempts: 0` — retry for as long as the tab is open, with backoff capped by `maxDelay`. The earlier code set `maxAttempts: 1` and hand-rolled the retry as a **full page reload**, which threw away the editor, the panels, and any edits that had not reached the relay — the last of these silently, since the reason the socket closed is often that they hadn't. It also gave up after one attempt, so a relay that took three seconds to restart ended the session; and because a successful connect cleared the retry flag, a link that flapped could reload the page forever.

**Nothing navigates away from a connected session.** `applyShareStatus` only sets state: the status line under the workspace title, and a standing toast (with a **Save a copy** action) because that line is out of sight for anyone editing further down. `nextShareStatus(connected, hasConnected)` carries the one distinction that matters — an address that never answered is a wrong link, a session that dropped is an outage to wait out.

**The only automatic exit is the first connection.** `SHARE_CONNECT_TIMEOUT_MS` gives the initial connect 8 seconds, then hands a notice to the next page and goes home; a stale share link should not park the user in a broken session. The timer is cleared on the first connect and never re-armed, so it cannot fire on a session that has content.

**`provider.connect()` is deliberately not awaited.** The `Y.Doc` exists immediately and fills in when the first sync lands, so the editor renders at once instead of holding a blank page for the handshake. With unlimited attempts, awaiting it would mean never rendering at all against a dead relay.

**`saveSharedCopy` is the escape hatch**, in the utility menu and in the disconnect toast: it writes the current content into IndexedDB as a normal note. Without it there is no way for work done in a shared session to survive the relay.

There is **no authentication**: anyone with the endpoint and workspace name can read and edit, which makes the workspace name the only secret. That is a choice, not an oversight, and the Share dialog says so out loud — along with the fact that an HTTPS page can only reach a `wss://` endpoint.

## UI components

`src/lib/components/ui/` holds shadcn-style wrappers over `bits-ui` (Button, Dialog, Input, Label, Popover) plus `Toaster`, a wrapper over `svelte-sonner`. Reuse these rather than raw elements; icons come from `lucide-svelte`. New dialogs follow the pattern in `editor.svelte` (e.g. the Share and AI dialogs).

The `Toaster` is mounted once, in `+layout.svelte`, and configured there rather than at any call site — `toast(...)` reaches it from anywhere. **The app has no `window.alert`, `confirm`, or `prompt`**; what replaced each of them, and how to choose between a dialog and a toast, is in [editor-ui.md](editor-ui.md#dialogs-and-toasts).

## Build / bundle notes

- `vite.config.ts` defines manual chunks (`tiptap`, `prosemirror`, `collaboration`, `editor-ui`, `dialog-ui`) to split the large editor dependencies.
- `svelte.config.js` sets `paths.base` to `/LightNote` in production (empty in dev) because the site is served from a GitHub Pages subpath. Keep this in mind for any hardcoded links/asset paths.
- Path aliases: `$lib` → `src/lib` (SvelteKit default) and `@/*` → `src/*`.
- `src/service-worker.js` precaches the built assets (workbox) to enable offline use.
