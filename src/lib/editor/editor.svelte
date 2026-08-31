<script lang="ts">
	import './styles.scss';

	import { Editor, type Extensions, type JSONContent } from '@tiptap/core';
	import { onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { Button } from '@/lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';
	import {
		AlignCenter,
		AlignLeft,
		AlignRight,
		BetweenHorizontalEnd,
		BetweenVerticalEnd,
		Bold,
		BookPlus,
		Braces,
		Code,
		FileUp,
		Copy,
		FoldHorizontal,
		FoldVertical,
		GripVertical,
		Heading1,
		Heading2,
		Heading3,
		ImagePlus,
		Italic,
		Link2,
		Link2Off,
		List,
		ListOrdered,
		Merge,
		MoreHorizontal,
		PanelLeft,
		PanelLeftClose,
		PanelTop,
		Pencil,
		Pilcrow,
		Plus,
		Redo,
		FileDown,
		Settings2,
		Sparkles,
		Trash2,
		SeparatorHorizontal,
		Strikethrough,
		SunMoon,
		Table,
		TextQuote,
		Undo,
		ScreenShare,
		ScreenShareOff,
		MonitorPlay,
		Underline
	} from 'lucide-svelte';
	import {
		applyUrlInsert,
		buildShareUrl,
		checkUrlInsert,
		currentLinkUrl,
		download,
		normalizeDownloadName,
		DEFAULT_TABLE_SIZE,
		DOCKED_SIDEBAR_QUERY,
		endSharing,
		formatPageTitle,
		insertTable,
		isCellSelection,
		readUploadedDocument,
		readSharedDocumentHistory,
		readSharedMetadata,
		readSidebarOpen,
		removeSharedDocumentHistory,
		SHARE_CONNECT_TIMEOUT_MS,
		SHARE_SOCKET_OPTIONS,
		SHARE_STATUS_LABELS,
		type ShareStatus,
		sharedCopyTitle,
		nextShareStatus,
		stashStartupNotice,
		startSharing,
		suggestedDownloadName,
		takeStartupNotice,
		upsertSharedDocumentHistory,
		type SharedDocumentReference,
		URL_INSERTS,
		type UrlInsertKind,
		validateShareMetadata,
		writeSidebarOpen
	} from './editor';
	import {
		createDocument,
		DB_BLOCKED_MESSAGE,
		DB_OUTDATED_MESSAGE,
		deleteDocument,
		ensureInitialDocument,
		getDocument,
		listDocuments,
		moveDocumentTo,
		reorderDocuments,
		setStoredCurrentDocumentId,
		UNTITLED_TITLE,
		updateDocument,
		type LightNoteDocument
	} from '$lib/documents/store';
	import { edgeScrollStep, hasDragStarted } from './dragging';
	import { getExtensions } from './extensions';
	import { documentColumnClass } from './constants';
	import {
		DEFAULT_OPENAI_MODEL,
		generateText,
		readOpenAiSettings,
		toEditorHtml,
		toInlineEditorHtml,
		writeOpenAiSettings,
		type AiAction,
		type OpenAiSettings
	} from '$lib/ai/openai';
	import { checkAgentRequest, checkAiRequest } from '$lib/ai/actions';
	import { findExactTextRanges } from '$lib/ai/selection';
	import { runAgent, type AgentEvent, type AgentStep, type ApprovalRequest } from '$lib/ai/agent';
	import type { ChatMessage } from '$lib/ai/openai';
	import { createDocumentToolExecutor } from '$lib/ai/documentTools';
	import { toolCallPreview } from '$lib/ai/tools';
	import {
		appendAiHistory,
		buildHistoryEntry,
		clearAiHistory,
		deleteAiHistoryEntry,
		documentHistoryKey,
		listAiHistory,
		sharedHistoryKey,
		type AiHistoryEntry,
		type AiHistoryInput
	} from '$lib/ai/historyStore';
	import AiSettingsDialog from './AiSettingsDialog.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import PromptDialog from './PromptDialog.svelte';
	import { describeError } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import AiPromptPanel from './AiPromptPanel.svelte';
	import ToolbarButton from './ToolbarButton.svelte';
	import ToolbarMenu from './ToolbarMenu.svelte';
	import {
		collectPrimaryItems,
		flattenGroup,
		toolbarItem,
		toolbarMenu,
		type ToolbarGroup,
		type ToolbarItem
	} from './toolbar';
	import type { HocuspocusProvider } from '@hocuspocus/provider';
	import * as Dialog from '@/lib/components/ui/dialog';
	import * as Popover from '@/lib/components/ui/popover';
	import { buttonVariants } from '@/lib/components/ui/button';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: HTMLElement;
	let tableBubbleMenu: HTMLElement;
	let files: FileList | undefined;
	let content: string | JSONContent = '';
	let documents: LightNoteDocument[] = [];
	let sharedDocuments: SharedDocumentReference[] = [];
	let currentDocument: LightNoteDocument | null = null;
	let documentTitle = 'Untitled';
	let provider: HocuspocusProvider | undefined;
	let _endpoint = '';
	let _workspace = '';
	let isSharingMode = false;
	let shareStatus: ShareStatus = 'connecting';
	/**
	 * Once true it stays true for the session: it is what separates an address
	 * that never answered from a session whose content is in this page.
	 */
	let shareHasConnected = false;
	/** The standing "connection lost" toast, so a flapping link cannot stack them. */
	let reconnectToastId: string | number | undefined;
	let shareConnectTimer: number | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveQueue: Promise<void> = Promise.resolve();
	/** A title edit is waiting on the shared save timer. */
	let titleDirty = false;
	let editingTitleDocumentId: string | null = null;
	let documentTitleField: HTMLTextAreaElement | undefined;
	let shareDialogOpen = false;
	/**
	 * What the prompt dialog is asking for, or null while it is closed. `submit`
	 * returns the message to show when the answer is refused, so a rejected value
	 * keeps the dialog open on the text that has to be fixed.
	 */
	let promptRequest: {
		title: string;
		description: string;
		label: string;
		placeholder: string;
		submitLabel: string;
		submit: (value: string) => string | null;
	} | null = null;
	let promptValue = '';
	let promptError = '';
	/** The pending question, with the resolver the caller is waiting on. */
	let confirmRequest: {
		title: string;
		description: string;
		confirmLabel: string;
		cancelLabel: string;
		destructive: boolean;
		resolve: (confirmed: boolean) => void;
	} | null = null;
	let toolbarOverflowOpen = false;

	/**
	 * The document list is docked beside the text from `lg` up and slides over it
	 * below that, so the same open state means two different things: a docked list
	 * pushes the text aside, an overlaid one hides it. Only the docked state is
	 * remembered, and the overlay always starts closed.
	 */
	let sidebarDocked = false;
	let sidebarOpen = false;
	/**
	 * False until the app has painted once. The editor mounts after the first
	 * paint, so a remembered-open list would animate itself in a beat after the
	 * page appeared — it read as the list opening on its own rather than as
	 * having been open all along. Everything that animates the list's width is
	 * gated on this, and only user toggles are animated.
	 */
	let uiReady = false;

	let aiSettings: OpenAiSettings = { apiKey: '', model: DEFAULT_OPENAI_MODEL };
	let aiSettingsOpen = false;
	let aiApiKeyInput = '';
	let aiModelInput = DEFAULT_OPENAI_MODEL;
	let aiOpen = false;
	let aiSelection = '';
	/** The captured range's text before trimming, for the validity check. */
	let aiSelectionExact = '';
	let aiSelectionRange: { from: number; to: number } | null = null;
	let aiPrompt = '';
	let aiError = '';
	let aiBusy = false;
	let aiController: AbortController | undefined;
	let aiSteps: AgentStep[] = [];
	let aiAgentText = '';
	let aiAutoApprove = false;
	let aiAllowDocumentWideEdits = false;
	let aiPendingApproval: {
		description: string;
		preview: string;
		resolve: (approved: boolean) => void;
	} | null = null;
	let aiHistory: AiHistoryEntry[] = [];
	/** Instruction of the run in flight; the textarea is cleared on send. */
	let aiRunPrompt = '';
	/** The one-shot action in flight, if the run is one; null for an agent run. */
	let aiRunAction: AiAction | null = null;
	/**
	 * Identifies the in-flight request. Cancelling starts a new id so a superseded
	 * run can no longer touch shared panel state (busy flag, controller, steps).
	 */
	let aiRunId = 0;
	/** Documents deleted this session: their history must not be recreated. */
	const deletedHistoryKeys = new Set<string>();
	/**
	 * Transcript of a run that stopped early, so Continue can resume it instead of
	 * starting over and redoing the work already recorded in it.
	 */
	let aiResume: {
		messages: ChatMessage[];
		reason: 'max-steps' | 'stalled';
		allowDocumentWideEdits: boolean;
		/**
		 * The scope the stopped run was given. Replacing the selection clears it, so
		 * recomputing this on Continue would widen a selection-scoped run into a
		 * document-wide one — with a transcript that still says the selection was the
		 * only editable scope.
		 */
		selectionOnly: boolean;
		/**
		 * The scope's target, not just its flag. Reopening the panel recaptures
		 * whatever is selected now, so a continuation that read live state could point
		 * a selection-scoped run at newly selected, unrelated text — and session
		 * auto-approve would apply it without asking again.
		 */
		selection: string;
		selectionExact: string;
		selectionRange: { from: number; to: number } | null;
	} | null = null;

	$: aiHasApiKey = Boolean(aiSettings.apiKey);

	let title: string = 'LightNote';

	/**
	 * What the title *means* when it is blank or only whitespace: the store
	 * normalizes those to `Untitled`, so anything that displays or reports the
	 * title has to agree with the store. The input itself keeps the raw value —
	 * replacing a cleared field with text while the user edits it is worse than
	 * an empty field with a placeholder.
	 */
	$: effectiveDocumentTitle = isSharingMode
		? _workspace.trim() || 'Shared document'
		: documentTitle.trim() || UNTITLED_TITLE;

	function formatUpdatedAt(value: number) {
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(value);
	}

	function handleTitleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			// The field is a textarea so a long title can wrap instead of scrolling
			// sideways; Enter still commits rather than inserting a line break.
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement | null)?.blur();
		}
	}

	/** Grows a title field to its wrapped height instead of scrolling it. */
	function resizeTitleField(field: HTMLTextAreaElement) {
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	/**
	 * The title above the editor and the sidebar card edit the same
	 * `documentTitle`, so the two stay in sync in both directions without any
	 * copying, and one handler serves both fields.
	 */
	function handleTitleInput(event: Event) {
		const field = event.currentTarget as HTMLTextAreaElement;

		// A pasted title can carry newlines, which a textarea keeps and the
		// single-line input it replaced could not produce. A title is one line.
		if (field.value.includes('\n')) {
			field.value = field.value.replace(/\s*\n+\s*/g, ' ');
			documentTitle = field.value;
		}

		resizeTitleField(field);
		title = formatPageTitle(documentTitle);
		scheduleCurrentDocumentSave(true);
	}

	/**
	 * Opening a document (or an agent rename) assigns `documentTitle` without an
	 * input event, so the field would keep the height the previous title needed.
	 * `tick` waits for the new value to reach the DOM before it is measured.
	 */
	async function refreshDocumentTitleHeight() {
		await tick();

		if (documentTitleField) {
			resizeTitleField(documentTitleField);
		}
	}

	$: documentTitle, void refreshDocumentTitleHeight();

	async function focusDocumentTitle() {
		if (isSharingMode) {
			return;
		}

		await tick();

		const field = window.document.getElementById(
			'editor-document-title'
		) as HTMLTextAreaElement | null;

		if (field) {
			resizeTitleField(field);
			field.focus();
			field.select();
		}
	}

	function handleDocumentTitleKeydown(event: KeyboardEvent) {
		// Enter belongs to the body: a title is one line, and dropping into the
		// text is what the key does everywhere else in a document editor.
		if (event.key === 'Enter') {
			event.preventDefault();
			editor?.commands.focus('start');
			return;
		}

		if (event.key === 'Escape') {
			(event.currentTarget as HTMLTextAreaElement | null)?.blur();
		}
	}

	async function startTitleEditing(documentToEdit: LightNoteDocument) {
		if (documentToEdit.id !== currentDocument?.id) {
			return;
		}

		editingTitleDocumentId = documentToEdit.id;
		await tick();

		const field = window.document.getElementById(
			`document-title-${documentToEdit.id}`
		) as HTMLTextAreaElement | null;

		if (field) {
			resizeTitleField(field);
			field.focus();
			field.select();
		}
	}

	async function finishTitleEditing() {
		if (!editingTitleDocumentId) {
			return;
		}

		editingTitleDocumentId = null;
		await flushCurrentDocument();
	}

	function scheduleCurrentDocumentSave(saveTitle = false) {
		if (isSharingMode || !currentDocument || !editor) {
			return;
		}

		if (saveTimer) {
			clearTimeout(saveTimer);
		}

		if (saveTitle) {
			titleDirty = true;
		}

		const documentId = currentDocument.id;
		const content = editor.getJSON();

		saveTimer = setTimeout(() => {
			// Title and body share this timer, so an edit in the body restarts it.
			// The dirty flag is what stops that from dropping a title the user
			// typed less than a debounce ago; reading it here also picks up
			// whatever they typed since.
			const nextTitle = titleDirty ? documentTitle : undefined;

			titleDirty = false;
			void queueDocumentSave(documentId, content, nextTitle);
		}, 500);
	}

	function queueDocumentSave(
		documentId: string,
		content: LightNoteDocument['content'],
		nextTitle?: string
	) {
		saveQueue = saveQueue.then(async () => {
			try {
				const updated = await updateDocument(documentId, {
					content,
					contentFormat: 'tiptap-json',
					...(nextTitle === undefined ? {} : { title: nextTitle })
				});

				// Keep the title the user is typing rather than the value this
				// (possibly already stale) write returned — except when theirs is
				// blank, where `updated.title` carries the store's `Untitled` and
				// overriding it would leave a nameless card behind in the list.
				const savedTitle = documentTitle.trim() ? documentTitle : updated.title;

				if (currentDocument?.id === documentId) {
					currentDocument = {
						...updated,
						title: savedTitle
					};
					title = formatPageTitle(savedTitle);
				}

				documents = documents.map((document) =>
					document.id === documentId
						? {
								...updated,
								title: currentDocument?.id === documentId ? savedTitle : updated.title
							}
						: document
				);
			} catch (error) {
				console.error(error);
			}
		});

		return saveQueue;
	}

	async function flushCurrentDocument() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = undefined;
		}

		// A flush always writes the title, so nothing is left pending.
		titleDirty = false;

		if (!isSharingMode && currentDocument && editor) {
			await queueDocumentSave(currentDocument.id, editor.getJSON(), documentTitle);
		}
	}

	function setActiveDocument(document: LightNoteDocument) {
		currentDocument = document;
		documentTitle = document.title;
		title = formatPageTitle(document.title);
		setStoredCurrentDocumentId(document.id);
		// Positions captured for the AI panel belong to the document being left,
		// so they must not be reused against the incoming one.
		clearAiSelection();
		void loadAiHistory();

		if (editor) {
			editor.commands.setContent(document.content, false);
			editor.commands.focus();
		}
	}

	async function refreshDocuments() {
		documents = await listDocuments();
	}

	/**
	 * The list is reordered live as the pointer moves, so the cards show the
	 * result instead of an insertion marker predicting it. Nothing is written
	 * until the pointer is released, and this holds the order to put back if the
	 * drag is cancelled instead.
	 */
	let documentsBeforeDrag: LightNoteDocument[] | null = null;
	let draggingDocumentId: string | null = null;
	/** The scroll container, so a drag at its edge can scroll it. */
	let documentListElement: HTMLElement | undefined;
	/** Set on press, promoted to `draggingDocumentId` once the pointer travels. */
	let dragCandidateId: string | null = null;
	let dragPointerId: number | null = null;
	let dragOrigin: { x: number; y: number } | null = null;
	let dragPoint = { x: 0, y: 0 };
	let edgeScrollFrame: number | undefined;
	/**
	 * A drag ends in a click on whatever the pointer was captured by. Without
	 * this, letting go of a card would also open the document it was dropped on.
	 */
	let dragSuppressesClick = false;

	/**
	 * Touch drags start on the grip only: a finger dragging a card is the same
	 * gesture as scrolling the list, and the list has to keep scrolling. A mouse
	 * has no such conflict, so it can take hold of the whole card.
	 */
	function pressDocument(event: PointerEvent, id: string, fromGrip: boolean) {
		const mouse = event.pointerType === 'mouse';

		dragSuppressesClick = false;

		if ((mouse && event.button !== 0) || (!fromGrip && !mouse)) {
			return;
		}

		// The title field owns its own pointer while it is open.
		if (editingTitleDocumentId === id) {
			return;
		}

		dragCandidateId = id;
		dragPointerId = event.pointerId;
		dragOrigin = { x: event.clientX, y: event.clientY };
		dragPoint = { x: event.clientX, y: event.clientY };
	}

	/**
	 * Tracked on `window` rather than on the card, and without `setPointerCapture`.
	 * Reordering moves the dragged card in the DOM, which loses a capture held by
	 * that card — the first version did exactly that, and the drop it never saw
	 * left the new order on screen but unsaved.
	 */
	function dragDocument(event: PointerEvent) {
		if (dragPointerId !== event.pointerId) {
			return;
		}

		dragPoint = { x: event.clientX, y: event.clientY };

		if (!draggingDocumentId) {
			if (!dragCandidateId || !dragOrigin || !hasDragStarted(dragOrigin, dragPoint)) {
				return;
			}

			draggingDocumentId = dragCandidateId;
			documentsBeforeDrag = documents;
			startEdgeScroll();
		}

		// A captured touch would otherwise still scroll the panel behind the list.
		event.preventDefault();
		reorderToPointer();
	}

	function releaseDocument(event: PointerEvent) {
		if (dragPointerId !== event.pointerId) {
			return;
		}

		if (draggingDocumentId) {
			// Clearing this first is what tells a cancel from a completed move.
			documentsBeforeDrag = null;
			dragSuppressesClick = true;
			void persistDocumentOrder();
		}

		endDocumentDrag();
	}

	function endDocumentDrag() {
		if (documentsBeforeDrag) {
			documents = documentsBeforeDrag;
			documentsBeforeDrag = null;
		}

		draggingDocumentId = null;
		dragCandidateId = null;
		dragPointerId = null;
		dragOrigin = null;
		stopEdgeScroll();
	}

	/** Moves the dragged card to whichever card the pointer is over. */
	function reorderToPointer() {
		if (!draggingDocumentId) {
			return;
		}

		const target = window.document
			.elementFromPoint(dragPoint.x, dragPoint.y)
			?.closest('[data-document-index]');

		if (!target) {
			return;
		}

		documents = moveDocumentTo(
			documents,
			draggingDocumentId,
			Number(target.getAttribute('data-document-index'))
		);
	}

	/**
	 * A dragging finger cannot also scroll, so the list scrolls itself while the
	 * pointer rests near an edge. On a frame loop rather than on pointer moves: a
	 * finger held still at the edge sends no events and would sit there forever.
	 */
	function startEdgeScroll() {
		const step = () => {
			if (!draggingDocumentId || !documentListElement) {
				edgeScrollFrame = undefined;
				return;
			}

			const bounds = documentListElement.getBoundingClientRect();
			const delta = edgeScrollStep(dragPoint.y, bounds.top, bounds.bottom);

			if (delta !== 0) {
				documentListElement.scrollTop += delta;
				reorderToPointer();
			}

			edgeScrollFrame = requestAnimationFrame(step);
		};

		edgeScrollFrame = requestAnimationFrame(step);
	}

	function stopEdgeScroll() {
		if (edgeScrollFrame !== undefined) {
			cancelAnimationFrame(edgeScrollFrame);
			edgeScrollFrame = undefined;
		}
	}

	/**
	 * Whether the click that just arrived is the tail of a drag. Every button on a
	 * card asks: letting go of a card would otherwise open the document it landed
	 * on, or worse, press the delete button it landed on.
	 */
	function consumeDragClick() {
		if (!dragSuppressesClick) {
			return false;
		}

		dragSuppressesClick = false;

		return true;
	}

	/**
	 * Arrow keys on the grip, which is a reorder control and nothing else. The
	 * drag itself is unreachable from the keyboard.
	 */
	function moveDocumentByKey(event: KeyboardEvent, id: string, index: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
			return;
		}

		event.preventDefault();

		const moved = moveDocumentTo(documents, id, index + (event.key === 'ArrowUp' ? -1 : 1));

		if (moved === documents) {
			return;
		}

		documents = moved;
		void persistDocumentOrder();
	}

	async function persistDocumentOrder() {
		try {
			await reorderDocuments(documents.map((document) => document.id));
		} catch (error) {
			notifyDatabaseProblem(error);
			toast.error(describeError(error, 'Failed to save the new order'));
			console.error(error);
			// Show what storage actually holds rather than an order that did not land.
			await refreshDocuments();
		}
	}

	async function createNewDocument() {
		try {
			await flushCurrentDocument();
			const document = await createDocument({
				title: 'Untitled',
				content: { type: 'doc', content: [{ type: 'paragraph' }] },
				contentFormat: 'tiptap-json'
			});

			await refreshDocuments();
			setActiveDocument(document);
			// A new page is unnamed, so the caret belongs in the title rather than
			// in an empty body the user has nothing to say in yet.
			await focusDocumentTitle();
		} catch (error) {
			toast.error('Failed to create document');
			console.error(error);
		}
	}

	/**
	 * Two frames, not one: `tick` only flushes the DOM, and a class added in the
	 * same frame as the layout it describes still transitions from the old value.
	 * Waiting for a painted frame is what makes the first state instant.
	 */
	async function markUiReady() {
		await tick();

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				uiReady = true;
			});
		});
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
		writeSidebarOpen(localStorage, sidebarDocked, sidebarOpen);
	}

	/**
	 * Picking a document is the end of the list's job. While it is docked that
	 * changes nothing, but an overlaid list is covering the document it just
	 * opened, so it has to get out of the way.
	 */
	function dismissOverlaidSidebar() {
		if (!sidebarDocked) {
			sidebarOpen = false;
		}
	}

	/**
	 * Escape closes the overlaid list wherever focus is — it can be the scrim, a
	 * card, or nothing. A dialog stacked on top answers Escape for itself, so the
	 * list stays put underneath it.
	 */
	function handleSidebarKeydown(event: KeyboardEvent) {
		if (
			event.key !== 'Escape' ||
			shareDialogOpen ||
			aiSettingsOpen ||
			toolbarOverflowOpen ||
			promptRequest !== null ||
			confirmRequest !== null
		) {
			return;
		}

		dismissOverlaidSidebar();
	}

	/**
	 * A stale error is cleared on open rather than on close, because the dialog
	 * can also be dismissed by Escape or by the overlay.
	 */
	function openPrompt(
		request: Omit<NonNullable<typeof promptRequest>, 'submit'>,
		initialValue: string,
		submit: (value: string) => string | null
	) {
		promptValue = initialValue;
		promptError = '';
		promptRequest = { ...request, submit };
	}

	function submitPrompt() {
		if (!promptRequest) {
			return;
		}

		const error = promptRequest.submit(promptValue);

		// Staying open on a refused answer is the point of replacing the native
		// prompt, which closed before its alert could say what was wrong.
		if (error) {
			promptError = error;
			return;
		}

		closePrompt();
	}

	function closePrompt() {
		promptRequest = null;
	}

	/** The link dialog opens on the address already there, so editing is not retyping. */
	function openUrlDialog(kind: UrlInsertKind) {
		openPrompt(
			URL_INSERTS[kind],
			kind === 'link' && editor ? currentLinkUrl(editor) : '',
			(value) => {
				if (!editor) {
					return null;
				}

				const check = checkUrlInsert(kind, value);

				if (check.status === 'invalid') {
					return check.message;
				}

				applyUrlInsert(editor, kind, check.status === 'ok' ? check.url : '');

				return null;
			}
		);
	}

	function openDownloadDialog(activeEditor: Editor, preferredName?: string) {
		openPrompt(
			{
				title: 'Save as HTML',
				description: 'The whole document is written to one file, styles included.',
				label: 'File name',
				placeholder: 'note.html',
				submitLabel: 'Save'
			},
			suggestedDownloadName(preferredName),
			(value) => {
				try {
					download(activeEditor, normalizeDownloadName(value));
				} catch (error) {
					console.error(error);

					return describeError(error, 'Invalid file name');
				}

				return null;
			}
		);
	}

	/**
	 * Asks the question and waits for the answer, the way `window.confirm` used to
	 * read at the call site. A second question replaces the first and answers it
	 * "no", so no caller is left awaiting a dialog that is no longer on screen.
	 */
	function askConfirm(request: {
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		destructive?: boolean;
	}): Promise<boolean> {
		confirmRequest?.resolve(false);

		return new Promise((resolve) => {
			confirmRequest = {
				confirmLabel: 'Confirm',
				cancelLabel: 'Cancel',
				destructive: false,
				...request,
				resolve
			};
		});
	}

	function settleConfirm(confirmed: boolean) {
		confirmRequest?.resolve(confirmed);
		confirmRequest = null;
	}

	/**
	 * The socket's view of the world, turned into the app's. Nothing here
	 * navigates: a session that has connected once holds content that exists
	 * nowhere else, so a drop is an outage to sit out, not a reason to replace the
	 * page. The old code reloaded on every close and gave up after one retry,
	 * which threw away unsynced edits with no warning.
	 */
	function applyShareStatus(connected: boolean) {
		if (connected) {
			shareHasConnected = true;
			window.clearTimeout(shareConnectTimer);
			shareConnectTimer = undefined;
		}

		shareStatus = nextShareStatus(connected, shareHasConnected);
		title = connected ? formatPageTitle(_workspace) : 'LightNote';

		if (shareStatus === 'reconnecting' && reconnectToastId === undefined) {
			// It stays until the link is back: the status line at the top of the
			// document is out of sight for anyone editing further down.
			reconnectToastId = toast.warning('Connection lost. Reconnecting…', {
				duration: Number.POSITIVE_INFINITY,
				action: { label: 'Save a copy', onClick: () => void saveSharedCopy() }
			});

			return;
		}

		if (connected && reconnectToastId !== undefined) {
			toast.dismiss(reconnectToastId);
			reconnectToastId = undefined;
			toast.success('Reconnected.');
		}
	}

	/**
	 * Takes the shared document into this browser as a normal note. A shared
	 * session writes nothing locally, so without this the only copy of the work is
	 * on the relay — and the moment worth having it is exactly the moment the
	 * relay stopped answering.
	 */
	async function saveSharedCopy() {
		if (!editor) {
			return;
		}

		try {
			await createDocument({
				title: sharedCopyTitle(_workspace),
				content: editor.getJSON(),
				contentFormat: 'tiptap-json'
			});

			toast.success('Saved a copy to this browser.');
		} catch (error) {
			toast.error(describeError(error, 'Failed to save a copy'));
			console.error(error);
		}
	}

	/**
	 * The dialog stays open on a bad endpoint: on success the page navigates away,
	 * so closing it first would only flash the editor before the reload.
	 */
	function connectToShare() {
		try {
			startSharing(_endpoint, _workspace);
		} catch (error) {
			toast.error(describeError(error, 'Failed to start sharing'));
			console.error(error);
		}
	}

	async function switchDocument(documentId: string) {
		if (documentId === currentDocument?.id) {
			return;
		}

		try {
			await flushCurrentDocument();
			const document = await getDocument(documentId);

			if (document) {
				setActiveDocument(document);
			}
		} catch (error) {
			toast.error('Failed to open document');
			console.error(error);
		}
	}

	async function deleteDocumentById(documentToDelete: LightNoteDocument) {
		const confirmed = await askConfirm({
			title: `Delete "${documentToDelete.title || 'Untitled'}"?`,
			description: 'The document and its AI history are removed from this browser.',
			confirmLabel: 'Delete',
			destructive: true
		});

		if (!confirmed) {
			return;
		}

		try {
			const deletingCurrentDocument = currentDocument?.id === documentToDelete.id;

			await deleteDocument(documentToDelete.id);
			// Otherwise the AI history would outlive the document it belongs to — and
			// the guard keeps an in-flight run from writing the history back.
			deletedHistoryKeys.add(documentHistoryKey(documentToDelete.id));
			await clearAiHistory(documentHistoryKey(documentToDelete.id));

			let remainingDocuments = await listDocuments();
			if (remainingDocuments.length === 0) {
				const document = await createDocument({
					title: 'Untitled',
					content: { type: 'doc', content: [{ type: 'paragraph' }] },
					contentFormat: 'tiptap-json'
				});
				remainingDocuments = [document];
			}

			documents = remainingDocuments;
			if (deletingCurrentDocument) {
				setActiveDocument(remainingDocuments[0]);
			}
		} catch (error) {
			toast.error('Failed to delete document');
			console.error(error);
		}
	}

	function isActiveSharedDocument(document: SharedDocumentReference) {
		return document.endpoint === _endpoint && document.workspace === _workspace;
	}

	function switchSharedDocument(document: SharedDocumentReference) {
		if (isActiveSharedDocument(document)) {
			return;
		}

		location.replace(buildShareUrl(location.origin, location.pathname, document));
	}

	async function deleteSharedDocumentByReference(document: SharedDocumentReference) {
		const confirmed = await askConfirm({
			title: `Remove "${document.workspace}"?`,
			description:
				'It only leaves this list of recent shared documents. Nothing on the relay changes.',
			confirmLabel: 'Remove',
			destructive: true
		});

		if (!confirmed) {
			return;
		}

		sharedDocuments = removeSharedDocumentHistory(document);
	}

	async function importDocument() {
		try {
			const uploadedDocument = await readUploadedDocument(files);

			await flushCurrentDocument();

			const document = await createDocument(uploadedDocument);

			files = undefined;
			await refreshDocuments();
			setActiveDocument(document);
		} catch (error) {
			toast.error(describeError(error, 'Failed to upload file'));
			console.error(error);
		}
	}

	function openAiSettings() {
		aiApiKeyInput = aiSettings.apiKey;
		aiModelInput = aiSettings.model;
		aiSettingsOpen = true;
	}

	function saveAiSettings() {
		aiSettings = writeOpenAiSettings({ apiKey: aiApiKeyInput, model: aiModelInput });
		aiSettingsOpen = false;
	}

	/**
	 * Capture the current editor selection (text + document range) so the AI
	 * panel can act on it even after focus moves to the prompt input, and later
	 * restore the exact range when inserting the result.
	 */
	function captureSelection() {
		if (!editor) {
			clearAiSelection();
			return;
		}

		// Treating a cell selection's aggregate `from`/`to` as one text range would
		// put the table structure between the cells inside the range, so leave the
		// panel unscoped until the user places a normal cursor/selection.
		if (isCellSelection(editor.state.selection)) {
			clearAiSelection();
			return;
		}

		const { from, to } = editor.state.selection;
		const raw = editor.state.doc.textBetween(from, to, '\n');
		const text = raw.trim();

		aiSelection = text;
		// The prompt and the panel show the trimmed text, but the validity check needs
		// what the range actually held: comparing trimmed values would accept a range
		// whose surrounding whitespace someone else has since changed.
		aiSelectionExact = text ? raw : '';
		aiSelectionRange = text ? { from, to } : null;
	}

	function clearAiSelection() {
		aiSelection = '';
		aiSelectionExact = '';
		aiSelectionRange = null;
	}

	/** A stored range is valid only while it still points at the original text. */
	function hasCurrentAiSelection(expected?: string) {
		if (!editor || !aiSelectionRange || !aiSelection) {
			return false;
		}

		const from = clampToDocument(aiSelectionRange.from);
		const to = clampToDocument(aiSelectionRange.to);
		if (from > to) {
			return false;
		}

		const current = editor.state.doc.textBetween(from, to, '\n');

		return current === aiSelectionExact && (!expected || expected === aiSelection);
	}

	/**
	 * History is scoped per document, and shared sessions have no local document
	 * row, so they are keyed by the relay target instead.
	 */
	function currentHistoryKey() {
		if (isSharingMode) {
			return _endpoint && _workspace
				? sharedHistoryKey({ endpoint: _endpoint, workspace: _workspace })
				: null;
		}

		return currentDocument ? documentHistoryKey(currentDocument.id) : null;
	}

	let databaseNoticeShown = false;

	/**
	 * History failures are swallowed so they cannot block editing, but a schema
	 * version problem still has to be said out loud: in sharing mode the history is
	 * the only IndexedDB read, so otherwise the user would just see an empty
	 * history and no explanation of why.
	 */
	function notifyDatabaseProblem(error: unknown) {
		const message = error instanceof Error ? error.message : '';

		if (
			databaseNoticeShown ||
			(message !== DB_OUTDATED_MESSAGE && message !== DB_BLOCKED_MESSAGE)
		) {
			return;
		}

		databaseNoticeShown = true;
		// It stays until dismissed: this one describes a condition the user has to
		// act on, not something that just happened.
		toast.error(message, { duration: Number.POSITIVE_INFINITY });
	}

	async function loadAiHistory() {
		const key = currentHistoryKey();

		if (!key) {
			aiHistory = [];
			return;
		}

		try {
			const entries = await listAiHistory(key);

			// Switching documents while a load is in flight must not let the slower
			// read overwrite the newer document's history.
			if (key === currentHistoryKey()) {
				aiHistory = entries;
			}
		} catch (error) {
			// History is auxiliary: a read failure must not block editing.
			if (key === currentHistoryKey()) {
				aiHistory = [];
			}

			notifyDatabaseProblem(error);
			console.error(error);
		}
	}

	/**
	 * Persists one entry against the document the request started from, then shows
	 * the stored list (never a locally appended copy, which would keep entries
	 * that pruning removed).
	 */
	async function saveAiHistory(
		documentKey: string | null,
		input: Omit<AiHistoryInput, 'documentKey'>
	) {
		if (!documentKey || deletedHistoryKeys.has(documentKey)) {
			return;
		}

		try {
			const { entries } = await appendAiHistory({ ...input, documentKey });

			if (documentKey === currentHistoryKey()) {
				aiHistory = entries;
			}
		} catch (error) {
			notifyDatabaseProblem(error);
			console.error(error);

			// Keep the response visible and applicable even when storing it failed.
			if (documentKey === currentHistoryKey()) {
				aiHistory = [...aiHistory, buildHistoryEntry({ ...input, documentKey })];
			}
		}
	}

	async function deleteAiHistoryItem(id: string) {
		try {
			await deleteAiHistoryEntry(id);
			aiHistory = aiHistory.filter((entry) => entry.id !== id);
		} catch (error) {
			console.error(error);
		}
	}

	async function clearAiHistoryForDocument() {
		const key = currentHistoryKey();

		if (!key) {
			return;
		}

		const confirmed = await askConfirm({
			title: 'Clear the AI history?',
			description: 'Every entry for this document goes; the document itself is untouched.',
			confirmLabel: 'Clear',
			destructive: true
		});

		if (!confirmed) {
			return;
		}

		try {
			await clearAiHistory(key);
			aiHistory = [];
		} catch (error) {
			console.error(error);
		}
	}

	function getContextBeforeCursor(limit = 4000) {
		if (!editor) {
			return '';
		}

		const { from } = editor.state.selection;

		return editor.state.doc.textBetween(Math.max(0, from - limit), from, '\n').trim();
	}

	/**
	 * Re-entering an open panel must not reset it. A run in flight owns the step
	 * list and the approval prompt, and clearing that prompt would drop the
	 * resolver its loop is waiting on — the run would hang busy with nothing left
	 * to answer it. Ending a run is `closeAiPanel`'s job, and it cancels first.
	 */
	function openAiPanel() {
		if (aiOpen) {
			if (!aiBusy && !aiPendingApproval) {
				captureSelection();
			}

			return;
		}

		aiSettings = readOpenAiSettings();
		aiApiKeyInput = aiSettings.apiKey;
		aiModelInput = aiSettings.model;
		captureSelection();
		aiError = '';
		aiBusy = false;
		aiSteps = [];
		aiAgentText = '';
		aiAllowDocumentWideEdits = false;
		aiPendingApproval = null;
		aiOpen = true;
		// Cheap insurance: the history may have been pruned or cleared elsewhere.
		void loadAiHistory();
	}

	/** The nav's AI button mirrors the document list's: one control, both ways. */
	function toggleAiPanel() {
		if (aiOpen) {
			closeAiPanel();

			return;
		}

		openAiPanel();
	}

	function closeAiPanel() {
		// The panel is the only place a run is visible or answerable, so a closed
		// panel must never leave one alive: reopening resets the panel state, which
		// would otherwise orphan the request (hidden mutations, or an approval
		// promise nothing can resolve).
		if (aiBusy || aiPendingApproval) {
			cancelAiRequest();
		}

		aiOpen = false;
		aiAllowDocumentWideEdits = false;
	}

	function saveAiKeyFromPanel() {
		if (!aiApiKeyInput.trim()) {
			return;
		}

		aiSettings = writeOpenAiSettings({ apiKey: aiApiKeyInput, model: aiModelInput });
		aiError = '';
	}

	/**
	 * A one-shot action: one request, no tools, and the result goes into the
	 * document as soon as it arrives. The textarea only carries an instruction for
	 * the actions that read one, so clicking Summarize cannot swallow a sentence
	 * the user was still writing for the agent.
	 */
	async function runAiAction(action: AiAction) {
		const check = checkAiRequest({
			action,
			hasApiKey: Boolean(aiSettings.apiKey),
			selection: aiSelection
		});

		if (check.status === 'needs-api-key') {
			// The panel shows an inline API-key field in this state, so just
			// surface the message instead of opening a separate dialog.
			aiError = check.message;
			return;
		}

		if (check.status === 'invalid') {
			aiError = check.message;
			return;
		}

		const runId = startAiRun();
		const usesInstruction = action === 'rewrite';
		const prompt = usesInstruction ? aiPrompt : '';
		const selection = aiSelection;

		if (usesInstruction) {
			// The instruction has been taken; the box is free for the next one. The
			// live entry renders `aiRunPrompt`, and the history entry keeps the text.
			aiPrompt = '';
		}

		aiRunPrompt = prompt;
		aiRunAction = action;
		// The response belongs to the document the request started from, even if
		// the user switches documents while it is in flight.
		const startedFrom = currentHistoryKey();

		try {
			const response = await generateText({
				action,
				settings: aiSettings,
				selection,
				context: action === 'continue' ? getContextBeforeCursor() : '',
				instruction: prompt,
				signal: aiController?.signal
			});

			// Applied before the entry is stored: the edit is the point of the
			// action, and it must not wait on IndexedDB. A superseded run does not
			// write — its result belongs to a request the user replaced.
			if (isCurrentAiRun(runId)) {
				applyAiResult(response, selection);
			}

			await saveAiHistory(startedFrom, { action, prompt, selection, response });
		} catch (error) {
			if ((error as Error)?.name === 'AbortError') {
				return;
			}

			const message = error instanceof Error ? error.message : 'AI request failed';

			if (isCurrentAiRun(runId)) {
				aiError = message;
			}

			await saveAiHistory(startedFrom, {
				action,
				prompt,
				selection,
				response: '',
				error: message
			});
		} finally {
			finishAiRun(runId);
		}
	}

	function startAiRun() {
		aiRunId += 1;
		aiBusy = true;
		aiError = '';
		aiRunAction = null;
		aiController = new AbortController();

		return aiRunId;
	}

	/**
	 * Puts a one-shot result where the action was aimed. Replacing reports its own
	 * error when the selection moved under it; the entry stays in the history with
	 * Insert and Replace, so a result is never lost to a failed apply.
	 */
	function applyAiResult(text: string, selection: string) {
		if (selection) {
			replaceSelectionWithResult(text, selection);

			return;
		}

		insertResultAtCursor(text);
	}

	function isCurrentAiRun(runId: number) {
		return runId === aiRunId;
	}

	/**
	 * Only the current run may clear the shared busy/controller state: a cancelled
	 * run settling later must not reset the state of the run that replaced it.
	 */
	function finishAiRun(runId: number) {
		if (!isCurrentAiRun(runId)) {
			return;
		}

		aiBusy = false;
		aiRunAction = null;
		aiController = undefined;
	}

	function cancelAiRequest() {
		// Deny any waiting approval first so the agent loop stops instead of
		// hanging on a promise that will never resolve.
		denyPendingApproval();
		aiController?.abort();
		// Retire the id so the abandoned run cannot touch panel state as it unwinds.
		aiRunId += 1;
		aiBusy = false;
		aiRunAction = null;
		aiController = undefined;
	}

	function replaceSelectionWithResult(text: string, expectedSelection?: string) {
		if (!editor || !text) {
			return;
		}

		// Replacing a changed (or unrelated) selection is worse than making the
		// user choose where to insert. The explicit Insert action remains available.
		if (!hasCurrentAiSelection(expectedSelection)) {
			aiError = 'The original selection changed. Select the text again before replacing it.';
			return;
		}

		const range = {
			from: clampToDocument(aiSelectionRange!.from),
			to: clampToDocument(aiSelectionRange!.to)
		};
		// A selection inside one paragraph must be replaced with inline HTML: a `<p>`
		// block there splits the paragraph around the replacement.
		const inline = isInlineRange(range) ? toInlineEditorHtml(text) : null;

		editor
			.chain()
			.focus()
			.insertContentAt(range, inline ?? toEditorHtml(text))
			.run();

		clearAiSelection();
	}

	/**
	 * Clamp a stored position to the live document: the agent can switch
	 * documents mid-run (e.g. after `create_document`), which invalidates the
	 * range captured when the panel opened.
	 */
	function clampToDocument(position: number) {
		return Math.min(Math.max(position, 0), editor.state.doc.content.size);
	}

	/**
	 * Maps exact source text back to one text block. The target is matched
	 * verbatim, and both an ambiguous and a near-miss target are rejected rather
	 * than adjusted: the approval preview shows the target the model sent, so
	 * editing anything else — even a whitespace-trimmed variant of it — would let
	 * the user approve one span while another is changed.
	 */
	function findExactTextMatches(target: string) {
		const matches: Array<{ from: number; to: number }> = [];

		editor.state.doc.descendants((node, position) => {
			if (!node.isTextblock) {
				return;
			}

			const segments: Array<{ from: number; text: string }> = [];
			node.descendants((child, childPosition) => {
				if (child.isText && child.text) {
					segments.push({ from: position + 1 + childPosition, text: child.text });
				}
			});

			matches.push(...findExactTextRanges(segments, target));
			return false;
		});

		return matches;
	}

	/** True when a range starts and ends inside the same text block. */
	function isInlineRange(range: { from: number; to: number }) {
		const $from = editor.state.doc.resolve(range.from);
		const $to = editor.state.doc.resolve(range.to);

		return $from.sameParent($to) && $from.parent.isTextblock;
	}

	/**
	 * Replaces a range with parsed markdown, keeping an in-paragraph edit inside its
	 * paragraph. `insertContentAt` given a block node over an inline range splits the
	 * block — replacing "world" in "Hello world" would leave "Hello " and "earth" as
	 * two paragraphs — so a single-paragraph replacement of an inline range is
	 * inserted as that paragraph's inline content instead. Any other shape (a
	 * heading, a list, several blocks) is a deliberate block-level change and is
	 * inserted as-is.
	 */
	function replaceRangeWithNodes(range: { from: number; to: number }, nodes: JSONContent[]) {
		const inline =
			isInlineRange(range) && nodes.length === 1 && nodes[0]?.type === 'paragraph'
				? nodes[0].content
				: undefined;

		editor
			.chain()
			.focus()
			.insertContentAt(range, inline && inline.length > 0 ? inline : nodes)
			.run();
	}

	/**
	 * Wire the AI tools to this editor instance. Edits to the open document go
	 * through editor commands so they land in Tiptap history (and in Yjs while
	 * sharing); only other documents are written straight to IndexedDB.
	 */
	function createAiToolExecutor() {
		return createDocumentToolExecutor({
			store: { listDocuments, getDocument, createDocument, updateDocument },
			editor: {
				getText: () =>
					editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n\n', '\n').trim(),
				hasSelection: () => hasCurrentAiSelection(),
				// A captured selection makes the run selection-scoped, which removes this
				// tool, so the live cursor is the only position it can ever insert at.
				insertAtCursor: (nodes) => {
					if (isCellSelection(editor.state.selection)) {
						throw new Error('Place the cursor in one table cell before inserting text.');
					}

					const at = clampToDocument(editor.state.selection.to);

					editor.chain().focus().insertContentAt(at, nodes).run();
				},
				replaceSelection: (nodes) => {
					if (!hasCurrentAiSelection()) {
						return;
					}

					const range = aiSelectionRange
						? {
								from: clampToDocument(aiSelectionRange.from),
								to: clampToDocument(aiSelectionRange.to)
							}
						: { from: editor.state.selection.from, to: editor.state.selection.to };

					replaceRangeWithNodes(range, nodes);
					clearAiSelection();
				},
				replaceExactText: (target, nodes) => {
					const matches = findExactTextMatches(target);

					if (matches.length === 0) {
						return {
							ok: false as const,
							error:
								'Target text was not found. Copy an exact fragment from one paragraph, with no added or missing whitespace; targets are matched verbatim and cannot cross paragraph or hard-break boundaries.'
						};
					}

					if (matches.length > 1) {
						return {
							ok: false as const,
							error: `Target text was found ${matches.length} times. Extend the target to make it unique.`
						};
					}

					replaceRangeWithNodes(matches[0], nodes);
					return { ok: true as const };
				},
				setContent: (nodes) => {
					// `setContent` defaults to emitUpdate: false, which would skip the
					// autosave and leave the replacement unpersisted.
					editor.commands.setContent(
						{
							type: 'doc',
							content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }]
						},
						true
					);
					clearAiSelection();
				},
				appendContent: (nodes) => {
					editor.chain().focus().insertContentAt(editor.state.doc.content.size, nodes).run();
				},
				setTitle: (newTitle) => {
					documentTitle = newTitle;
					title = formatPageTitle(newTitle);
					scheduleCurrentDocumentSave(true);
				}
			},
			getCurrentDocumentId: () => currentDocument?.id ?? null,
			getCurrentDocumentTitle: () => effectiveDocumentTitle,
			isSharingMode,
			onStoreChanged: refreshDocuments,
			openDocument: async (document) => {
				await flushCurrentDocument();
				setActiveDocument(document);
			}
		});
	}

	function requestAiApproval({ description, invocation }: ApprovalRequest) {
		if (aiAutoApprove) {
			return Promise.resolve(true);
		}

		return new Promise<boolean>((resolve) => {
			aiPendingApproval = {
				description,
				preview: toolCallPreview(invocation),
				resolve: (approved) => {
					aiPendingApproval = null;
					resolve(approved);
				}
			};
		});
	}

	function handleAgentEvent(event: AgentEvent) {
		if (event.type === 'step') {
			aiSteps = [...aiSteps, event.step];
		} else if (event.type === 'assistant-text') {
			aiAgentText = event.text;
		}
	}

	function resolveAiApproval(approved: boolean) {
		aiPendingApproval?.resolve(approved);
	}

	function denyPendingApproval() {
		resolveAiApproval(false);
	}

	function continueAiAgentTask() {
		void runAiAgentTask(aiResume?.messages);
	}

	async function runAiAgentTask(priorMessages?: ChatMessage[]) {
		// Continuing sends a neutral instruction rather than the textarea contents:
		// resubmitting the original prompt invites the model to redo work that the
		// transcript already records as done.
		const instruction = priorMessages ? 'Continue.' : aiPrompt;
		const allowDocumentWideEdits = priorMessages
			? aiResume?.allowDocumentWideEdits ?? false
			: aiAllowDocumentWideEdits;
		const check = checkAgentRequest({
			hasApiKey: Boolean(aiSettings.apiKey),
			instruction
		});

		if (check.status !== 'ready') {
			aiError = check.message;
			return;
		}

		aiSteps = [];
		aiAgentText = '';
		aiPendingApproval = null;

		// A continuation belongs to the transcript it resumes, so it works from the
		// selection that run was given rather than whatever the panel captured since.
		if (priorMessages && aiResume) {
			aiSelection = aiResume.selection;
			aiSelectionExact = aiResume.selectionExact;
			aiSelectionRange = aiResume.selectionRange;
		}

		// A captured selection whose range no longer matches the document cannot be
		// replaced, and `selectionOnly` would then hand the run a tool set whose only
		// write (replace_selection) always fails. Dropping it falls back to the
		// targeted replace_text path instead of wasting the run. A continuation keeps
		// the scope its transcript was written under, so it does not consult this.
		if (!priorMessages && aiSelection && !hasCurrentAiSelection()) {
			clearAiSelection();
		}

		const runId = startAiRun();
		const prompt = instruction;
		const selection = aiSelection;
		const selectionOnly = priorMessages ? aiResume?.selectionOnly ?? false : Boolean(aiSelection);

		if (!priorMessages) {
			aiPrompt = '';
			// This opt-in belongs to the one request just started, not the panel
			// session. A stopped run carries it through its explicit Continue flow.
			aiAllowDocumentWideEdits = false;
		}

		aiRunPrompt = prompt;
		// The document can change mid-run (create_document opens the new one), so
		// the entry is written against the document the run started from.
		const startedFrom = currentHistoryKey();
		// Steps are collected locally as well: a superseded run must record what it
		// actually did, not whatever the live panel state holds by then.
		const runSteps: AgentStep[] = [];
		let runText = '';
		let runError = '';

		try {
			const run = await runAgent(prompt, {
				settings: aiSettings,
				priorMessages,
				executeTool: createAiToolExecutor(),
				requestApproval: requestAiApproval,
				onEvent: (event) => {
					if (event.type === 'step') {
						runSteps.push(event.step);
					} else if (event.type === 'assistant-text') {
						runText = event.text;
					}

					if (isCurrentAiRun(runId)) {
						handleAgentEvent(event);
					}
				},
				isSharingMode,
				selection,
				// Selection edits already include their complete target. Supplying the
				// preceding document text makes it too easy to broaden the rewrite.
				context: selection ? '' : getContextBeforeCursor(),
				selectionOnly,
				allowDocumentWideEdits,
				signal: aiController?.signal
			});

			runText = run.text;

			if (run.stopReason === 'completed') {
				// Only a finished run clears the continuation state; a failed attempt
				// keeps the previous transcript, which is the only copy there is.
				if (isCurrentAiRun(runId)) {
					aiResume = null;
				}
			} else if (isCurrentAiRun(runId)) {
				// Keep the transcript so Continue can pick up where this left off.
				aiResume = {
					messages: run.messages,
					reason: run.stopReason,
					allowDocumentWideEdits,
					selectionOnly,
					// The live values, not the ones captured at the start: a selection this
					// run already replaced is genuinely gone, and the continuation must see
					// that rather than resurrect a range whose text has changed.
					selection: aiSelection,
					selectionExact: aiSelectionExact,
					selectionRange: aiSelectionRange
				};
				runError =
					run.stopReason === 'stalled'
						? 'The agent stopped because it kept repeating the same step.'
						: 'The agent stopped after reaching its step limit.';
			}
		} catch (error) {
			runError = (error as Error)?.name === 'AbortError' ? 'Cancelled.' : '';

			if (!runError) {
				runError = error instanceof Error ? error.message : 'AI request failed';
			}
		} finally {
			// Approval state is shared, so only the current run may deny it: a
			// superseded run unwinding later would otherwise reject a newer prompt.
			if (isCurrentAiRun(runId)) {
				denyPendingApproval();
			}

			finishAiRun(runId);
		}

		if (isCurrentAiRun(runId)) {
			aiAgentText = runText;
			// The run is now recorded below, so drop the live copy of it.
			aiSteps = [];

			if (runError && runError !== 'Cancelled.') {
				aiError = runError;
			}
		}

		await saveAiHistory(startedFrom, {
			prompt,
			selection,
			response: runText,
			steps: runSteps.map((step) => ({
				description: step.description,
				status: step.status,
				...(step.result.ok ? {} : { error: step.result.error })
			})),
			...(runError ? { error: runError } : {})
		});

		if (isCurrentAiRun(runId)) {
			aiAgentText = '';
		}
	}

	function insertResultAtCursor(text: string) {
		if (!editor || !text) {
			return;
		}

		const at = aiSelectionRange ? aiSelectionRange.to : editor.state.selection.to;

		editor.chain().focus().insertContentAt(at, toEditorHtml(text)).run();
		clearAiSelection();
	}

	/**
	 * Row/column tools live in the table bubble menu, next to the table. In the
	 * toolbar they would shift every button to their right the moment the cursor
	 * entered a cell.
	 */
	function buildTableActions(activeEditor: Editor): ToolbarItem[] {
		return [
			{
				key: 'add-row',
				label: 'Add row below',
				icon: BetweenHorizontalEnd,
				onClick: () => activeEditor.chain().focus().addRowAfter().run(),
				disabled: !activeEditor.can().chain().focus().addRowAfter().run()
			},
			{
				key: 'delete-row',
				label: 'Delete row',
				icon: FoldVertical,
				onClick: () => activeEditor.chain().focus().deleteRow().run(),
				disabled: !activeEditor.can().chain().focus().deleteRow().run()
			},
			{
				key: 'add-column',
				label: 'Add column right',
				icon: BetweenVerticalEnd,
				onClick: () => activeEditor.chain().focus().addColumnAfter().run(),
				disabled: !activeEditor.can().chain().focus().addColumnAfter().run()
			},
			{
				key: 'delete-column',
				label: 'Delete column',
				icon: FoldHorizontal,
				onClick: () => activeEditor.chain().focus().deleteColumn().run(),
				disabled: !activeEditor.can().chain().focus().deleteColumn().run()
			},
			{
				key: 'header-row',
				label: 'Toggle header row',
				icon: PanelTop,
				onClick: () => activeEditor.chain().focus().toggleHeaderRow().run(),
				disabled: !activeEditor.can().chain().focus().toggleHeaderRow().run()
			},
			{
				key: 'merge-cells',
				label: 'Merge or split cells',
				icon: Merge,
				onClick: () => activeEditor.chain().focus().mergeOrSplit().run(),
				disabled: !activeEditor.can().chain().focus().mergeOrSplit().run()
			},
			{
				key: 'delete-table',
				label: 'Delete table',
				icon: Trash2,
				onClick: () => activeEditor.chain().focus().deleteTable().run()
			}
		];
	}

	/**
	 * Build the toolbar as grouped data so it can render three ways from one
	 * source: the desktop bar, where groups of mutually exclusive or rarely used
	 * actions collapse into dropdowns; those dropdowns; and the compact mobile
	 * row plus its overflow sheet, which flattens every dropdown back into
	 * buttons. Active/disabled states are computed eagerly and recomputed
	 * whenever `editor` is reassigned (see the `onTransaction` hook).
	 */
	/**
	 * Every piece of state the bar reflects is a parameter, because the reactive
	 * statement below only re-runs on what it passes in: a value read from the
	 * component scope here would render once and then go stale.
	 */
	function buildToolbarGroups(
		activeEditor: Editor,
		sharing: boolean,
		activeProvider: HocuspocusProvider | undefined,
		doc: LightNoteDocument | null,
		aiPanelOpen: boolean
	): ToolbarGroup[] {
		return [
			{
				id: 'doc',
				label: 'Document',
				nodes: [
					toolbarItem({
						key: 'new',
						label: 'New document',
						icon: BookPlus,
						onClick: createNewDocument,
						disabled: sharing,
						primary: true
					})
				]
			},
			{
				id: 'history',
				label: 'History',
				nodes: [
					toolbarItem({
						key: 'undo',
						label: 'Undo',
						icon: Undo,
						onClick: () => activeEditor.chain().focus().undo().run(),
						disabled: !activeEditor.can().chain().focus().undo().run()
					}),
					toolbarItem({
						key: 'redo',
						label: 'Redo',
						icon: Redo,
						onClick: () => activeEditor.chain().focus().redo().run(),
						disabled: !activeEditor.can().chain().focus().redo().run()
					})
				]
			},
			{
				id: 'blocks',
				label: 'Block style',
				nodes: [
					toolbarMenu({
						key: 'block-style',
						label: 'Block style',
						icon: Pilcrow,
						// A block always has a style, so the trigger names the current
						// one; `Paragraph` is only the fallback for an unknown block.
						caption: 'Paragraph',
						reflectActive: true,
						items: [
							{
								key: 'paragraph',
								label: 'Paragraph',
								icon: Pilcrow,
								onClick: () => activeEditor.chain().focus().setParagraph().run(),
								// A blockquote wraps a paragraph, so Tiptap reports both as
								// active; the wrapper is the style the user chose, and the
								// trigger must not read `Paragraph` inside a quote.
								active: activeEditor.isActive('paragraph') && !activeEditor.isActive('blockquote')
							},
							{
								key: 'h1',
								label: 'Heading 1',
								icon: Heading1,
								onClick: () => activeEditor.chain().focus().toggleHeading({ level: 1 }).run(),
								active: activeEditor.isActive('heading', { level: 1 })
							},
							{
								key: 'h2',
								label: 'Heading 2',
								icon: Heading2,
								onClick: () => activeEditor.chain().focus().toggleHeading({ level: 2 }).run(),
								active: activeEditor.isActive('heading', { level: 2 }),
								primary: true
							},
							{
								key: 'h3',
								label: 'Heading 3',
								icon: Heading3,
								onClick: () => activeEditor.chain().focus().toggleHeading({ level: 3 }).run(),
								active: activeEditor.isActive('heading', { level: 3 })
							},
							{
								key: 'blockquote',
								label: 'Quote',
								icon: TextQuote,
								onClick: () => activeEditor.chain().focus().toggleBlockquote().run(),
								active: activeEditor.isActive('blockquote')
							},
							{
								key: 'code-block',
								label: 'Code block',
								icon: Braces,
								onClick: () => activeEditor.chain().focus().toggleCodeBlock().run(),
								active: activeEditor.isActive('codeBlock')
							}
						]
					})
				]
			},
			{
				id: 'format',
				label: 'Format',
				nodes: [
					toolbarItem({
						key: 'bold',
						label: 'Bold',
						icon: Bold,
						onClick: () => activeEditor.chain().focus().toggleBold().run(),
						active: activeEditor.isActive('bold'),
						disabled: !activeEditor.can().chain().focus().toggleBold().run(),
						primary: true
					}),
					toolbarItem({
						key: 'italic',
						label: 'Italic',
						icon: Italic,
						onClick: () => activeEditor.chain().focus().toggleItalic().run(),
						active: activeEditor.isActive('italic'),
						disabled: !activeEditor.can().chain().focus().toggleItalic().run(),
						primary: true
					}),
					toolbarItem({
						key: 'underline',
						label: 'Underline',
						icon: Underline,
						onClick: () => activeEditor.chain().focus().toggleUnderline().run(),
						active: activeEditor.isActive('underline'),
						disabled: !activeEditor.can().chain().focus().toggleUnderline().run()
					}),
					toolbarItem({
						key: 'strike',
						label: 'Strikethrough',
						icon: Strikethrough,
						onClick: () => activeEditor.chain().focus().toggleStrike().run(),
						active: activeEditor.isActive('strike'),
						disabled: !activeEditor.can().chain().focus().toggleStrike().run()
					}),
					toolbarItem({
						key: 'code',
						label: 'Inline code',
						icon: Code,
						onClick: () => activeEditor.chain().focus().toggleCode().run(),
						active: activeEditor.isActive('code'),
						disabled: !activeEditor.can().chain().focus().toggleCode().run()
					})
				]
			},
			{
				id: 'lists',
				label: 'Lists',
				nodes: [
					toolbarItem({
						key: 'bullet-list',
						label: 'Bullet list',
						icon: List,
						onClick: () => activeEditor.chain().focus().toggleBulletList().run(),
						active: activeEditor.isActive('bulletList'),
						primary: true
					}),
					toolbarItem({
						key: 'ordered-list',
						label: 'Ordered list',
						icon: ListOrdered,
						onClick: () => activeEditor.chain().focus().toggleOrderedList().run(),
						active: activeEditor.isActive('orderedList')
					})
				]
			},
			{
				id: 'insert',
				label: 'Align & insert',
				nodes: [
					toolbarMenu({
						key: 'align',
						label: 'Text alignment',
						icon: AlignLeft,
						reflectActive: true,
						items: [
							{
								key: 'align-left',
								label: 'Align left',
								icon: AlignLeft,
								onClick: () => activeEditor.chain().focus().setTextAlign('left').run(),
								active: activeEditor.isActive({ textAlign: 'left' })
							},
							{
								key: 'align-center',
								label: 'Align center',
								icon: AlignCenter,
								onClick: () => activeEditor.chain().focus().setTextAlign('center').run(),
								active: activeEditor.isActive({ textAlign: 'center' })
							},
							{
								key: 'align-right',
								label: 'Align right',
								icon: AlignRight,
								onClick: () => activeEditor.chain().focus().setTextAlign('right').run(),
								active: activeEditor.isActive({ textAlign: 'right' })
							}
						]
					}),
					toolbarMenu({
						key: 'insert',
						label: 'Insert',
						icon: Plus,
						items: [
							{
								key: 'link',
								label: 'Link',
								icon: Link2,
								onClick: () => openUrlDialog('link'),
								active: activeEditor.isActive('link')
							},
							{
								key: 'unlink',
								label: 'Remove link',
								icon: Link2Off,
								onClick: () => activeEditor.chain().focus().unsetLink().run(),
								disabled: !activeEditor.isActive('link')
							},
							{
								key: 'image',
								label: 'Image',
								icon: ImagePlus,
								onClick: () => openUrlDialog('image')
							},
							{
								key: 'youtube',
								label: 'YouTube video',
								icon: MonitorPlay,
								onClick: () => openUrlDialog('youtube')
							},
							{
								key: 'table',
								label: 'Table',
								icon: Table,
								onClick: () => insertTable(activeEditor),
								disabled: !activeEditor.can().chain().focus().insertTable(DEFAULT_TABLE_SIZE).run()
							},
							{
								key: 'hr',
								label: 'Horizontal rule',
								icon: SeparatorHorizontal,
								onClick: () => activeEditor.chain().focus().setHorizontalRule().run()
							}
						]
					})
				]
			},
			{
				id: 'ai',
				label: 'AI',
				nodes: [
					toolbarItem({
						key: 'ai-writing',
						label: aiPanelOpen ? 'Hide AI assistant' : 'Show AI assistant',
						icon: Sparkles,
						active: aiPanelOpen,
						onClick: toggleAiPanel,
						primary: true
					})
				]
			},
			{
				id: 'more',
				label: 'More',
				nodes: [
					toolbarItem({
						key: 'download',
						label: 'Download as HTML',
						icon: FileDown,
						onClick: () => openDownloadDialog(activeEditor, doc?.title)
					}),
					toolbarItem({
						key: 'import',
						label: 'Import HTML file',
						icon: FileUp,
						onClick: () => window.document.getElementById('selectedFile')?.click(),
						disabled: sharing
					}),
					toolbarItem({
						key: 'share',
						label: 'Share',
						icon: ScreenShare,
						onClick: () => (shareDialogOpen = true)
					}),
					toolbarItem({
						key: 'save-shared-copy',
						label: 'Save a copy',
						icon: Copy,
						onClick: () => void saveSharedCopy(),
						// Disabled rather than hidden, like Stop sharing above it: a
						// normal document is already saved, so there is nothing to copy.
						disabled: !sharing
					}),
					toolbarItem({
						key: 'stop-share',
						label: 'Stop sharing',
						icon: ScreenShareOff,
						onClick: () => endSharing(activeProvider),
						disabled: !activeProvider
					}),
					toolbarItem({
						key: 'ai-settings',
						label: 'AI settings',
						icon: Settings2,
						onClick: openAiSettings
					}),
					toolbarItem({
						key: 'theme',
						label: 'Toggle theme',
						icon: SunMoon,
						onClick: toggleMode
					})
				]
			}
		];
	}

	$: toolbarGroups = editor
		? buildToolbarGroups(editor, isSharingMode, provider, currentDocument, aiOpen)
		: [];
	// The bar keeps the editing groups; AI and the utility actions are pinned to
	// its right edge so their position never depends on how wide the rest is.
	$: barGroups = toolbarGroups.filter((group) => group.id !== 'ai' && group.id !== 'more');
	$: trailingItems = toolbarGroups
		.filter((group) => group.id === 'ai')
		.flatMap((group) => flattenGroup(group));
	$: moreMenu = {
		key: 'more',
		label: 'More tools',
		icon: MoreHorizontal,
		items: toolbarGroups
			.filter((group) => group.id === 'more')
			.flatMap((group) => flattenGroup(group))
	};
	$: primaryToolbarItems = collectPrimaryItems(toolbarGroups);
	$: tableActions = editor ? buildTableActions(editor) : [];

	function runToolbarItem(item: ToolbarItem) {
		item.onClick();
		toolbarOverflowOpen = false;
	}

	onMount(() => {
		aiSettings = readOpenAiSettings();

		// Left by the page that reloaded into this one, e.g. a share that failed to
		// connect. Read before anything can fail here, so one notice cannot bury it.
		const startupNotice = takeStartupNotice(sessionStorage);

		if (startupNotice) {
			toast.error(startupNotice);
		}

		// Crossing the breakpoint changes what the list *is*, so the state is taken
		// from the preference again rather than carried over: a list dragged down
		// to phone width would otherwise stay open on top of the note.
		const dockQuery = window.matchMedia(DOCKED_SIDEBAR_QUERY);
		const applyDock = (docked: boolean) => {
			sidebarDocked = docked;
			sidebarOpen = readSidebarOpen(localStorage, docked);
		};
		const onDockChange = (event: MediaQueryListEvent) => applyDock(event.matches);

		applyDock(dockQuery.matches);
		dockQuery.addEventListener('change', onDockChange);

		let disposed = false;

		async function initializeEditor() {
			const searchParams = new URLSearchParams(location.search);
			let extensions: Extensions | undefined;

			if (searchParams.has('endpoint') || searchParams.has('workspace')) {
				isSharingMode = true;
				try {
					const { endpoint, workspace } = validateShareMetadata(
						searchParams.get('endpoint') ?? '',
						searchParams.get('workspace') ?? ''
					);

					_endpoint = endpoint;
					_workspace = workspace;

					const [{ HocuspocusProvider, HocuspocusProviderWebsocket }, { getExtensionsOnSharing }] =
						await Promise.all([import('@hocuspocus/provider'), import('./sharing')]);

					const websocketProvider = new HocuspocusProviderWebsocket({
						url: endpoint,
						...SHARE_SOCKET_OPTIONS
					});

					// Only ever fires when nothing has connected yet: an address that
					// never answers is a wrong link, and leaving costs nothing because
					// there is no content to lose. A drop after that is handled by
					// `applyShareStatus`, which never navigates.
					shareConnectTimer = window.setTimeout(() => {
						stashStartupNotice(sessionStorage, `Could not connect to ${endpoint}/${workspace}`);
						location.replace(`${location.origin}${location.pathname}`);
					}, SHARE_CONNECT_TIMEOUT_MS);

					provider = new HocuspocusProvider({
						websocketProvider,
						name: workspace,
						onStatus({ status }) {
							applyShareStatus(status === 'connected');
						},
						connect: false
					});
					// Deliberately not awaited: the Y.Doc exists now and fills in when the
					// first sync lands, so the editor can be built and shown immediately
					// instead of holding a blank page for the length of the handshake.
					provider.connect().catch((error: unknown) => console.error(error));

					localStorage.setItem('shared', JSON.stringify({ endpoint, workspace }));
					sharedDocuments = upsertSharedDocumentHistory({ endpoint, workspace });

					extensions = await getExtensionsOnSharing(provider, {
						format: bubbleMenu,
						table: tableBubbleMenu
					});
					await loadAiHistory();
				} catch (error) {
					const message = describeError(error, 'Unknown error');

					stashStartupNotice(
						sessionStorage,
						`Failed to start sharing with ${location.search}: ${message}`
					);
					console.error(error);

					localStorage.removeItem('connected');
					location.replace(`${location.origin}${location.pathname}`);
					return;
				}
			} else {
				try {
					const shared = readSharedMetadata(localStorage);

					_endpoint = shared?.endpoint ?? '';
					_workspace = shared?.workspace ?? '';
					sharedDocuments = readSharedDocumentHistory();

					extensions = getExtensions({ format: bubbleMenu, table: tableBubbleMenu });
					currentDocument = await ensureInitialDocument();
					documentTitle = currentDocument.title;
					content = currentDocument.content;
					title = formatPageTitle(currentDocument.title);
					documents = await listDocuments();
					await loadAiHistory();
				} catch (error) {
					toast.error(describeError(error, 'Failed to load documents'));
					console.error(error);
					return;
				}
			}

			if (disposed || !extensions) {
				return;
			}

			editor = new Editor({
				element: element,
				editorProps: {
					attributes: {
						class: `px-4 pb-4 pt-2 outline-none md:pb-8 md:pt-3 ${documentColumnClass}`
					}
				},
				extensions,
				onUpdate() {
					scheduleCurrentDocumentSave();
				},
				content,
				onTransaction: () => {
					// force re-render so `editor.isActive` works as expected
					editor = editor;
				},
				// The panel captures the selection when it opens, but the user often
				// opens it first and selects afterwards; without this the selection is
				// silently missing and the request loses its scope. A run in flight owns
				// the captured range, so recapturing then would move its target.
				onSelectionUpdate: () => {
					if (!aiOpen || aiBusy || aiPendingApproval) {
						return;
					}

					captureSelection();
				}
			});
			editor.commands.focus();
			void markUiReady();
		}

		void initializeEditor();

		// A wrapped title needs a different height at every column width, and the
		// column is resized by the window and by the AI panel's animated padding.
		// The observer watches the field itself, so the guard is what keeps the
		// height it sets from feeding back as another resize.
		let observedTitleWidth = 0;
		const titleObserver =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver((entries) => {
						const width = entries[0]?.contentRect.width ?? 0;

						if (width === observedTitleWidth) {
							return;
						}

						observedTitleWidth = width;

						if (documentTitleField) {
							resizeTitleField(documentTitleField);
						}
					});

		if (documentTitleField) {
			titleObserver?.observe(documentTitleField);
		}

		return () => {
			disposed = true;
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
			titleObserver?.disconnect();
			dockQuery.removeEventListener('change', onDockChange);
			// Or a share that never connected would navigate a page that has already
			// moved on to something else.
			window.clearTimeout(shareConnectTimer);
			stopEdgeScroll();
			editor?.destroy();
			(provider as (HocuspocusProvider & { destroy?: () => void }) | undefined)?.destroy?.();
		};
	});
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<svelte:window
	on:keydown={handleSidebarKeydown}
	on:pointermove={dragDocument}
	on:pointerup={releaseDocument}
	on:pointercancel={endDocumentDrag}
/>

{#if editor}
	<div>
		<nav
			class="editor-nav fixed left-0 top-0 z-20 flex h-16 w-full flex-row items-center gap-1 border-b border-border bg-background px-3 py-3 lg:px-4"
			class:sidebar-open={sidebarOpen}
		>
			<!-- The list has a close button of its own, but below `lg` it sits behind
			     the overlay's scrim, so this is the only way back to it. -->
			<ToolbarButton
				icon={PanelLeft}
				label={sidebarOpen ? 'Hide documents' : 'Show documents'}
				active={sidebarOpen}
				on:click={toggleSidebar}
			/>
			<div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true"></div>

			<input
				type="file"
				id="selectedFile"
				accept=".html,.htm,text/html"
				style="display: none;"
				bind:files
				on:change={importDocument}
			/>

			<!-- Desktop: grouped toolbar, with dropdowns for the crowded groups -->
			<div class="hidden w-full items-center overflow-x-auto lg:flex">
				{#each barGroups as group, groupIndex (group.id)}
					{#if groupIndex > 0}
						<div class="mx-1.5 h-6 w-px shrink-0 bg-border" aria-hidden="true"></div>
					{/if}
					<div class="flex shrink-0 items-center gap-0.5">
						{#each group.nodes as node (node.key)}
							{#if node.kind === 'menu'}
								<ToolbarMenu menu={node} />
							{:else}
								<ToolbarButton
									icon={node.icon}
									label={node.label}
									active={node.active}
									disabled={node.disabled}
									on:click={node.onClick}
								/>
							{/if}
						{/each}
					</div>
				{/each}
				<div class="ml-auto flex shrink-0 items-center gap-0.5 pl-3">
					{#each trailingItems as item (item.key)}
						<ToolbarButton
							icon={item.icon}
							label={item.label}
							active={item.active}
							disabled={item.disabled}
							on:click={item.onClick}
						/>
					{/each}
					<ToolbarMenu menu={moreMenu} />
				</div>
			</div>

			<!-- Mobile: primary actions + overflow menu -->
			<div class="flex w-full items-center gap-0.5 lg:hidden">
				{#each primaryToolbarItems as item (item.key)}
					<ToolbarButton
						icon={item.icon}
						label={item.label}
						active={item.active}
						disabled={item.disabled}
						on:click={item.onClick}
					/>
				{/each}
				<Popover.Root bind:open={toolbarOverflowOpen}>
					<Popover.Trigger
						class={buttonVariants({ variant: 'secondary', className: 'ml-auto h-8 px-2' })}
						aria-label="More tools"
					>
						<MoreHorizontal class="h-4 w-4" />
					</Popover.Trigger>
					<Popover.Content align="end" class="w-[min(20rem,calc(100vw-1.5rem))]">
						<div class="grid gap-3">
							{#each toolbarGroups as group (group.id)}
								<div class="grid gap-1.5">
									<span class="px-1 text-xs font-medium text-muted-foreground">{group.label}</span>
									<div class="flex flex-wrap gap-1">
										{#each flattenGroup(group) as item (item.key)}
											<ToolbarButton
												icon={item.icon}
												label={item.label}
												active={item.active}
												disabled={item.disabled}
												on:click={() => runToolbarItem(item)}
											/>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Root>
			</div>
		</nav>
	</div>
{/if}

{#if editor && sidebarOpen}
	<!-- Below `lg` the list is over the note, so it needs a way out that does not
	     depend on the nav it is covering. -->
	<div
		class="fixed inset-0 z-20 bg-foreground/20 lg:hidden"
		role="presentation"
		transition:fade={{ duration: uiReady ? 180 : 0 }}
		on:click={dismissOverlaidSidebar}
	></div>
	<aside
		class="fixed bottom-0 left-0 top-16 z-30 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background shadow-[8px_0_30px_-12px_rgba(0,0,0,0.25)] lg:top-0 lg:max-w-none lg:shadow-none"
		aria-label="Documents"
		transition:fly={{ x: -288, duration: uiReady ? 180 : 0 }}
	>
		<div class="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold">LightNote</div>
				<div class="text-xs text-muted-foreground">
					{isSharingMode
						? `${sharedDocuments.length} shared documents`
						: `${documents.length} documents`}
				</div>
			</div>
			<Button
				variant="ghost"
				class="h-7 w-7 shrink-0 px-0"
				aria-label="Hide documents"
				on:click={toggleSidebar}
			>
				<PanelLeftClose class="h-4 w-4" />
			</Button>
		</div>
		<div
			bind:this={documentListElement}
			role="list"
			class="flex flex-1 flex-col items-stretch gap-2 overflow-y-auto p-3"
		>
			{#if isSharingMode}
				{#each sharedDocuments as document (`${document.endpoint}:${document.workspace}`)}
					<div
						class="group grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors {isActiveSharedDocument(
							document
						)
							? 'border-primary bg-secondary'
							: 'border-transparent hover:border-border hover:bg-secondary'}"
					>
						<button
							type="button"
							class="min-w-0 text-left"
							on:click={() => {
								switchSharedDocument(document);
								dismissOverlaidSidebar();
							}}
						>
							<span class="block min-h-5 break-words font-medium">{document.workspace}</span>
							<span class="mt-1 block truncate text-xs text-muted-foreground"
								>{document.endpoint}</span
							>
							<span class="mt-1 block text-xs text-muted-foreground"
								>{formatUpdatedAt(document.updatedAt)}</span
							>
						</button>
						<button
							type="button"
							aria-label={`Remove ${document.workspace}`}
							class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-background hover:text-foreground group-hover:opacity-100"
							on:click={() => deleteSharedDocumentByReference(document)}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{:else}
				{#each documents as document, index (document.id)}
					<div
						role="listitem"
						data-document-index={index}
						on:pointerdown={(event) => pressDocument(event, document.id, false)}
						class="group grid min-h-16 w-full min-w-0 select-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors {document.id ===
						currentDocument?.id
							? 'border-primary bg-secondary'
							: 'border-transparent hover:border-border hover:bg-secondary'}"
						class:opacity-50={draggingDocumentId === document.id}
					>
						<!-- Touch drags start here and nowhere else, so a finger on the card
						     still scrolls the list. `touch-none` is what lets the drag win
						     over the scroll once it does start. -->
						<button
							type="button"
							aria-label={`Reorder ${document.title || 'Untitled'}`}
							class="mt-0.5 inline-flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
							on:pointerdown={(event) => pressDocument(event, document.id, true)}
							on:keydown={(event) => moveDocumentByKey(event, document.id, index)}
						>
							<GripVertical class="h-4 w-4" />
						</button>
						{#if document.id === currentDocument?.id && editingTitleDocumentId === document.id}
							<div class="min-w-0">
								<textarea
									id={`document-title-${document.id}`}
									aria-label="Document title"
									placeholder="Untitled"
									rows="1"
									class="block w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2 py-1 text-sm font-medium ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									bind:value={documentTitle}
									on:click={(event) => event.stopPropagation()}
									on:input={handleTitleInput}
									on:change={() => void flushCurrentDocument()}
									on:blur={() => void finishTitleEditing()}
									on:keydown={handleTitleKeydown}
								></textarea>
								<span class="mt-1 block text-xs text-muted-foreground"
									>{formatUpdatedAt(document.updatedAt)}</span
								>
							</div>
						{:else if document.id === currentDocument?.id}
							<button
								type="button"
								class="min-w-0 text-left"
								on:click={() => {
									if (consumeDragClick()) {
										return;
									}

									startTitleEditing(document);
								}}
							>
								<span class="flex min-h-7 items-start gap-1">
									<span class="min-w-0 break-words py-0.5 font-medium"
										>{effectiveDocumentTitle}</span
									>
									<Pencil class="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								</span>
								<span class="mt-1 block text-xs text-muted-foreground"
									>{formatUpdatedAt(document.updatedAt)}</span
								>
							</button>
						{:else}
							<button
								type="button"
								class="min-w-0 text-left"
								on:click={() => {
									if (consumeDragClick()) {
										return;
									}

									void switchDocument(document.id);
									dismissOverlaidSidebar();
								}}
							>
								<span class="block min-h-5 break-words font-medium"
									>{document.title || 'Untitled'}</span
								>
								<span class="mt-1 block text-xs text-muted-foreground"
									>{formatUpdatedAt(document.updatedAt)}</span
								>
							</button>
						{/if}
						<button
							type="button"
							aria-label={`Delete ${document.title || 'Untitled'}`}
							class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-background hover:text-foreground group-hover:opacity-100"
							on:click={() => {
								if (consumeDragClick()) {
									return;
								}

								void deleteDocumentById(document);
							}}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</aside>
{/if}

<!-- Table tools travel with the table: the toolbar would reshuffle every time
	the cursor entered a cell. -->
<div
	class="bubble-menu gap-0.5 rounded-md border border-border p-0.5 shadow-md"
	bind:this={tableBubbleMenu}
>
	{#if editor}
		{#each tableActions as item (item.key)}
			<ToolbarButton
				icon={item.icon}
				label={item.label}
				disabled={item.disabled}
				on:click={item.onClick}
			/>
		{/each}
	{/if}
</div>

<div
	class="bubble-menu gap-0.5 rounded-md border border-border p-0.5 shadow-md"
	bind:this={bubbleMenu}
>
	{#if editor}
		<Button
			on:click={() => editor.chain().focus().toggleBold().run()}
			variant={editor.isActive('bold') ? 'default' : 'secondary'}
			class="h-8 px-2"
			aria-label="Bold"
		>
			<Bold class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleItalic().run()}
			variant={editor.isActive('italic') ? 'default' : 'secondary'}
			class="h-8 px-2"
			aria-label="Italic"
		>
			<Italic class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleStrike().run()}
			variant={editor.isActive('strike') ? 'default' : 'secondary'}
			class="h-8 px-2"
			aria-label="Strikethrough"
		>
			<Strikethrough class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleUnderline().run()}
			variant={editor.isActive('underline') ? 'default' : 'secondary'}
			class="h-8 px-2"
			aria-label="Underline"
		>
			<Underline class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleCode().run()}
			variant={editor.isActive('code') ? 'default' : 'secondary'}
			class="h-8 px-2"
			aria-label="Inline code"
		>
			<Code class="h-4 w-4" />
		</Button>
		<Button on:click={openAiPanel} class="h-8 px-2" aria-label="AI writing">
			<Sparkles class="h-4 w-4" />
		</Button>
	{/if}
</div>

<div
	class="editor-shell pt-16"
	class:ai-panel-open={aiOpen}
	class:sidebar-open={sidebarOpen && Boolean(editor)}
	class:ui-ready={uiReady}
>
	<div class="document-title px-4 pt-4 md:pt-8 {documentColumnClass}">
		{#if isSharingMode}
			<!-- A shared session is named by its workspace, and there is no local
			     document row to rename. -->
			<h1 class="break-words text-3xl font-bold md:text-4xl">{effectiveDocumentTitle}</h1>
			<!-- The page title used to be the only sign of the connection, which is
			     invisible while you are looking at the document. -->
			<p class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
				<span
					class="h-2 w-2 shrink-0 rounded-full {shareStatus === 'connected'
						? 'bg-primary'
						: shareStatus === 'reconnecting'
							? 'bg-destructive'
							: 'bg-muted-foreground'}"
					aria-hidden="true"
				></span>
				{SHARE_STATUS_LABELS[shareStatus]}
			</p>
		{:else}
			<textarea
				bind:this={documentTitleField}
				id="editor-document-title"
				aria-label="Document title"
				placeholder="Untitled"
				rows="1"
				class="block w-full resize-none overflow-hidden break-words border-0 bg-transparent p-0 text-3xl font-bold outline-none placeholder:text-muted-foreground/50 md:text-4xl"
				bind:value={documentTitle}
				on:input={handleTitleInput}
				on:change={() => void flushCurrentDocument()}
				on:blur={() => void flushCurrentDocument()}
				on:keydown={handleDocumentTitleKeydown}
			></textarea>
		{/if}
	</div>
	<div bind:this={element}></div>
</div>

<AiSettingsDialog
	bind:open={aiSettingsOpen}
	bind:apiKey={aiApiKeyInput}
	bind:model={aiModelInput}
	onSave={saveAiSettings}
/>

<Dialog.Root bind:open={shareDialogOpen} closeOnOutsideClick={false}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>Share</Dialog.Title>
			<Dialog.Description>
				Connect to a relay you run. Anyone with the endpoint and workspace name can read and edit
				the document — the workspace name is the only thing protecting it. Over HTTPS the endpoint
				must be <code>wss://</code>; a plain <code>ws://</code> address is blocked by the browser.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="endpoint" class="text-left">Endpoint</Label>
				<Input
					id="endpoint"
					placeholder="wss://relay.example.com"
					class="col-span-3"
					bind:value={_endpoint}
					on:keydown={(e) => {
						if (e.code === 'Enter') {
							e.preventDefault();
							connectToShare();
						}
					}}
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="workspace" class="text-left">Workspace</Label>
				<Input
					id="workspace"
					placeholder="workspace"
					class="col-span-3"
					bind:value={_workspace}
					on:keydown={(e) => {
						if (e.code === 'Enter') {
							e.preventDefault();
							connectToShare();
						}
					}}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button class="w-full" variant="outline" on:click={connectToShare}>Connect</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<PromptDialog
	request={promptRequest}
	bind:value={promptValue}
	error={promptError}
	onSubmit={submitPrompt}
	onClose={closePrompt}
/>

<ConfirmDialog
	request={confirmRequest}
	onConfirm={() => settleConfirm(true)}
	onCancel={() => settleConfirm(false)}
/>

{#if editor}
	<AiPromptPanel
		open={aiOpen}
		hasApiKey={aiHasApiKey}
		bind:apiKey={aiApiKeyInput}
		selection={aiSelection}
		bind:prompt={aiPrompt}
		error={aiError}
		busy={aiBusy}
		steps={aiSteps}
		agentText={aiAgentText}
		bind:autoApprove={aiAutoApprove}
		bind:allowDocumentWideEdits={aiAllowDocumentWideEdits}
		continueDocumentWideEdits={aiResume?.allowDocumentWideEdits ?? false}
		pendingApproval={aiPendingApproval}
		history={aiHistory}
		continueReason={aiResume?.reason ?? null}
		runPrompt={aiRunPrompt}
		runAction={aiRunAction}
		onClose={closeAiPanel}
		onSaveKey={saveAiKeyFromPanel}
		onAction={runAiAction}
		onRunAgent={runAiAgentTask}
		onApproval={resolveAiApproval}
		onCancel={cancelAiRequest}
		onReplaceSelection={replaceSelectionWithResult}
		onInsertAtCursor={insertResultAtCursor}
		onClearSelection={clearAiSelection}
		onOpenSettings={openAiSettings}
		onDeleteHistoryEntry={deleteAiHistoryItem}
		onClearHistory={clearAiHistoryForDocument}
		onContinue={continueAiAgentTask}
	/>
{/if}
