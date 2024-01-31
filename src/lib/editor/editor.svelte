<script lang="ts">
	import './styles.scss';

	import StarterKit from '@tiptap/starter-kit';
	import { Editor } from '@tiptap/core';
	import { onMount } from 'svelte';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import Link from '@tiptap/extension-link';
	import { Button } from '@/lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';
	import Image from '@tiptap/extension-image';
	import TextAlign from '@tiptap/extension-text-align';
	import Placeholder from '@tiptap/extension-placeholder';
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
		Undo
	} from 'lucide-svelte';
	import Collaboration from '@tiptap/extension-collaboration';
	import { HocuspocusProvider } from '@hocuspocus/provider';
	import { defaultText, htmlStyle } from './constants';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: any;
	let files: FileList;

	export let ws: string | null = null;
	export let id: string | null = null;

	let provider: HocuspocusProvider;

	onMount(async () => {
		const content = localStorage.getItem('auto-saved') ?? defaultText;
		const collaboration: boolean = ws !== null && id !== null;
		let extensions = [
			StarterKit.configure({
				history: collaboration ? undefined : false
			}),
			BubbleMenu.configure({
				element: bubbleMenu
			}),
			Link.configure({
				openOnClick: false,
				autolink: true
			}),
			Image.configure({
				inline: true
			}),
			TextAlign.configure({
				types: ['heading', 'paragraph']
			}),
			Placeholder
		];

		if (collaboration) {
			// Set up the Hocuspocus WebSocket provider
			provider = new HocuspocusProvider({
				url: ws,
				name: id
			});
			extensions.push(
				Collaboration.configure({
					document: provider.document
				})
			);
		}

		editor = new Editor({
			element: element,
			editorProps: {
				attributes: {
					class: 'mt-9 max-md:h-8 px-2 p-4 outline-none'
				}
			},
			extensions,
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

	function download() {
		let defaultName = `note_${Date.now()}.html`;
		let download = window.prompt('Please insert file name', defaultName);
		if (download === null || download.trim().length === 0) {
			download = defaultName;
			return;
		}
		const html = editor.getHTML();
		const element = document.createElement('a');
		const blob = new Blob([htmlStyle, html], { type: 'text/html;charset=utf-8' });
		element.setAttribute('href', window.URL.createObjectURL(blob));
		element.setAttribute('download', download);
		element.click();
	}

	async function upload() {
		if (files) {
			editor.commands.setContent(await files[0].text());
		}
	}

	function setLink() {
		const previousUrl = editor.getAttributes('link').href;
		const url = window.prompt('Please insert link url', previousUrl);

		if (url === null) {
			return;
		}
		if (url.trim().length === 0) {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}

	function clearContent() {
		editor.commands.clearContent();
		editor.commands.focus();
	}

	function addImage() {
		const url = window.prompt('Please insert image url');
		if (url === null || url.trim().length === 0) {
			return;
		}
		editor.chain().focus().setImage({ src: url }).run();
	}
</script>

{#if editor}
	<div>
		<nav
			class="fixed top-0 z-10 w-full bg-white px-4 py-2 dark:bg-[color:hsl(240,10%,3.9%)] max-md:px-2"
		>
			<Button on:click={clearContent} class="h-8 px-2 max-lg:hidden"
				><BookPlus class="h-4 w-4" /></Button
			>
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Bold class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Italic class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Strikethrough class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Code class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Pilcrow class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Heading1 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Heading2 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Heading3 class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('left').run()}
				class="h-8 px-2 max-lg:hidden"
				variant={editor.isActive({ textAlign: 'left' }) ? 'default' : 'secondary'}
			>
				<AlignLeft class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('center').run()}
				class="h-8 px-2 max-lg:hidden"
				variant={editor.isActive({ textAlign: 'center' }) ? 'default' : 'secondary'}
			>
				<AlignCenter class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setTextAlign('right').run()}
				class="h-8 px-2 max-lg:hidden"
				variant={editor.isActive({ textAlign: 'right' }) ? 'default' : 'secondary'}
			>
				<AlignRight class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
				><List class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<ListOrdered class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				variant={editor.isActive('codeBlock') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<Braces class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'secondary'}
				class="h-8 px-2 max-lg:hidden"
			>
				<TextQuote class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="h-8 px-2 max-lg:hidden"
			>
				<SeparatorHorizontal class="h-4 w-4" />
			</Button>
			<Button
				on:click={setLink}
				variant={editor.isActive('link') ? 'default' : 'secondary'}
				class="h-8 px-2"><Link2 class="h-4 w-4" /></Button
			>
			<Button
				on:click={() => editor.chain().focus().unsetLink().run()}
				disabled={!editor.isActive('link')}
				class="h-8 px-2 max-lg:hidden"
			>
				<Link2Off class="h-4 w-4" />
			</Button>
			<Button on:click={addImage} class="h-8 px-2"><ImagePlus class="h-4 w-4" /></Button>
			<Button
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
				class="h-8 px-2"
			>
				<Undo class="h-4 w-4" />
			</Button>
			<Button
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
				class="h-8 px-2"
			>
				<Redo class="h-4 w-4" />
			</Button>
			<Button on:click={download} class="h-8 px-2"><FileDown class="h-4 w-4" /></Button>
			<input type="file" id="selectedFile" style="display: none;" bind:files on:change={upload} />
			<Button on:click={() => document.getElementById('selectedFile')?.click()} class="h-8 px-2"
				><FileUp class="h-4 w-4" /></Button
			>
			<Button on:click={toggleMode} class="h-8 px-2"><SunMoon class="h-4 w-4" /></Button>
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
			class="h-8 px-2 max-lg:hidden"
		>
			<Code class="h-4 w-4" />
		</Button>
	{/if}
</div>

<div bind:this={element} class="p-4 max-md:px-2 max-md:pb-2 max-md:pt-4" />
