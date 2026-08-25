# Persistence

Everything is stored in the browser: IndexedDB for documents and AI history,
`localStorage` for app state. There is no server to fall back on, so schema and
save behaviour are user-visible.

## Persistence model

- **Schema upgrades are user-visible**, because the app version and the DB version ship together. `openRequestToPromise` covers the two failure modes this creates: a `blocked` open (another tab still holds an older-version connection) waits `OPEN_BLOCKED_TIMEOUT_MS` and then fails with `DB_BLOCKED_MESSAGE` instead of hanging forever, and a `VersionError` (this build is older than the stored DB — usually a tab served the previous build from the service worker cache) becomes `DB_OUTDATED_MESSAGE` asking for a reload. Each opened connection closes itself on `versionchange` so one tab cannot block the next version. `src/service-worker.js` calls `skipWaiting()`/`clients.claim()` so that reload lands on the new build rather than the stale cached one — the trade-off is that a tab left open on the previous build may fail a lazy chunk import and must be reloaded.
- **Documents** live in IndexedDB (`store.ts`): DB `light-note`, version 3, object stores `documents` and `aiHistory`. `store.ts` owns the schema (so the DB is never opened at two versions) and exports `withStore(storeName, ...)`; the `aiHistory` records themselves are managed by `ai/historyStore.ts`. `normalizeDocument` migrates older records (e.g. an `html` field, missing `contentFormat`) into the current `LightNoteDocument` shape on read, so the store tolerates legacy data. `ensureInitialDocument` also migrates a legacy single-doc `auto_saved` localStorage blob into a real document on first load.
- **App state** lives in `localStorage`. Keys in use: `currentDocumentId`, `edited` (last export filename), `shared`/`connected`/`sharedDocuments` (collaboration), `openai` (AI settings), `sidebar` (document list collapsed), and legacy `auto_saved`.
- Saves are **debounced (500ms) and serialized** through a promise chain (`saveQueue`) to avoid overlapping IndexedDB writes.
