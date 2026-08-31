# Testing

## Logic-in-`.ts`, UI-in-`.svelte`

Testable logic is deliberately extracted out of Svelte components into plain `.ts` modules so it can be unit-tested with vitest; the `.svelte` components themselves are not tested. **Decide where a feature's logic lives before writing it** — a rule that only holds if the extraction happens up front, because logic written inside a component tends to stay there.

The shape to aim for: the module answers a question or computes a result, and the component does the DOM work with that answer. `checkUrlInsert` decides whether a URL is acceptable and `applyUrlInsert` applies it, but the dialog that keeps the typed text on screen is the component's problem. `nextShareStatus` decides what a socket state means; painting the status line does not.

## Which module owns what

| Module                                    | Owns                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents/store.ts`                      | All IndexedDB access: schema and open-failure handling, document CRUD, legacy record migration, list order (`sortDocuments`, `moveDocumentTo`, `reorderDocuments`)                                |
| `editor/editor.ts`                        | HTML import/export, download names, share URL building/validation and connection policy, the URL-insert specs (`URL_INSERTS`, `checkUrlInsert`, `applyUrlInsert`), sidebar prefs, startup notices |
| `editor/dragging.ts`                      | Drag geometry: what counts as a drag, and how fast the list scrolls near an edge                                                                                                                  |
| `editor/toolbar.ts`                       | The toolbar data model (see [editor-ui.md](editor-ui.md#toolbar-and-bubble-menus))                                                                                                                |
| `ai/openai.ts`                            | OpenAI settings, prompt building for the one-shot actions, transport                                                                                                                              |
| `ai/actions.ts`                           | Whether an action or an agent request can run at all                                                                                                                                              |
| `ai/tools.ts` / `ai/agent.ts`             | Tool schemas, validation, the classifications (mutating / store-writing / needs approval), and the agent loop (see [ai.md](ai.md))                                                                |
| `ai/documentTools.ts` / `ai/selection.ts` | Binding the tools to the store and the editor; mapping exact text back to editor ranges                                                                                                           |
| `ai/conversation.ts` / `ai/responses.ts`  | Request payload compression, and translation to and from the Responses API                                                                                                                        |
| `ai/markdown.ts`                          | The markdown subset agent output is parsed with                                                                                                                                                   |
| `ai/historyStore.ts`                      | Per-document AI history records and their validation                                                                                                                                              |
| `utils.ts`                                | Small shared helpers (`describeError`, `isSupportedUrl`, `escapeHtml`)                                                                                                                            |

`editor/extensions.ts`, `editor/sharing.ts`, and `editor/constants.ts` are configuration rather than logic, and have no tests.

## Injection points

Each module above has a colocated `*.test.ts`. The seams tests rely on, all of which exist for that reason:

- **Storage** is an argument: `storage: Storage` for `localStorage`/`sessionStorage`, `factory?: IDBFactory` for IndexedDB (tests pass `fake-indexeddb`). Nothing reads a global store directly.
- **Time** is an argument (`now`) wherever a test asserts on it, rather than being read from `Date.now()` inside.
- **The network** is an argument: `fetchImpl` on every OpenAI call, so the agent loop can be driven through scripted turns with no network.
- **The agent's effects** are arguments: `executeTool`, `requestApproval`, and `onEvent` are injected into `runAgent`, which is what lets its invariants (approval, duplicate guards, cancellation) be tested without an editor.

## What is not covered

`.svelte` files are not unit-tested, so anything that only exists in a component — a dialog staying open on an error, a drag, a panel's live state — is verified by driving the real app in a browser. That is a deliberate trade, not an oversight: it means UI changes need a run of the app before they land, and it is why the logic above is worth keeping out of the components in the first place.
