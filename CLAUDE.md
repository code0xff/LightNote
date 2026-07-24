# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start the Vite dev server
npm run build      # production build (static, output to build/)
npm run preview    # preview the production build locally

npm run check      # svelte-kit sync + svelte-check (type checking)
npm run lint       # prettier --check . && eslint .
npm run format     # prettier --write . (run this to fix lint formatting failures)

npm test -- --run  # run the full test suite once (vitest)
npx vitest run src/lib/ai/openai.test.ts   # run a single test file
npx vitest run -t "builds encoded sharing URLs"   # run tests matching a name

npm run deploy     # build + publish build/ to GitHub Pages (gh-pages branch)
```

Before publishing changes, the README expects all of `check`, `lint`, `test -- --run`, and `build` to pass.

## Architecture

LightNote is an **offline-first, client-only** note editor. There is **no backend** — SvelteKit is used with `adapter-static` and `prerender = true` to produce a static site deployed to GitHub Pages. All persistence is in the browser. Any "server" interaction (collaboration relay, OpenAI) talks directly from the browser to an external endpoint the user supplies.

### Editor is the whole app
`src/routes/+page.svelte` renders a single component, `src/lib/editor/editor.svelte`, which contains the toolbar, sidebar/document list, bubble menu, dialogs, and the Tiptap editor instance. This is a large stateful component and the primary file to touch for UI changes.

The editor decides its **runtime mode once, in `onMount`**, based on URL query params:
- **Normal mode** — loads documents from IndexedDB, autosaves edits. Uses `getExtensions()` from `extensions.ts`.
- **Sharing (collaboration) mode** — triggered when `?endpoint=` or `?workspace=` is present. Connects a Hocuspocus/Yjs provider over WebSocket and uses `getExtensionsOnSharing()` (`sharing.ts`), which disables Tiptap's local history (Yjs owns undo/redo) and adds the Collaboration extension. In this mode local IndexedDB saving is skipped (`isSharingMode` guards `scheduleCurrentDocumentSave`/`flushCurrentDocument`). Collaboration deps are dynamically imported so they stay out of the initial bundle.

### Logic-in-`.ts`, UI-in-`.svelte` (testing convention)
Testable logic is deliberately extracted out of Svelte components into plain `.ts` modules so it can be unit-tested with vitest; the `.svelte` components themselves are not tested. Follow this pattern when adding features:
- `editor/editor.ts` — pure helpers (HTML import/export, share URL building/validation, upload validation, link/image/YouTube insertion).
- `documents/store.ts` — all IndexedDB access.
- `ai/openai.ts` — all OpenAI settings/prompt/request/response logic.

Each has a colocated `*.test.ts`. Storage-touching functions take an injectable `storage: Storage` / `factory?: IDBFactory` argument specifically so tests can pass fakes and time (`now`) is passed in rather than read from `Date.now()` internally where it matters for assertions.

### Persistence model
- **Documents** live in IndexedDB (`store.ts`): DB `light-note`, version 2, object store `documents`. `normalizeDocument` migrates older records (e.g. an `html` field, missing `contentFormat`) into the current `LightNoteDocument` shape on read, so the store tolerates legacy data. `ensureInitialDocument` also migrates a legacy single-doc `auto_saved` localStorage blob into a real document on first load.
- **App state** lives in `localStorage`. Keys in use: `currentDocumentId`, `edited` (last export filename), `shared`/`connected`/`sharedDocuments` (collaboration), `openai` (AI settings), and legacy `auto_saved`.
- Saves are **debounced (500ms) and serialized** through a promise chain (`saveQueue`) to avoid overlapping IndexedDB writes.

### AI writing (BYOK)
`src/lib/ai/openai.ts` is a self-contained OpenAI client. The user supplies their own API key (stored only in `localStorage`, sent directly to `api.openai.com`). `buildMessages(action, ...)` maps the five actions (`rewrite`, `summarize`, `proofread`, `continue`, `prompt`) to chat messages; `generateText` calls the API and `toEditorHtml` turns the plain-text result into paragraph HTML for Tiptap insertion. Default model is `gpt-5.6-luna` (`OPENAI_MODEL_OPTIONS` lists the selectable models). Note: `temperature` is intentionally **not** sent — current GPT-5 models reject non-default values.

### Build / bundle notes
- `vite.config.ts` defines manual chunks (`tiptap`, `prosemirror`, `collaboration`, `editor-ui`, `dialog-ui`) to split the large editor dependencies.
- `svelte.config.js` sets `paths.base` to `/LightNote` in production (empty in dev) because the site is served from a GitHub Pages subpath. Keep this in mind for any hardcoded links/asset paths.
- Path aliases: `$lib` → `src/lib` (SvelteKit default) and `@/*` → `src/*`.
- `src/service-worker.js` precaches the built assets (workbox) to enable offline use.

### UI components
`src/lib/components/ui/` holds shadcn-style wrappers over `bits-ui` (Button, Dialog, Input, Label). Reuse these rather than raw elements; icons come from `lucide-svelte`. New dialogs follow the pattern in `editor.svelte` (e.g. the Share and AI dialogs).
