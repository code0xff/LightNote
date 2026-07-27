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

- **Schema upgrades are user-visible**, because the app version and the DB version ship together. `openRequestToPromise` covers the two failure modes this creates: a `blocked` open (another tab still holds an older-version connection) waits `OPEN_BLOCKED_TIMEOUT_MS` and then fails with `DB_BLOCKED_MESSAGE` instead of hanging forever, and a `VersionError` (this build is older than the stored DB — usually a tab served the previous build from the service worker cache) becomes `DB_OUTDATED_MESSAGE` asking for a reload. Each opened connection closes itself on `versionchange` so one tab cannot block the next version. `src/service-worker.js` calls `skipWaiting()`/`clients.claim()` so that reload lands on the new build rather than the stale cached one — the trade-off is that a tab left open on the previous build may fail a lazy chunk import and must be reloaded.
- **Documents** live in IndexedDB (`store.ts`): DB `light-note`, version 3, object stores `documents` and `aiHistory`. `store.ts` owns the schema (so the DB is never opened at two versions) and exports `withStore(storeName, ...)`; the `aiHistory` records themselves are managed by `ai/historyStore.ts`. `normalizeDocument` migrates older records (e.g. an `html` field, missing `contentFormat`) into the current `LightNoteDocument` shape on read, so the store tolerates legacy data. `ensureInitialDocument` also migrates a legacy single-doc `auto_saved` localStorage blob into a real document on first load.
- **App state** lives in `localStorage`. Keys in use: `currentDocumentId`, `edited` (last export filename), `shared`/`connected`/`sharedDocuments` (collaboration), `openai` (AI settings), and legacy `auto_saved`.
- Saves are **debounced (500ms) and serialized** through a promise chain (`saveQueue`) to avoid overlapping IndexedDB writes.

### AI writing (BYOK)

`src/lib/ai/openai.ts` is a self-contained OpenAI client. The user supplies their own API key (stored only in `localStorage`, sent directly to `api.openai.com`). `buildMessages(action, ...)` maps the five actions (`rewrite`, `summarize`, `proofread`, `continue`, `prompt`) to chat messages; `generateText` calls the API and `toEditorHtml` turns the plain-text result into paragraph HTML for Tiptap insertion. Default model is `gpt-5.6-luna` (`OPENAI_MODEL_OPTIONS` lists the selectable models). Note: `temperature` is intentionally **not** sent — current GPT-5 models reject non-default values.

### AI agent mode (tool calling)

The AI panel has two modes: **Ask** (the one-shot actions above) and **Agent**, which lets the model read and change documents through tools. The mode value `ask`/`agent` is also stored on every `aiHistory` record, so renaming it would invalidate existing history; labels live in `MODE_LABELS` (`AiPromptPanel.svelte`) if they ever change. The layers are deliberately separate so each is unit-testable:

- `ai/openai.ts` — transport, split by whether the request carries tools. **Text-only requests keep using `/v1/chat/completions`** with exactly their previous body. **Tool-carrying requests go to `/v1/responses`** (`ai/responses.ts`) with `reasoning: { effort: 'low' }` and `store: false`: chat-completions refuses function tools unless reasoning is off ("Function tools with reasoning_effort are not supported … set reasoning_effort to 'none'"), and turning reasoning off is what the agent loop can least afford. Model names are free-form, so a 400/404 from Responses falls back once to chat-completions with `reasoning_effort: 'none'`; 401/429/5xx are surfaced immediately rather than retried. `requestChatMessage` returns the raw assistant message either way, so the loop above it does not know which endpoint answered.
- `ai/responses.ts` — pure translation between the internal `ChatMessage` format and Responses items: tools are flat (no nested `function`), and a tool result becomes `function_call_output`. **With `store: false` we own the whole transcript, and the API requires every output item to come back on later turns** — including reasoning items — so `parseResponsesMessage` keeps the raw `output` array on `AssistantMessage.output_items` and `toResponsesInput` replays it verbatim instead of rebuilding "text, then calls". `output_items` is internal: `toChatMessages` strips it before anything reaches `/v1/chat/completions`. Parsing drops malformed and duplicate-id calls, and the replay list is built from the calls that were _kept_, so a dropped call never returns as a `function_call` without a matching output. Top-level `output_text` is an SDK convenience field, not documented raw HTTP, so it is only a last resort.
- `ai/conversation.ts` — `compressConversation` builds each request's payload: preamble and the recent `recentRounds` (3) rounds verbatim, older rounds collapsed into a deterministic ledger, and superseded identical reads stubbed. No extra model call, and the caller keeps the full transcript for the audit trail and for continuing. Details that matter: ledger lines keep an **excerpt of the result payload** (collapsing `list_documents` to a bare "ok" would strip the ids the model still needs) plus the agent's own commentary; a read is only stubbed when both it and the newer call succeeded, and the stub never restates a failure as a success; and a tool result is attached only to the round whose `tool_calls` actually contain its id, so the payload can never carry an unpaired output.
- `ai/tools.ts` — the seven tool schemas (`list_documents`, `read_document`, `insert_at_cursor`, `replace_selection`, `replace_text`, `create_document`, `update_document`) plus pure validation. `replace_text` changes one exact, uniquely occurring fragment in the open document; it rejects missing, duplicated, or cross-paragraph targets rather than guessing. `validateToolCall` **returns** errors instead of throwing so the loop can hand them back to the model. Also classifies tools: mutating (all five writes) and store-writing (`create_document`/`update_document`, unavailable in sharing mode).
- `ai/agent.ts` — `runAgent(instruction, deps)` drives the loop with everything injected (`executeTool`, `requestApproval`, `onEvent`, `fetchImpl`). Invariants: **mutating tools never run without approval** (no `requestApproval` ⇒ denied); every `tool_call` always gets a matching `tool` message (even when invalid, denied, or over the per-step cap); the run is bounded by `maxSteps` (24, normalized to a finite whole number) × `MAX_TOOL_CALLS_PER_STEP` (8); and `signal` is re-checked before each call and after each approval so cancelling cannot let a queued mutation through.

  Stopping is **stall-based, not round-based**: after `MAX_STALLED_ROUNDS` (2) consecutive rounds whose every tool call repeats an earlier signature, the run ends with `stopReason: 'stalled'`. The step budget is only the backstop that keeps a run finite — reads are legitimately repeated after a write, which is why a single repeat is not enough. The per-step cap is applied **before** stall detection, so calls that will never run cannot mask (or fake) a stall, and a stalled round still records a result for every pending call: a transcript ending in an unanswered `function_call` would be rejected when the user continues.

  A run that stops for either reason returns its `messages`, and the panel offers **Continue**, which calls `runAgent` again with `priorMessages`. The transcript is replayed but **its system prompt is rebuilt from the live deps, not inherited**: rules and scope belong to the request being made now, so an inherited prompt would keep ordering a `replace_selection` whose selection the stopped run already consumed. Continuing sends a neutral `Continue.` instruction rather than the textarea contents, and `collectAppliedMutations` seeds the run from the transcript so a mutating call whose identical signature already succeeded is refused with `status: 'duplicate'` — it never even reaches the approval prompt. That guard matters because approval alone is weak here: the second prompt looks identical to the first, and session auto-approve skips it.

- `ai/markdown.ts` — a small markdown subset (headings, flat lists, quotes, fenced code, bold/italic/inline code, links) parsed into Tiptap nodes so agent output lands as rich content. `blocksToHtml` serializes it back to HTML for appending to legacy HTML documents. Link targets are restricted to http/https/mailto; anything else keeps the label and drops the href.
- `ai/documentTools.ts` — `createDocumentToolExecutor(deps)` binds the tools to the store and an `EditorBridge` (which receives parsed nodes, not text). **Edits to the open document go through editor commands** (undoable, Yjs-safe); only other documents are written straight to IndexedDB. The open document is _read_ from the editor because store saves are debounced. `ai/selection.ts` maps contiguous text nodes back to editor ranges for the exact-text guard. **An in-paragraph replacement must be applied as inline content**: `insertContentAt` given a block node (a parsed markdown paragraph, or `toEditorHtml`'s `<p>`) over a range inside a paragraph splits that paragraph around the replacement, so `replaceRangeWithNodes` and the Ask-mode replace path unwrap a single-paragraph result first (`toInlineEditorHtml`). Multi-block results, headings and lists still insert as blocks — there the structural change is the point.

Ask remains the default, suggestion-only mode: a prompt without selected text receives no document context, so it cannot accidentally return a whole-document rewrite for insertion. Agent mode is the context-aware document workflow: it uses `insert_at_cursor` for new writing, `replace_selection` for a captured selection, and `replace_text` for a targeted unselected edit. Replacing a whole document **body** needs the one-request full-document opt-in, and that gate is per call (`isDocumentWideReplacement`), not per tool: `update_document` also renames and appends, so withholding the tool by name would take those away from every run that did not tick the box. The refusal happens before the approval prompt, so the user is never asked to approve a permission they did not grant. The opt-in resets after the request and is retained only when continuing that same stopped run (the panel says so, because the reset checkbox would otherwise contradict it). A captured selection is a hard scope: `selectionOnly` removes `insert_at_cursor`, `create_document`, `replace_text` **and** `update_document`, leaving `replace_selection` as the only write — which is why a selection whose range no longer matches the document is dropped before the run starts rather than left to fail every write. **Both permissions and the selection they apply to live on the resume record, not on live panel state**: a successful `replace_selection` clears the selection, so recomputing the scope on Continue would silently widen a selection-scoped run into a document-wide one, and reopening the panel recaptures the current editor selection, so reading it live would let a continuation replace newly selected, unrelated text. Continuing a selection-scoped run whose selection was already replaced is allowed but write-free: the prompt says the scope is spent and asks for the reply, because that stop usually means the model never got to summarize — not that another edit is owed. Whichever restriction withholds a tool, `explainUnavailableTool` names that restriction — the model reports the reason to the user and picks its next move from it, so a selection-scoped refusal must not come back as a sharing-mode one.

### AI history (per document)

`ai/historyStore.ts` persists every Ask result and Agent run in the `aiHistory` object store, scoped by a key: `doc:<id>` for saved documents, `shared:<encoded endpoint>/<encoded workspace>` for collaboration sessions (which have no local document row; both parts are URI-encoded so slashes cannot make two sessions collide). The panel renders that history as a chat-style timeline — there is no separate "latest result" state, and any past Ask entry can still be inserted or used to replace the selection.

Invariants worth keeping:

- `appendAiHistory` prunes to 50 entries per document and **returns the resulting list**; render that, never a locally appended copy, or the UI keeps entries pruning just deleted.
- Every persisted text field is capped (entry text, error, step descriptions), and both entries and their `steps` are validated element by element on read — a malformed record is skipped rather than handed to the panel.
- Reads and writes capture the key they started with: `loadAiHistory` discards a result whose document is no longer open, and a request records against the document it started from (the agent can switch documents mid-run).
- `aiRunId` identifies the in-flight request. Cancelling retires the id, so a superseded run cannot reset `aiBusy`/the controller or overwrite the live step list; its steps are collected locally so it still records what it actually did.
- Deleting a document clears its history and marks the key, so an in-flight run cannot recreate it.

`editor.svelte` owns the UI state: mode, step timeline, and the approval prompt (a promise resolved by the Approve/Reject buttons). **Closing the panel cancels any in-flight run** — the panel is the only place a run is visible or answerable, and reopening resets that state, so a surviving run would mean hidden mutations or an approval promise nothing can resolve.

The "approve automatically for this session" checkbox is a deliberate opt-out of per-call confirmation (default off, and it shows a warning while enabled); the step timeline is the audit trail for what it applied.

### Build / bundle notes

- `vite.config.ts` defines manual chunks (`tiptap`, `prosemirror`, `collaboration`, `editor-ui`, `dialog-ui`) to split the large editor dependencies.
- `svelte.config.js` sets `paths.base` to `/LightNote` in production (empty in dev) because the site is served from a GitHub Pages subpath. Keep this in mind for any hardcoded links/asset paths.
- Path aliases: `$lib` → `src/lib` (SvelteKit default) and `@/*` → `src/*`.
- `src/service-worker.js` precaches the built assets (workbox) to enable offline use.

### UI components

`src/lib/components/ui/` holds shadcn-style wrappers over `bits-ui` (Button, Dialog, Input, Label). Reuse these rather than raw elements; icons come from `lucide-svelte`. New dialogs follow the pattern in `editor.svelte` (e.g. the Share and AI dialogs).
