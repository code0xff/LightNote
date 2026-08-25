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

`readSidebarOpen`/`writeSidebarOpen` (`editor/editor.ts`, key `sidebar`) remember **only the docked state**. An overlay always starts closed, or reopening the app would hide the document the user came back to read, and toggling on a phone must not overwrite the desktop preference. Crossing the breakpoint re-reads the preference rather than carrying the current state across, so a docked list dragged down to phone width does not end up parked on top of the note.

## Toolbar and bubble menus

`editor/toolbar.ts` holds the toolbar data model: a group is a list of **nodes**, each either an item (a button) or a menu (a dropdown of items). One description renders three ways — the desktop bar, the dropdown contents, and the compact mobile row plus its overflow sheet — and `flattenGroup` is what lets the mobile sheet show every action as a plain button, so **an action placed in a menu is never lost on mobile**. `collectPrimaryItems` picks the `primary` items for the mobile row and looks inside menus too (Heading 2 lives in the block-style menu but stays on the mobile row).

Menus exist to keep the bar short. Only menus of mutually exclusive states set `reflectActive`, which mirrors the active item onto the trigger so the bar still says which block style or alignment is on; on the Insert menu that would relabel the trigger just because the cursor sits in a link. `reflectActive` shows the **first** active item, so the items it picks from must be mutually exclusive in practice: a blockquote wraps a paragraph and Tiptap reports both as active, which is why the paragraph entry is only active when no wrapper style claims the block. The AI button and the utility menu (download/import/share/AI settings/theme) are pinned to the bar's right edge with `ml-auto`, so their position does not depend on how wide the editing groups are.

There are **two bubble menus**, each a `BubbleMenu` instance with its own extension name and plugin key (`tableBubbleMenu` is `BubbleMenu.extend({ name })`, since duplicate extension names are rejected). Their `shouldShow` rules partition the cases rather than overlapping: the format menu keeps Tiptap's default rule (focused, editable, a selection that is not an empty text block) **minus cell selections** (via `isCellSelection`, not a range count), and the table menu shows for a plain cursor or a cell selection inside a table — a cursor is enough because the row/column tools act on the cell it sits in. Table tools deliberately do not live in the toolbar: as a conditional toolbar group they shifted every button to their right the moment the cursor entered a cell.

## Tables

Tables are Tiptap's `Table`/`TableRow`/`TableHeader`/`TableCell` (resizable columns), registered in `getExtensions()` so both normal and sharing mode get them. `insertTable` in `editor/editor.ts` owns the default shape (`DEFAULT_TABLE_SIZE`, 3×3 with a header row), and the row/column/header/merge tools live in the **table bubble menu**, not the toolbar (see [Toolbar and bubble menus](#toolbar-and-bubble-menus)).

Table CSS lives in **two places that must stay in sync**: `editor/styles.scss` for the editor (including the `.selectedCell`/`.column-resize-handle` elements prosemirror-tables injects, and the `.resize-cursor` class its column-resizing plugin puts on the editor element itself, which is why that rule sits outside the `.tiptap` block) and the `htmlStyle` stylesheet in `editor/constants.ts` for exported/downloaded HTML. A table that looks right in the editor but unstyled in the export means only the first was updated. The two deliberately differ on one point: the editor uses `table-layout: fixed` because resizing needs the colgroup widths, while the export omits it, since `getHTML` does not emit those widths and content-sized columns read better without them.

A table cell selection is a `CellSelection`. `captureSelection` treats it as _no_ selection and `insertAtCursor` refuses it, because its `from`/`to` span the table structure between the selected cells, so writing over that range would delete rows and cells. Detection goes through `isCellSelection` in `editor/editor.ts` (an `instanceof CellSelection` check, shared with the bubble menus): **counting `ranges` does not work** — a single-cell selection has exactly one range, just like a text selection.
