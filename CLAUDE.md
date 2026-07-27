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

## Development workflow

Work through features in this order:

1. **Plan** — outline the approach before writing code (surface the design, affected files, and trade-offs).
2. **Implement** — make the change, keeping the logic-in-`.ts` / UI-in-`.svelte` convention below.
3. **Codex review** — have Codex review the change (via the `codex` plugin, e.g. the `codex:rescue` skill) before it lands.
4. **Commit & push** — only after the review and the checks above pass. Commit and push are done when the user asks.

Commit messages **must** use the `type: message` format (e.g. `feat: add AI writing`, `fix: ...`, `docs: ...`, `refactor: ...`, `style: ...`, `chore: ...`, `test: ...`).

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
- `ai/tools.ts` / `ai/agent.ts` / `ai/documentTools.ts` — the agent tool layer (see below).

Each has a colocated `*.test.ts`. Storage-touching functions take an injectable `storage: Storage` / `factory?: IDBFactory` argument specifically so tests can pass fakes and time (`now`) is passed in rather than read from `Date.now()` internally where it matters for assertions.

### Persistence model

- **Documents** live in IndexedDB (`store.ts`): DB `light-note`, version 2, object store `documents`. `normalizeDocument` migrates older records (e.g. an `html` field, missing `contentFormat`) into the current `LightNoteDocument` shape on read, so the store tolerates legacy data. `ensureInitialDocument` also migrates a legacy single-doc `auto_saved` localStorage blob into a real document on first load.
- **App state** lives in `localStorage`. Keys in use: `currentDocumentId`, `edited` (last export filename), `shared`/`connected`/`sharedDocuments` (collaboration), `openai` (AI settings), and legacy `auto_saved`.
- Saves are **debounced (500ms) and serialized** through a promise chain (`saveQueue`) to avoid overlapping IndexedDB writes.

### AI writing (BYOK)

`src/lib/ai/openai.ts` is a self-contained OpenAI client. The user supplies their own API key (stored only in `localStorage`, sent directly to `api.openai.com`). `buildMessages(action, ...)` maps the five actions (`rewrite`, `summarize`, `proofread`, `continue`, `prompt`) to chat messages; `generateText` calls the API and `toEditorHtml` turns the plain-text result into paragraph HTML for Tiptap insertion. Default model is `gpt-5.6-luna` (`OPENAI_MODEL_OPTIONS` lists the selectable models). Note: `temperature` is intentionally **not** sent — current GPT-5 models reject non-default values.

### AI agent mode (tool calling)

The AI panel has two modes: **Ask** (the one-shot actions above) and **Agent**, which lets the model read and change documents through tools. The layers are deliberately separate so each is unit-testable:

- `ai/openai.ts` — transport. `requestChatMessage` returns the raw assistant message so `tool_calls` survive (`parseAssistantMessage` tolerates a `null` content when tool calls are present). `tools` is omitted from the request body when empty, so plain Ask-mode calls are unchanged. `createChatCompletion` is a text-only wrapper over it.
- `ai/tools.ts` — the six tool schemas (`list_documents`, `read_document`, `insert_at_cursor`, `replace_selection`, `create_document`, `update_document`) plus pure validation. `validateToolCall` **returns** errors instead of throwing so the loop can hand them back to the model. Also classifies tools: mutating (all four writes) and store-writing (`create_document`/`update_document`, unavailable in sharing mode).
- `ai/agent.ts` — `runAgent(instruction, deps)` drives the loop with everything injected (`executeTool`, `requestApproval`, `onEvent`, `fetchImpl`). Invariants: **mutating tools never run without approval** (no `requestApproval` ⇒ denied); every `tool_call` always gets a matching `tool` message (even when invalid, denied, or over the per-step cap); the run is bounded by `maxSteps` (8, normalized to a finite whole number) × `MAX_TOOL_CALLS_PER_STEP` (8); and `signal` is re-checked before each call and after each approval so cancelling cannot let a queued mutation through.
- `ai/markdown.ts` — a small markdown subset (headings, flat lists, quotes, fenced code, bold/italic/inline code, links) parsed into Tiptap nodes so agent output lands as rich content. `blocksToHtml` serializes it back to HTML for appending to legacy HTML documents. Link targets are restricted to http/https/mailto; anything else keeps the label and drops the href.
- `ai/documentTools.ts` — `createDocumentToolExecutor(deps)` binds the tools to the store and an `EditorBridge` (which receives parsed nodes, not text). **Edits to the open document go through editor commands** (undoable, Yjs-safe); only other documents are written straight to IndexedDB. The open document is _read_ from the editor because store saves are debounced.

`editor.svelte` owns the UI state: mode, step timeline, and the approval prompt (a promise resolved by the Approve/Reject buttons). **Closing the panel cancels any in-flight run** — the panel is the only place a run is visible or answerable, and reopening resets that state, so a surviving run would mean hidden mutations or an approval promise nothing can resolve.

The "approve automatically for this session" checkbox is a deliberate opt-out of per-call confirmation (default off, and it shows a warning while enabled); the step timeline is the audit trail for what it applied.

### Build / bundle notes

- `vite.config.ts` defines manual chunks (`tiptap`, `prosemirror`, `collaboration`, `editor-ui`, `dialog-ui`) to split the large editor dependencies.
- `svelte.config.js` sets `paths.base` to `/LightNote` in production (empty in dev) because the site is served from a GitHub Pages subpath. Keep this in mind for any hardcoded links/asset paths.
- Path aliases: `$lib` → `src/lib` (SvelteKit default) and `@/*` → `src/*`.
- `src/service-worker.js` precaches the built assets (workbox) to enable offline use.

### UI components

`src/lib/components/ui/` holds shadcn-style wrappers over `bits-ui` (Button, Dialog, Input, Label). Reuse these rather than raw elements; icons come from `lucide-svelte`. New dialogs follow the pattern in `editor.svelte` (e.g. the Share and AI dialogs).
