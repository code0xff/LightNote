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
		Pencil,
		Pilcrow,
		Redo,
		FileDown,
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
	import type { HocuspocusProvider } from '@hocuspocus/provider';
	import * as Dialog from '@/lib/components/ui/dialog';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';

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

	let title: string = 'LightNote';

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
					title = `LightNote - ${documentTitle}`;
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
		title = `LightNote - ${document.title}`;
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

	onMount(() => {
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
							title = `LightNote [${workspace}]`;
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
					title = `LightNote - ${currentDocument.title}`;
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
			class="fixed left-0 top-0 z-20 flex h-16 w-full flex-row items-center justify-start overflow-x-auto border-b border-border bg-background px-3 py-3 lg:left-72 lg:w-[calc(100%-18rem)] lg:px-4"
		>
			<Button on:click={createNewDocument} disabled={isSharingMode} class="mr-0.5 h-8 px-2">
				<BookPlus class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Bold class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Italic class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleUnderline().run()}
				disabled={!editor.can().chain().focus().toggleUnderline().run()}
				variant={editor.isActive('underline') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Underline class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Strikethrough class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Code class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Pilcrow class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Heading1 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Heading2 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Heading3 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('left').run()}
				class="mx-0.5 h-8 px-2"
				variant={editor.isActive({ textAlign: 'left' }) ? 'default' : 'secondary'}
			>
				<AlignLeft class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('center').run()}
				class="mx-0.5 h-8 px-2"
				variant={editor.isActive({ textAlign: 'center' }) ? 'default' : 'secondary'}
			>
				<AlignCenter class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('right').run()}
				class="mx-0.5 h-8 px-2"
				variant={editor.isActive({ textAlign: 'right' }) ? 'default' : 'secondary'}
			>
				<AlignRight class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
				><List class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<ListOrdered class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				variant={editor.isActive('codeBlock') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<Braces class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"
			>
				<TextQuote class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="mx-0.5 h-8 px-2"
			>
				<SeparatorHorizontal class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => setLink(editor)}
				variant={editor.isActive('link') ? 'default' : 'secondary'}
				class="mx-0.5 h-8 px-2"><Link2 class="h-4 w-4" /></Button
			>
			<Button
				on:click={() => editor.chain().focus().unsetLink().run()}
				disabled={!editor.isActive('link')}
				class="mx-0.5 h-8 px-2"
			>
				<Link2Off class="h-4 w-4" />
			</Button>
			<Button on:click={() => addImage(editor)} class="mx-0.5 h-8 px-2"
				><ImagePlus class="h-4 w-4" /></Button
			>
			<Button on:click={() => addYoutube(editor)} class="mx-0.5 h-8 px-2"
				><MonitorPlay class="h-4 w-4" /></Button
			>
			<Button
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
				class="mx-0.5 h-8 px-2"
			>
				<Undo class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
				class="mx-0.5 h-8 px-2"
			>
				<Redo class="h-4 w-4" />
			</Button>
			<Button on:click={() => download(editor, currentDocument?.title)} class="mx-0.5 h-8 px-2"
				><FileDown class="h-4 w-4" /></Button
			>
			<input
				type="file"
				id="selectedFile"
				accept=".html,.htm,text/html"
				style="display: none;"
				bind:files
				on:change={importDocument}
			/>
			<Button
				on:click={() => document.getElementById('selectedFile')?.click()}
				disabled={isSharingMode}
				class="mx-0.5 h-8 px-2"><FileUp class="h-4 w-4" /></Button
			>
			<Dialog.Root closeOnOutsideClick={false}>
				<Dialog.Trigger>
					<Button class="mx-0.5 h-8 px-2">
						<ScreenShare class="h-4 w-4" />
					</Button>
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-[425px]">
					<Dialog.Header>
						<Dialog.Title>Share</Dialog.Title>
						<Dialog.Description
							>Please input relay server endpoint and workspace name</Dialog.Description
						>
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
						<Button
							class="w-full"
							variant="outline"
							on:click={() => startSharing(_endpoint, _workspace)}>Connect</Button
						>
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog.Root>
			<Button on:click={() => endSharing(provider)} disabled={!provider} class="mx-0.5 h-8 px-2"
				><ScreenShareOff class="h-4 w-4" /></Button
			>
			<Button on:click={toggleMode} class="ml-0.5 h-8 px-2"><SunMoon class="h-4 w-4" /></Button>
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
		>
			<Bold class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleItalic().run()}
			variant={editor.isActive('italic') ? 'default' : 'secondary'}
			class="h-8 px-2"
		>
			<Italic class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleStrike().run()}
			variant={editor.isActive('strike') ? 'default' : 'secondary'}
			class="h-8 px-2"
		>
			<Strikethrough class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleUnderline().run()}
			variant={editor.isActive('underline') ? 'default' : 'secondary'}
			class="h-8 px-2"
		>
			<Underline class="h-4 w-4" />
		</Button>
		<Button
			on:click={() => editor.chain().focus().toggleCode().run()}
			variant={editor.isActive('code') ? 'default' : 'secondary'}
			class="h-8 px-2"
		>
			<Code class="h-4 w-4" />
		</Button>
	{/if}
</div>

<div bind:this={element} />
