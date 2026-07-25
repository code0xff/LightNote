<script lang="ts">
	import './styles.scss';

	import { Editor, type Extensions, type JSONContent } from '@tiptap/core';
	import { onMount, tick } from 'svelte';
	import { Button } from '@/lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';
	import {
		AlignCenter,
		AlignLeft,
		AlignRight,
		Bold,
		BookPlus,
		Braces,
		Code,
		FileUp,
		Heading1,
		Heading2,
		Heading3,
		ImagePlus,
		Italic,
		Link2,
		Link2Off,
		List,
		ListOrdered,
		MoreHorizontal,
		Pencil,
		Pilcrow,
		Redo,
		FileDown,
		Settings2,
		Sparkles,
		Trash2,
		SeparatorHorizontal,
		Strikethrough,
		SunMoon,
		TextQuote,
		Undo,
		ScreenShare,
		ScreenShareOff,
		MonitorPlay,
		Underline
	} from 'lucide-svelte';
	import {
		addImage,
		addYoutube,
		buildShareUrl,
		download,
		endSharing,
		readUploadedDocument,
		readSharedDocumentHistory,
		readSharedMetadata,
		removeSharedDocumentHistory,
		setLink,
		startSharing,
		upsertSharedDocumentHistory,
		type SharedDocumentReference,
		validateShareMetadata
	} from './editor';
	import {
		createDocument,
		deleteDocument,
		ensureInitialDocument,
		getDocument,
		listDocuments,
		setStoredCurrentDocumentId,
		updateDocument,
		type LightNoteDocument
	} from '$lib/documents/store';
	import { getExtensions } from './extensions';
	import {
		DEFAULT_OPENAI_MODEL,
		generateText,
		readOpenAiSettings,
		toEditorHtml,
		writeOpenAiSettings,
		type AiAction,
		type OpenAiSettings
	} from '$lib/ai/openai';
	import { checkAiRequest } from '$lib/ai/actions';
	import AiSettingsDialog from './AiSettingsDialog.svelte';
	import AiPromptPanel from './AiPromptPanel.svelte';
	import ToolbarButton from './ToolbarButton.svelte';
	import type { HocuspocusProvider } from '@hocuspocus/provider';
	import * as Dialog from '@/lib/components/ui/dialog';
	import * as Popover from '@/lib/components/ui/popover';
	import { buttonVariants } from '@/lib/components/ui/button';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';
	import type { ComponentType } from 'svelte';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: HTMLElement;
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
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveQueue: Promise<void> = Promise.resolve();
	let editingTitleDocumentId: string | null = null;
	let shareDialogOpen = false;
	let toolbarOverflowOpen = false;

	type ToolbarItem = {
		key: string;
		label: string;
		icon: ComponentType;
		onClick: () => void;
		active?: boolean;
		disabled?: boolean;
		primary?: boolean;
	};
	type ToolbarGroup = { id: string; label: string; items: ToolbarItem[] };

	let aiSettings: OpenAiSettings = { apiKey: '', model: DEFAULT_OPENAI_MODEL };
	let aiSettingsOpen = false;
	let aiApiKeyInput = '';
	let aiModelInput = DEFAULT_OPENAI_MODEL;
	let aiOpen = false;
	let aiSelection = '';
	let aiSelectionRange: { from: number; to: number } | null = null;
	let aiPrompt = '';
	let aiResult = '';
	let aiError = '';
	let aiBusy = false;
	let aiController: AbortController | undefined;

	$: aiHasApiKey = Boolean(aiSettings.apiKey);

	let title: string = 'LightNote';

	function formatPageTitle(name?: string) {
		const normalizedName = name?.trim();

		return normalizedName ? `LightNote - ${normalizedName}` : 'LightNote';
	}

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
			(event.currentTarget as HTMLInputElement | null)?.blur();
		}
	}

	async function startTitleEditing(documentToEdit: LightNoteDocument) {
		if (documentToEdit.id !== currentDocument?.id) {
			return;
		}

		editingTitleDocumentId = documentToEdit.id;
		await tick();

		const input = window.document.getElementById(
			`document-title-${documentToEdit.id}`
		) as HTMLInputElement | null;

		input?.focus();
		input?.select();
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

		const documentId = currentDocument.id;
		const content = editor.getJSON();
		const nextTitle = saveTitle ? documentTitle : undefined;

		saveTimer = setTimeout(() => {
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

				if (currentDocument?.id === documentId) {
					currentDocument = {
						...updated,
						title: documentTitle
					};
					title = formatPageTitle(documentTitle);
				}

				documents = documents.map((document) =>
					document.id === documentId
						? {
								...updated,
								title: currentDocument?.id === documentId ? documentTitle : updated.title
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

		if (!isSharingMode && currentDocument && editor) {
			await queueDocumentSave(currentDocument.id, editor.getJSON(), documentTitle);
		}
	}

	function setActiveDocument(document: LightNoteDocument) {
		currentDocument = document;
		documentTitle = document.title;
		title = formatPageTitle(document.title);
		setStoredCurrentDocumentId(document.id);

		if (editor) {
			editor.commands.setContent(document.content, false);
			editor.commands.focus();
		}
	}

	async function refreshDocuments() {
		documents = await listDocuments();
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
		} catch (error) {
			window.alert('Failed to create document');
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
			window.alert('Failed to open document');
			console.error(error);
		}
	}

	async function deleteDocumentById(documentToDelete: LightNoteDocument) {
		if (!window.confirm(`Delete "${documentToDelete.title || 'Untitled'}"?`)) {
			return;
		}

		try {
			const deletingCurrentDocument = currentDocument?.id === documentToDelete.id;

			await deleteDocument(documentToDelete.id);

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
			window.alert('Failed to delete document');
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

	function deleteSharedDocumentByReference(document: SharedDocumentReference) {
		if (!window.confirm(`Remove "${document.workspace}" from recent shared documents?`)) {
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
			window.alert(error instanceof Error ? error.message : 'Failed to upload file');
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
			aiSelection = '';
			aiSelectionRange = null;
			return;
		}

		const { from, to } = editor.state.selection;
		const text = editor.state.doc.textBetween(from, to, '\n').trim();

		aiSelection = text;
		aiSelectionRange = text ? { from, to } : null;
	}

	function clearAiSelection() {
		aiSelection = '';
		aiSelectionRange = null;
	}

	function getContextBeforeCursor(limit = 4000) {
		if (!editor) {
			return '';
		}

		const { from } = editor.state.selection;

		return editor.state.doc.textBetween(Math.max(0, from - limit), from, '\n').trim();
	}

	function openAiPanel() {
		aiSettings = readOpenAiSettings();
		aiApiKeyInput = aiSettings.apiKey;
		aiModelInput = aiSettings.model;
		captureSelection();
		aiError = '';
		aiBusy = false;
		aiOpen = true;
	}

	function closeAiPanel() {
		aiOpen = false;
	}

	function saveAiKeyFromPanel() {
		if (!aiApiKeyInput.trim()) {
			return;
		}

		aiSettings = writeOpenAiSettings({ apiKey: aiApiKeyInput, model: aiModelInput });
		aiError = '';
	}

	async function runAiAction(action: AiAction) {
		const check = checkAiRequest({
			action,
			hasApiKey: Boolean(aiSettings.apiKey),
			selection: aiSelection,
			prompt: aiPrompt
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

		aiBusy = true;
		aiError = '';
		aiResult = '';
		aiController = new AbortController();

		try {
			aiResult = await generateText({
				action,
				settings: aiSettings,
				selection: aiSelection,
				context: getContextBeforeCursor(),
				instruction: aiPrompt,
				signal: aiController.signal
			});
		} catch (error) {
			if ((error as Error)?.name === 'AbortError') {
				return;
			}

			aiError = error instanceof Error ? error.message : 'AI request failed';
		} finally {
			aiBusy = false;
			aiController = undefined;
		}
	}

	function cancelAiRequest() {
		aiController?.abort();
		aiBusy = false;
	}

	function replaceSelectionWithResult() {
		if (!editor || !aiResult) {
			return;
		}

		const html = toEditorHtml(aiResult);

		if (aiSelectionRange) {
			editor.chain().focus().insertContentAt(aiSelectionRange, html).run();
		} else {
			editor.chain().focus().insertContent(html).run();
		}

		aiResult = '';
		clearAiSelection();
	}

	function insertResultAtCursor() {
		if (!editor || !aiResult) {
			return;
		}

		const at = aiSelectionRange ? aiSelectionRange.to : editor.state.selection.to;

		editor.chain().focus().insertContentAt(at, toEditorHtml(aiResult)).run();
		aiResult = '';
		clearAiSelection();
	}

	/**
	 * Build the toolbar as grouped data so it can render two ways from one
	 * source: the full grouped bar on desktop and a compact primary set plus an
	 * overflow menu on mobile. Active/disabled states are computed eagerly and
	 * recomputed whenever `editor` is reassigned (see the `onTransaction` hook).
	 */
	function buildToolbarGroups(
		activeEditor: Editor,
		sharing: boolean,
		activeProvider: HocuspocusProvider | undefined,
		doc: LightNoteDocument | null
	): ToolbarGroup[] {
		return [
			{
				id: 'doc',
				label: 'Document',
				items: [
					{
						key: 'new',
						label: 'New document',
						icon: BookPlus,
						onClick: createNewDocument,
						disabled: sharing,
						primary: true
					}
				]
			},
			{
				id: 'format',
				label: 'Format',
				items: [
					{
						key: 'bold',
						label: 'Bold',
						icon: Bold,
						onClick: () => activeEditor.chain().focus().toggleBold().run(),
						active: activeEditor.isActive('bold'),
						disabled: !activeEditor.can().chain().focus().toggleBold().run(),
						primary: true
					},
					{
						key: 'italic',
						label: 'Italic',
						icon: Italic,
						onClick: () => activeEditor.chain().focus().toggleItalic().run(),
						active: activeEditor.isActive('italic'),
						disabled: !activeEditor.can().chain().focus().toggleItalic().run(),
						primary: true
					},
					{
						key: 'underline',
						label: 'Underline',
						icon: Underline,
						onClick: () => activeEditor.chain().focus().toggleUnderline().run(),
						active: activeEditor.isActive('underline'),
						disabled: !activeEditor.can().chain().focus().toggleUnderline().run()
					},
					{
						key: 'strike',
						label: 'Strikethrough',
						icon: Strikethrough,
						onClick: () => activeEditor.chain().focus().toggleStrike().run(),
						active: activeEditor.isActive('strike'),
						disabled: !activeEditor.can().chain().focus().toggleStrike().run()
					},
					{
						key: 'code',
						label: 'Inline code',
						icon: Code,
						onClick: () => activeEditor.chain().focus().toggleCode().run(),
						active: activeEditor.isActive('code'),
						disabled: !activeEditor.can().chain().focus().toggleCode().run()
					}
				]
			},
			{
				id: 'heading',
				label: 'Headings',
				items: [
					{
						key: 'paragraph',
						label: 'Paragraph',
						icon: Pilcrow,
						onClick: () => activeEditor.chain().focus().setParagraph().run(),
						active: activeEditor.isActive('paragraph')
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
					}
				]
			},
			{
				id: 'align',
				label: 'Alignment',
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
			},
			{
				id: 'blocks',
				label: 'Lists & blocks',
				items: [
					{
						key: 'bullet-list',
						label: 'Bullet list',
						icon: List,
						onClick: () => activeEditor.chain().focus().toggleBulletList().run(),
						active: activeEditor.isActive('bulletList'),
						primary: true
					},
					{
						key: 'ordered-list',
						label: 'Ordered list',
						icon: ListOrdered,
						onClick: () => activeEditor.chain().focus().toggleOrderedList().run(),
						active: activeEditor.isActive('orderedList')
					},
					{
						key: 'code-block',
						label: 'Code block',
						icon: Braces,
						onClick: () => activeEditor.chain().focus().toggleCodeBlock().run(),
						active: activeEditor.isActive('codeBlock')
					},
					{
						key: 'blockquote',
						label: 'Blockquote',
						icon: TextQuote,
						onClick: () => activeEditor.chain().focus().toggleBlockquote().run(),
						active: activeEditor.isActive('blockquote')
					},
					{
						key: 'hr',
						label: 'Horizontal rule',
						icon: SeparatorHorizontal,
						onClick: () => activeEditor.chain().focus().setHorizontalRule().run()
					}
				]
			},
			{
				id: 'insert',
				label: 'Insert',
				items: [
					{
						key: 'link',
						label: 'Add or edit link',
						icon: Link2,
						onClick: () => setLink(activeEditor),
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
						label: 'Insert image',
						icon: ImagePlus,
						onClick: () => addImage(activeEditor)
					},
					{
						key: 'youtube',
						label: 'Insert YouTube video',
						icon: MonitorPlay,
						onClick: () => addYoutube(activeEditor)
					}
				]
			},
			{
				id: 'history',
				label: 'History',
				items: [
					{
						key: 'undo',
						label: 'Undo',
						icon: Undo,
						onClick: () => activeEditor.chain().focus().undo().run(),
						disabled: !activeEditor.can().chain().focus().undo().run()
					},
					{
						key: 'redo',
						label: 'Redo',
						icon: Redo,
						onClick: () => activeEditor.chain().focus().redo().run(),
						disabled: !activeEditor.can().chain().focus().redo().run()
					}
				]
			},
			{
				id: 'file',
				label: 'File',
				items: [
					{
						key: 'download',
						label: 'Download as HTML',
						icon: FileDown,
						onClick: () => download(activeEditor, doc?.title)
					},
					{
						key: 'import',
						label: 'Import HTML file',
						icon: FileUp,
						onClick: () => window.document.getElementById('selectedFile')?.click(),
						disabled: sharing
					}
				]
			},
			{
				id: 'share',
				label: 'Share',
				items: [
					{
						key: 'share',
						label: 'Share',
						icon: ScreenShare,
						onClick: () => (shareDialogOpen = true)
					},
					{
						key: 'stop-share',
						label: 'Stop sharing',
						icon: ScreenShareOff,
						onClick: () => endSharing(activeProvider),
						disabled: !activeProvider
					}
				]
			},
			{
				id: 'ai',
				label: 'AI',
				items: [
					{
						key: 'ai-writing',
						label: 'AI writing',
						icon: Sparkles,
						onClick: openAiPanel,
						primary: true
					},
					{
						key: 'ai-settings',
						label: 'AI settings',
						icon: Settings2,
						onClick: openAiSettings
					}
				]
			},
			{
				id: 'view',
				label: 'View',
				items: [
					{
						key: 'theme',
						label: 'Toggle theme',
						icon: SunMoon,
						onClick: toggleMode
					}
				]
			}
		];
	}

	$: toolbarGroups = editor
		? buildToolbarGroups(editor, isSharingMode, provider, currentDocument)
		: [];
	$: primaryToolbarItems = toolbarGroups.flatMap((group) =>
		group.items.filter((item) => item.primary)
	);

	function runToolbarItem(item: ToolbarItem) {
		item.onClick();
		toolbarOverflowOpen = false;
	}

	onMount(() => {
		aiSettings = readOpenAiSettings();

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
						maxAttempts: 1
					});
					const reconnectKey = `reconnect:${endpoint}:${workspace}`;

					provider = new HocuspocusProvider({
						websocketProvider,
						name: workspace,
						onConnect() {
							sessionStorage.removeItem(reconnectKey);
							localStorage.setItem('connected', JSON.stringify({ endpoint, workspace }));
							title = formatPageTitle(workspace);
						},
						onClose() {
							title = 'LightNote';
							if (!sessionStorage.getItem(reconnectKey) && localStorage.getItem('connected')) {
								sessionStorage.setItem(reconnectKey, 'true');
								location.replace(
									buildShareUrl(location.origin, location.pathname, { endpoint, workspace })
								);
								return;
							}

							localStorage.removeItem('connected');
							sessionStorage.removeItem(reconnectKey);
							window.alert(`Failed to connect to ${endpoint}/${workspace}`);
							location.replace(`${location.origin}${location.pathname}`);
						},
						connect: false
					});
					await provider.connect();

					localStorage.setItem('shared', JSON.stringify({ endpoint, workspace }));
					sharedDocuments = upsertSharedDocumentHistory({ endpoint, workspace });

					extensions = await getExtensionsOnSharing(provider, bubbleMenu);
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Unknown error';

					window.alert(`Failed to start sharing with ${location.search}: ${message}`);
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

					extensions = getExtensions(bubbleMenu);
					currentDocument = await ensureInitialDocument();
					documentTitle = currentDocument.title;
					content = currentDocument.content;
					title = formatPageTitle(currentDocument.title);
					documents = await listDocuments();
				} catch (error) {
					window.alert(error instanceof Error ? error.message : 'Failed to load documents');
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
						class:
							'mt-40 p-4 outline-none md:w-[708px] md:py-8 md:px-0 md:mx-auto lg:ml-[calc(18rem+(100vw-18rem-708px)/2)] lg:mt-16'
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
				}
			});
			editor.commands.focus();
		}

		void initializeEditor();

		return () => {
			disposed = true;
			if (saveTimer) {
				clearTimeout(saveTimer);
			}
			editor?.destroy();
			(provider as (HocuspocusProvider & { destroy?: () => void }) | undefined)?.destroy?.();
		};
	});
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

{#if editor}
	<div>
		<nav
			class="fixed left-0 top-0 z-20 flex h-16 w-full flex-row items-center border-b border-border bg-background px-3 py-3 lg:left-72 lg:w-[calc(100%-18rem)] lg:px-4"
		>
			<input
				type="file"
				id="selectedFile"
				accept=".html,.htm,text/html"
				style="display: none;"
				bind:files
				on:change={importDocument}
			/>

			<!-- Desktop: full grouped toolbar -->
			<div class="hidden w-full items-center overflow-x-auto lg:flex">
				{#each toolbarGroups as group, groupIndex (group.id)}
					{#if groupIndex > 0}
						<div class="mx-1.5 h-6 w-px shrink-0 bg-border" aria-hidden="true"></div>
					{/if}
					<div class="flex shrink-0 items-center gap-0.5">
						{#each group.items as item (item.key)}
							<ToolbarButton
								icon={item.icon}
								label={item.label}
								active={item.active}
								disabled={item.disabled}
								on:click={item.onClick}
							/>
						{/each}
					</div>
				{/each}
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
										{#each group.items as item (item.key)}
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

{#if editor}
	<aside
		class="fixed left-0 top-16 z-10 flex h-24 w-full flex-col border-b border-border bg-background lg:bottom-0 lg:top-0 lg:z-30 lg:h-auto lg:w-72 lg:border-b-0 lg:border-r"
	>
		<div class="hidden h-16 items-center justify-between border-b border-border px-4 lg:flex">
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold">LightNote</div>
				<div class="text-xs text-muted-foreground">
					{isSharingMode
						? `${sharedDocuments.length} shared documents`
						: `${documents.length} documents`}
				</div>
			</div>
		</div>
		<div
			class="flex flex-1 items-start gap-2 overflow-x-auto p-3 lg:flex-col lg:items-stretch lg:overflow-y-auto"
		>
			{#if isSharingMode}
				{#each sharedDocuments as document (`${document.endpoint}:${document.workspace}`)}
					<div
						class="group grid min-h-16 w-48 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors lg:w-full lg:min-w-0 {isActiveSharedDocument(
							document
						)
							? 'border-primary bg-secondary'
							: 'border-transparent hover:border-border hover:bg-secondary'}"
					>
						<button
							type="button"
							class="min-w-0 text-left"
							on:click={() => switchSharedDocument(document)}
						>
							<span class="block min-h-5 truncate font-medium">{document.workspace}</span>
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
				{#each documents as document (document.id)}
					<div
						class="group grid min-h-16 w-48 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors lg:w-full lg:min-w-0 {document.id ===
						currentDocument?.id
							? 'border-primary bg-secondary'
							: 'border-transparent hover:border-border hover:bg-secondary'}"
					>
						{#if document.id === currentDocument?.id && editingTitleDocumentId === document.id}
							<div class="min-w-0">
								<Input
									id={`document-title-${document.id}`}
									aria-label="Document title"
									placeholder="Untitled"
									class="h-7 px-2 py-1 text-sm font-medium"
									bind:value={documentTitle}
									on:click={(event) => event.stopPropagation()}
									on:input={() => scheduleCurrentDocumentSave(true)}
									on:change={() => void flushCurrentDocument()}
									on:blur={() => void finishTitleEditing()}
									on:keydown={handleTitleKeydown}
								/>
								<span class="mt-1 block text-xs text-muted-foreground"
									>{formatUpdatedAt(document.updatedAt)}</span
								>
							</div>
						{:else if document.id === currentDocument?.id}
							<button
								type="button"
								class="min-w-0 text-left"
								on:click={() => startTitleEditing(document)}
							>
								<span class="flex min-h-7 items-center gap-1">
									<span class="truncate font-medium">{documentTitle || 'Untitled'}</span>
									<Pencil class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								</span>
								<span class="mt-1 block text-xs text-muted-foreground"
									>{formatUpdatedAt(document.updatedAt)}</span
								>
							</button>
						{:else}
							<button
								type="button"
								class="min-w-0 text-left"
								on:click={() => switchDocument(document.id)}
							>
								<span class="block min-h-5 truncate font-medium"
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
							on:click={() => deleteDocumentById(document)}
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</aside>
{/if}

<div class="bubble-menu rounded-md" bind:this={bubbleMenu}>
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

<div bind:this={element} />

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
			<Dialog.Description>Please input relay server endpoint and workspace name</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="endpoint" class="text-left">Endpoint</Label>
				<Input
					id="endpoint"
					placeholder="ws://localhost:1234"
					class="col-span-3"
					bind:value={_endpoint}
					on:keydown={(e) => {
						if (e.code === 'Enter') {
							e.preventDefault();
							startSharing(_endpoint, _workspace);
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
							startSharing(_endpoint, _workspace);
						}
					}}
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button class="w-full" variant="outline" on:click={() => startSharing(_endpoint, _workspace)}
				>Connect</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if editor}
	<AiPromptPanel
		open={aiOpen}
		hasApiKey={aiHasApiKey}
		bind:apiKey={aiApiKeyInput}
		selection={aiSelection}
		bind:prompt={aiPrompt}
		result={aiResult}
		error={aiError}
		busy={aiBusy}
		onOpen={openAiPanel}
		onClose={closeAiPanel}
		onSaveKey={saveAiKeyFromPanel}
		onAction={runAiAction}
		onCancel={cancelAiRequest}
		onReplaceSelection={replaceSelectionWithResult}
		onInsertAtCursor={insertResultAtCursor}
		onClearSelection={clearAiSelection}
		onOpenSettings={openAiSettings}
	/>
{/if}
