# Editor UI

The parts of `editor.svelte` (and its stylesheet) whose current shape exists for
a reason. Runtime structure is in [architecture.md](architecture.md).

## Document title

The title is **one piece of state**, `documentTitle` in `editor.svelte`. The Notion-style title block above the editor binds it and the sidebar card renders it for the active document, so editing either place updates the other with no copying — do not introduce a second title variable to "sync". Saving goes through the existing `scheduleCurrentDocumentSave(true)` / `flushCurrentDocument` path, and the AI rename path assigns the same variable.

Blank titles are the subtle part. The store normalizes `''` (and whitespace) to `UNTITLED_TITLE`, so only the **editable field** keeps the raw value — replacing a cleared field with text while the user is editing it is worse than an empty field with a placeholder. Everything that displays or reports the title reads `effectiveDocumentTitle` instead (the sidebar card, the shared-session header, and `getCurrentDocumentTitle` for the agent), and `queueDocumentSave` falls back to the store's normalized title when the local one is blank — otherwise leaving a document would park a nameless card in the list until reload.

Title and body edits **share one debounce timer**, so a body edit restarts the timer that a title edit was waiting on. `titleDirty` is what keeps the title in the eventual write; without it a keystroke in the body a moment after renaming would queue a content-only save and drop the new name until the next blur.

Two layout details keep the title aligned with the text under it:

- `documentColumnClass` (`editor/constants.ts`) is shared by the title block's `class` and the editor body's Tiptap `editorProps` class. They are styled in different files, so a copied value would drift and the title would sit off-centre from its own paragraphs.
- The top clearance for the fixed nav lives on `.editor-shell` (`pt-16`), not on the editor body, because the title block now occupies that space and sharing mode swaps the field for static text. It is the nav's height and nothing else: the document list no longer takes a strip below it (see [Document list](#document-list)).
- **One mechanism owns horizontal placement**: `.editor-shell` padding. The shell clears the docked document list (`padding-left: 18rem`, from `lg` and only while `.sidebar-open`) and the AI panel (`padding-right`), while the column inside it only centres itself. Do not reintroduce a margin on `.tiptap`/`.document-title` for either offset — that split is what made closing the panel throw the text far right and snap back: the margin override disappeared with the class while the shell's padding was still animating through its 180ms transition, so the two offsets briefly stacked.

Both editable titles (the block above the editor and the sidebar card) are **auto-growing textareas, not inputs**, so a long title wraps instead of scrolling sideways. That costs three things a single-line input gave for free: `handleTitleInput` folds pasted newlines back into spaces, Enter is intercepted (the block moves focus to the body, the card commits) so it cannot insert a line break, and the height has to be recomputed whenever the value or the column width changes — hence the reactive `refreshDocumentTitleHeight` for the value and a `ResizeObserver` for the width, which the AI panel's animated padding changes continuously. The observer watches the field it resizes, so the width guard is what stops it feeding back on itself.

In sharing mode there is no local document row to rename, so the block shows the workspace name as static text.

## Document list

The list of documents is a **panel that slides in from the left**, mirroring the AI panel on the right: the same 180ms, a `fly` transition, and `{#if}` rather than a hidden-but-present element, so nothing off-screen stays focusable. `PanelLeft` in the nav toggles it, and the panel has a close button of its own — below `lg` the nav sits behind the panel's scrim, so that button (or Escape, or a tap on the scrim, or picking a document) is the only way back out.

The breakpoint changes what the panel _is_, and that is the thing to keep straight:

- From `lg` it is **docked**: 18rem beside the text, and the nav (`left`/`width`) and `.editor-shell` (`padding-left`) both give that width back when it closes. Those two offsets animate on the same 180ms as the slide, which is why the nav's offset moved out of Tailwind (`lg:left-72`) and into `.editor-nav` in `styles.scss` — a class that appears and disappears cannot be transitioned.
- Below `lg` it **overlays** the note, at `w-72 max-w-[85vw]` with a scrim. Nothing clears it, so the shell keeps only the nav's `pt-16`. This is what replaced the horizontal strip of fixed-width cards that used to sit under the nav on phones, and it is why the cards no longer need `w-48`/`line-clamp-2`: every card is a full-width row at every width now.

Remembering the open state is only half of it: the app must also **look like it was open all along**. The editor mounts after the first paint, so a remembered-open list that animated in — the panel flying from the left, the text column's padding sliding to 18rem — read as the list opening by itself a beat after the page appeared. `uiReady` (`editor.svelte`) gates both: the `fly` gets `duration: 0` and `.editor-shell` gets its `transition` only from the `.ui-ready` class, and it is set two animation frames after the editor mounts. Two frames, because `tick` only flushes the DOM — a class added in the same frame as the layout it describes still transitions from the old value. The shell also takes `sidebar-open` from `sidebarOpen && Boolean(editor)`, so the text is not offset for a list that has not rendered yet.

Cards are **reordered by dragging**, and the list rearranges live under the pointer rather than showing an insertion marker that predicts where the card will land. `documentsBeforeDrag` holds the order to restore, because `dragend` fires whether the drag was dropped or abandoned — a drop clears it first, and that is what tells the two apart. The drop itself is taken on the **list container**, not on a card, so releasing in the gap between two cards or in the empty space below them still commits. Nothing is written until then. Two details that are easy to lose: `draggable` is dropped while a card's title is being edited (a draggable ancestor stops text selection inside the field), and `dataTransfer.setData` is called on `dragstart` because Firefox starts no drag without a payload.

Dragging is unreachable from the keyboard, and HTML5 drag events do not fire for touch, so **Alt+Arrow on a focused card moves it** as well. That is the whole of the touch story at the moment: reordering on a phone needs a pointer-event implementation that does not exist yet.

`readSidebarOpen`/`writeSidebarOpen` (`editor/editor.ts`, key `sidebar`) remember **only the docked state**. An overlay always starts closed, or reopening the app would hide the document the user came back to read, and toggling on a phone must not overwrite the desktop preference. Crossing the breakpoint re-reads the preference rather than carrying the current state across, so a docked list dragged down to phone width does not end up parked on top of the note.

## Toolbar and bubble menus

`editor/toolbar.ts` holds the toolbar data model: a group is a list of **nodes**, each either an item (a button) or a menu (a dropdown of items). One description renders three ways — the desktop bar, the dropdown contents, and the compact mobile row plus its overflow sheet — and `flattenGroup` is what lets the mobile sheet show every action as a plain button, so **an action placed in a menu is never lost on mobile**. `collectPrimaryItems` picks the `primary` items for the mobile row and looks inside menus too (Heading 2 lives in the block-style menu but stays on the mobile row).

Menus exist to keep the bar short. Only menus of mutually exclusive states set `reflectActive`, which mirrors the active item onto the trigger so the bar still says which block style or alignment is on; on the Insert menu that would relabel the trigger just because the cursor sits in a link. `reflectActive` shows the **first** active item, so the items it picks from must be mutually exclusive in practice: a blockquote wraps a paragraph and Tiptap reports both as active, which is why the paragraph entry is only active when no wrapper style claims the block. The AI button and the utility menu (download/import/share/AI settings/theme) are pinned to the bar's right edge with `ml-auto`, so their position does not depend on how wide the editing groups are.

`buildToolbarGroups` takes **every piece of state the bar reflects as a parameter** (`aiPanelOpen` among them). The `$: toolbarGroups = ...` statement only re-runs on what it passes in, so a value read from the component scope inside the function renders once and then goes stale — the AI button kept saying "Show" with the panel open.

The two side panels are opened by **one control each, at opposite edges of the nav, with the same grammar**: it toggles, its label follows the state (`Show`/`Hide`), and it is `active` while the panel is open. The icons stay different because they name different things (`PanelLeft` for the list, `Sparkles` for AI); only the behaviour is shared. There is deliberately **no floating button** for either — the AI panel used to have a bottom-right "Ask AI" pill, a second entry point in a third shape, covering the text it writes into.

There are **two bubble menus**, each a `BubbleMenu` instance with its own extension name and plugin key (`tableBubbleMenu` is `BubbleMenu.extend({ name })`, since duplicate extension names are rejected). Their `shouldShow` rules partition the cases rather than overlapping: the format menu keeps Tiptap's default rule (focused, editable, a selection that is not an empty text block) **minus cell selections** (via `isCellSelection`, not a range count), and the table menu shows for a plain cursor or a cell selection inside a table — a cursor is enough because the row/column tools act on the cell it sits in. Table tools deliberately do not live in the toolbar: as a conditional toolbar group they shifted every button to their right the moment the cursor entered a cell.

## Dialogs and toasts

The app asks and reports through its own UI: there is **no `window.alert`, `confirm`, or `prompt` left**. The split is by who is waiting.

- **A dialog** when the app needs an answer before it can go on, or when the message is attached to something the user has to fix: `PromptDialog` (a value), `ConfirmDialog` (a decision).
- **A toast** when something happened that the user did not ask about at that moment and cannot correct in place — a failed save, a database that another tab is holding open. Top right, from `svelte-sonner` (see [architecture.md](architecture.md#ui-components)).

The rule that matters: **a validation error is never a toast.** The native prompt closed on submit, so the alert that followed had nothing left to correct and the typed value was gone. `PromptDialog`'s `submit` returns the message to show and the dialog stays open on the text, which is the whole reason it exists.

`URL_INSERTS`/`checkUrlInsert`/`applyUrlInsert` (`editor/editor.ts`) drive the link, image, and YouTube prompts. The protocol allowlist is per kind and lives on the spec (a `javascript:` URL must never reach `setLink`, and `data:` renders an image but is not a page or a video); the link dialog opens on `currentLinkUrl`, so editing a link is not retyping it; and submitting an empty box is a real action for links only — it removes the link, which is why `checkUrlInsert` answers `clear` there and `invalid` for the other two. The download dialog reuses the same component with `suggestedDownloadName` and `normalizeDownloadName`.

`askConfirm` returns a promise so a call site still reads like the `window.confirm` it replaced. Two things keep it honest: **dismissing counts as "no"** (`ConfirmDialog`'s `onOpenChange` answers on Escape and on the overlay, not just the Cancel button), and a second question **answers the first one "no" before replacing it** — otherwise its caller would await a dialog that is no longer on screen. Both dialogs' open state is the request object itself, so there is no open flag that can disagree with the content, and both join `handleSidebarKeydown`'s Escape guard so closing one does not also close the document list underneath it.

One case needs more than a toast call: **a message about a page that is about to be replaced**. A failed share ends in `location.replace`, which takes any toast with it, so `stashStartupNotice`/`takeStartupNotice` hand the message through `sessionStorage` and the next mount shows it. Session-scoped and cleared on read, so it appears exactly once and cannot greet the user tomorrow. The old `alert('Disconnecting...')` was deleted rather than converted: it only ever mattered because it blocked, and the reload is the feedback.

## Tables

Tables are Tiptap's `Table`/`TableRow`/`TableHeader`/`TableCell` (resizable columns), registered in `getExtensions()` so both normal and sharing mode get them. `insertTable` in `editor/editor.ts` owns the default shape (`DEFAULT_TABLE_SIZE`, 3×3 with a header row), and the row/column/header/merge tools live in the **table bubble menu**, not the toolbar (see [Toolbar and bubble menus](#toolbar-and-bubble-menus)).

Table CSS lives in **two places that must stay in sync**: `editor/styles.scss` for the editor (including the `.selectedCell`/`.column-resize-handle` elements prosemirror-tables injects, and the `.resize-cursor` class its column-resizing plugin puts on the editor element itself, which is why that rule sits outside the `.tiptap` block) and the `htmlStyle` stylesheet in `editor/constants.ts` for exported/downloaded HTML. A table that looks right in the editor but unstyled in the export means only the first was updated. The two deliberately differ on one point: the editor uses `table-layout: fixed` because resizing needs the colgroup widths, while the export omits it, since `getHTML` does not emit those widths and content-sized columns read better without them.

A table cell selection is a `CellSelection`. `captureSelection` treats it as _no_ selection and `insertAtCursor` refuses it, because its `from`/`to` span the table structure between the selected cells, so writing over that range would delete rows and cells. Detection goes through `isCellSelection` in `editor/editor.ts` (an `instanceof CellSelection` check, shared with the bubble menus): **counting `ranges` does not work** — a single-cell selection has exactly one range, just like a text selection.
