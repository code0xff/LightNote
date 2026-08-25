# Testing

## Logic-in-`.ts`, UI-in-`.svelte`

Testable logic is deliberately extracted out of Svelte components into plain `.ts` modules so it can be unit-tested with vitest; the `.svelte` components themselves are not tested. Follow this pattern when adding features:

- `editor/editor.ts` — pure helpers (HTML import/export, share URL building/validation, upload validation, link/image/YouTube/table insertion).
- `editor/toolbar.ts` — the toolbar data model (see [editor-ui.md](editor-ui.md#toolbar-and-bubble-menus)).
- `documents/store.ts` — all IndexedDB access.
- `ai/openai.ts` — all OpenAI settings/prompt/request/response logic.
- `ai/tools.ts` / `ai/agent.ts` / `ai/documentTools.ts` — the agent tool layer (see [ai.md](ai.md)).

Each has a colocated `*.test.ts`. Storage-touching functions take an injectable `storage: Storage` / `factory?: IDBFactory` argument specifically so tests can pass fakes and time (`now`) is passed in rather than read from `Date.now()` internally where it matters for assertions.
