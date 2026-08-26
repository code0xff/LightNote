# AGENTS.md

Instructions for any coding agent working in this repository. `CLAUDE.md` is a
symlink to this file, so Claude Code and other agents read the same thing.

**This file holds the project's premises only.** It changes when a premise
changes — not when a feature does. Everything that describes how the current
code works belongs in `docs/`, and is indexed at the bottom of this file.

## Premises

- LightNote is an **offline-first, client-only** note editor. There is **no backend**: SvelteKit is used with `adapter-static` and `prerender = true` to produce a static site deployed to GitHub Pages, and all persistence is in the browser.
- Any "server" interaction (collaboration relay, OpenAI) talks **directly from the browser** to an endpoint the user supplies. Keys and endpoints are the user's, stored locally, and never proxied through anything of ours.
- **The editor is the app.** `src/lib/editor/editor.svelte` is one large stateful component holding the toolbar, document list, bubble menus, dialogs, and the Tiptap instance; `src/routes/+page.svelte` just renders it.
- **Logic in `.ts`, UI in `.svelte`.** Testable logic is extracted into plain `.ts` modules with colocated `*.test.ts`; `.svelte` components are not unit-tested. Anything that touches storage or time takes it as an argument so tests can pass a fake.
- **Reuse the UI wrappers** in `src/lib/components/ui/` (shadcn-style over `bits-ui`) rather than raw elements; icons come from `lucide-svelte`.
- The site is served from the GitHub Pages subpath `/LightNote`, so nothing may hardcode a root-relative path.

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
2. **Implement** — make the change, keeping the logic-in-`.ts` / UI-in-`.svelte` premise above.
3. **Codex review** — have Codex review the change (via the `codex` plugin, e.g. the `codex:rescue` skill) before it lands.
4. **Commit & push** — only after the review and the checks above pass. Commit and push are done when the user asks.

`dev` is the default branch — there is no `master`. `origin/dev` also receives commits from the user's other machines and sessions: `git fetch` before starting and again before committing, and rebase rather than force-push if it moved. Deploys are cut from `dev`; `npm run deploy` publishes the build to the `gh-pages` branch, which is what GitHub Pages serves.

Commit messages **must** use the `type: message` format (e.g. `feat: add AI writing`, `fix: ...`, `docs: ...`, `refactor: ...`, `style: ...`, `chore: ...`, `test: ...`).

## Documenting your work

When a change makes one of the docs below wrong, update that doc in the same
commit. Write down **why** the code is shaped the way it is — the failure a rule
prevents, the trade-off taken — not what the code plainly says. Leave this file
alone unless the change moves one of the premises above.

A new area of the codebase gets a new file in `docs/` plus one row here.

## Docs

| Doc                                          | What it covers                                                                             | Read it when                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md) | Runtime modes (normal vs. sharing), the UI component layer, build/bundle and path settings | Wiring anything new into the app, or touching the build           |
| [docs/editor-ui.md](docs/editor-ui.md)       | Document title, the sliding document list, toolbar and bubble menus, tables                | Changing layout or chrome around the editor                       |
| [docs/persistence.md](docs/persistence.md)   | IndexedDB schema and upgrade failure modes, `localStorage` keys, debounced saves           | Storing anything, or changing what a document is                  |
| [docs/ai.md](docs/ai.md)                     | One-shot actions, the agent loop and its tools, per-document AI history                    | Touching `src/lib/ai/**` or the AI panel                          |
| [docs/testing.md](docs/testing.md)           | Which module owns which logic, and the injection points tests rely on                      | Adding a feature — decide where the logic lives before writing it |
