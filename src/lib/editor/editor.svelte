<script lang="ts">
	import './styles.scss';

	import StarterKit from '@tiptap/starter-kit';
	import { Editor } from '@tiptap/core';
	import { onMount } from 'svelte';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import Link from '@tiptap/extension-link';
	import { Button } from '@/lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: any;
	let files: FileList;

	onMount(async () => {
		const content =
			localStorage.getItem('auto-saved') ??
			'<h1>Hello,</h1><p>This is a note web app based on <a target="_blank" rel="noopener noreferrer nofollow" href="https://kit.svelte.dev">SvelteKit</a>, <a target="_blank" rel="noopener noreferrer nofollow" href="https://tiptap.dev">Tiptap</a> and <a target="_blank" rel="noopener noreferrer nofollow" href="https://ui.shadcn.com/">shadcn/ui</a>.</p><p>This note app essentially supports three types of headers, basic paragraph type, code block, unordered list, and ordered list types necessary for document creation.</p><p>Header types and basic paragraph types can be emphasized with formatting options such as <strong>bold</strong>, <em>italic</em>, and <s>strike</s>.</p><p>Links can be added or modified through the link button, and they can be removed using the link removal button.</p><p>The history feature is also provided through undo and redo actions.</p><p>Documents are basically stored in <strong>LocalStorage</strong>, and if you wish to save them permanently, you should use the provided save function to store them as HTML files. Additionally, you can upload these files to continue editing.</p><p>The theme supports both Light and Dark modes.</p><p>If you want more features, please visit the tiptap documentation and extend the functionality through extensions.</p><hr><h1><code># H1</code>: H1</h1><h2><code>## H2</code>: H2</h2><h3><code>### H3</code>: H3</h3><p><code>`code`</code>: <code>code</code></p><p><code>**bold**</code>: <strong>bold</strong></p><p><code>*italic*</code>: <em>italic</em></p><p><code>~~strike~~</code>: <s>strike</s></p><p><code>- or * unordered list</code>:</p><ul><li><p>unordered list</p></li></ul><p><code>1. ordered list</code>:</p><ol><li><p>ordered list</p></li></ol><p><code>```code block```</code>:</p><pre><code>```code block```</code></pre><p><code>&gt; block quote</code>:</p><blockquote><p>block quote</p></blockquote><p><code>---</code>:</p><hr><p><code>cmd+z</code>: undo</p><p><code>cmd+shift+z</code>: redo</p>';
		editor = new Editor({
			element: element,
			editorProps: {
				attributes: {
					class:
						'border-2 border-[#0F172A] max-md:border-none rounded-lg mt-9 max-md:p-2 p-4 outline-none'
				}
			},
			extensions: [
				StarterKit,
				BubbleMenu.configure({
					element: bubbleMenu
				}),
				Link.configure({
					openOnClick: false,
					autolink: true
				})
			],
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
	});

	function download() {
		let defaultName = `note_${Date.now()}.html`;
		let download = window.prompt('Please insert file name', defaultName);
		if (download === null || download.trim().length === 0) {
			download = defaultName;
			return;
		}
		const html = editor.getHTML();
		const style = `
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<style>
				code {
					font-family: monospace;
					background-color: rgb(97, 97, 97, 0.1);
					color: #616161;
				}
				pre {
					display: block;
					font-family: monospace;
					white-space: pre;
					background: rgb(97, 97, 97, 0.1);
					color: #616161;
					margin: 1em 0;
					padding: 1rem;
				}
				pre > code {
					color: inherit;
					padding: 0;
					background: none;
				}
				blockquote {
					padding-left: 1rem;
					border-left: 2px solid #616161;
				}
			</style>
		`;
		const element = document.createElement('a');
		const blob = new Blob([style, html], { type: 'text/html' });
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
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}
</script>

{#if editor}
	<div>
		<nav class="fixed top-0 z-10 w-full bg-white px-4 py-2 dark:bg-[#0F172A] max-md:px-2">
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				<strong>B</strong>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				<i>I</i>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				<strike>S</strike>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				<code>C</code>
			</Button>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				P
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				H1
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				H2
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				H3
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
				class="mt-0.5 h-6 px-2 text-sm max-md:hidden"
				>*UL
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				1.OL
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				variant={editor.isActive('codeBlock') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				{'{..}'}
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				{'>..'}
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="my-0.5 h-6 px-2 text-sm max-md:hidden"
			>
				--
			</Button>
			<Button
				on:click={setLink}
				variant={editor.isActive('link') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm underline">L</Button
			>
			<Button
				on:click={() => editor.chain().focus().unsetLink().run()}
				disabled={!editor.isActive('link')}
				class="my-0.5 h-6 px-2 text-sm underline"
			>
				<strike>{'L'}</strike>
			</Button>
			<Button
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
				class="my-0.5 h-6 px-2 text-sm"
			>
				←
			</Button>
			<Button
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
				class="my-0.5 h-6 px-2 text-sm"
			>
				→
			</Button>
			<Button on:click={download} class="my-0.5 h-6 px-2 text-sm">↓</Button>
			<input type="file" id="selectedFile" style="display: none;" bind:files on:change={upload} />
			<Button
				on:click={() => document.getElementById('selectedFile')?.click()}
				class="my-0.5 h-6 px-2 text-sm">↑</Button
			>
			<Button on:click={toggleMode} class="my-0.5 h-6 px-2 text-sm">⛯</Button>
		</nav>
	</div>
{/if}

<div class="bubble-menu" bind:this={bubbleMenu}>
	{#if editor}
		<button
			on:click={() => editor.chain().focus().toggleBold().run()}
			class={editor.isActive('bold') ? 'is-active' : ''}
		>
			<strong>B</strong>
		</button>
		<button
			on:click={() => editor.chain().focus().toggleItalic().run()}
			class={editor.isActive('italic') ? 'is-active' : ''}
		>
			<i>I</i>
		</button>
		<button
			on:click={() => editor.chain().focus().toggleStrike().run()}
			class={editor.isActive('strike') ? 'is-active' : ''}
		>
			<strike>S</strike>
		</button>
		<button
			on:click={() => editor.chain().focus().toggleCode().run()}
			class={editor.isActive('code') ? 'is-active' : ''}
		>
			<code>C</code>
		</button>
	{/if}
</div>

<div bind:this={element} class="p-4 max-md:px-2 max-md:pb-2 max-md:pt-4" />
