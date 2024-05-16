<script lang="ts">
	import './styles.scss';

	import { Editor, type Extensions } from '@tiptap/core';
	import { onMount } from 'svelte';
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
		Pilcrow,
		Redo,
		FileDown,
		SeparatorHorizontal,
		Strikethrough,
		SunMoon,
		TextQuote,
		Undo,
		ScreenShare,
		ScreenShareOff
	} from 'lucide-svelte';
	import {
		addImage,
		clearContent,
		download,
		endSharing,
		setLink,
		upload,
		startSharing
	} from './editor';
	import { getExtensions } from './extensions';
	import { getExtensionsOnSharing } from './sharing';
	import { defaultContent } from './constants';
	import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
	import * as Dialog from '@/lib/components/ui/dialog';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: HTMLElement;
	let files: FileList;
	let content: string = '';
	let provider: HocuspocusProvider;
	let _endpoint: string;
	let _workspace: string;

	onMount(async () => {
		const sharing = localStorage.getItem('sharing');
		let extensions: Extensions;

		if (sharing) {
			try {
				const { endpoint, workspace } = JSON.parse(sharing);
				if (!endpoint) {
					throw new Error('Invalid endpoint', { cause: 'InvalidMetadata' });
				}
				if (!workspace) {
					throw new Error('Invalid workspace', { cause: 'InvalidMetadata' });
				}
				_endpoint = endpoint;
				_workspace = workspace;
				const websocketProvider = new HocuspocusProviderWebsocket({
					url: endpoint,
					maxAttempts: 2
				});
				provider = new HocuspocusProvider({
					websocketProvider,
					name: workspace,
					onConnect() {
						window.alert(`Connected to ${endpoint}/${workspace}`);
					},
					connect: false
				});
				await provider.connect();
				extensions = getExtensionsOnSharing(provider, bubbleMenu);
			} catch (e: any) {
				if (e instanceof Error && e.cause === 'InvalidMetadata') {
					window.alert(`Failed to start sharing with ${sharing}: ${e.toString()}`);
				} else {
					window.alert(`Failed to start sharing with ${sharing}`);
				}
				console.error(e);

				localStorage.removeItem('sharing');
				location.reload();
			}
		} else {
			try {
				const shared = localStorage.getItem('shared');
				if (shared) {
					const { endpoint, workspace } = JSON.parse(shared);
					_endpoint = endpoint;
					_workspace = workspace;
				} else {
					_endpoint = '';
					_workspace = '';
				}
			} catch (e: any) {
				_endpoint = '';
				_workspace = '';
				console.error(e);
			}

			extensions = getExtensions(bubbleMenu);
			content = localStorage.getItem('auto-saved') ?? defaultContent;
		}
		editor = new Editor({
			element: element,
			editorProps: {
				attributes: {
					class: 'mt-16 md:w-[708px] md:py-8 md:px-0 md:mx-auto p-4 outline-none'
				}
			},
			extensions: extensions!,
			onUpdate({ editor }) {
				try {
					localStorage.setItem('auto-saved', editor.getHTML());
				} catch (e: any) {
					console.error(e);
				}
			},
			content,
			onTransaction: () => {
				// force re-render so `editor.isActive` works as expected
				editor = editor;
			}
		});
		editor.commands.focus();
	});
</script>

{#if editor}
	<div>
		<nav
			class="fixed left-0 top-0 z-10 flex w-full flex-row justify-start overflow-x-auto bg-white p-4 dark:bg-[color:hsl(240,10%,3.9%)] lg:justify-center"
		>
			<Button on:click={() => clearContent(editor)} class="mr-0.5 h-8 px-2"
				><BookPlus class="h-4 w-4" /></Button
			>
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
			<Button on:click={() => download(editor)} class="mx-0.5 h-8 px-2"
				><FileDown class="h-4 w-4" /></Button
			>
			<input
				type="file"
				id="selectedFile"
				style="display: none;"
				bind:files
				on:change={() => upload(editor, files)}
			/>
			<Button
				on:click={() => document.getElementById('selectedFile')?.click()}
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
							/>
						</div>
						<div class="grid grid-cols-4 items-center gap-4">
							<Label for="workspace" class="text-left">Workspace</Label>
							<Input
								id="workspace"
								placeholder="workspace"
								class="col-span-3"
								bind:value={_workspace}
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
			on:click={() => editor.chain().focus().toggleCode().run()}
			variant={editor.isActive('code') ? 'default' : 'secondary'}
			class="h-8 px-2"
		>
			<Code class="h-4 w-4" />
		</Button>
	{/if}
</div>

<div bind:this={element} />
