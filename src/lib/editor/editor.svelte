<script lang="ts">
	import './styles.scss';

	import StarterKit from '@tiptap/starter-kit';
	import { Editor } from '@tiptap/core';
	import { onMount } from 'svelte';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import { Button } from '@/lib/components/ui/button';
	import { toggleMode } from 'mode-watcher';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: any;
	let files: FileList;

	onMount(async () => {
		const content =
			localStorage.getItem('auto-saved') ??
			`
            <h2>
              Hi there,
            </h2>
            <p>
              this is a <em>basic</em> example of <strong>tiptap</strong>. Sure, there are all kind of basic text styles you’d probably expect from a text editor. But wait until you see the lists:
            </p>
            <ul>
              <li>
                That’s a bullet list with one …
              </li>
              <li>
                … or two list items.
              </li>
            </ul>
            <p>
              Isn’t that great? And all of that is editable. But wait, there’s more. Let’s try a code block:
            </p>
            <pre><code class='language-css'>body {
        display: none;
      }</code></pre>
            <p>
              I know, I know, this is impressive. It’s only the tip of the iceberg though. Give it a try and click a little bit around. Don’t forget to check the other examples too.
            </p>
            <blockquote>
              Wow, that’s amazing. Good work, boy! 👏
              <br />
              — Mom
            </blockquote>
          `;
		editor = new Editor({
			element: element,
			editorProps: {
				attributes: {
					class: 'border-2 border-[#0F172A] rounded-lg mt-16 md:mt-9 p-4 outline-none'
				}
			},
			extensions: [
				StarterKit,
				BubbleMenu.configure({
					element: bubbleMenu
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
		const html = editor.getHTML();
		const element = document.createElement('a');
		element.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(html);
		element.download = `note_${Date.now()}.html`;
		element.click();
	}

	async function upload() {
		if (files) {
			editor.commands.setContent(await files[0].text());
		}
	}
</script>

{#if editor}
	<div>
		<nav class="fixed top-0 z-10 w-full bg-white px-4 py-2 dark:bg-[#0F172A]">
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				<strong>B</strong>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				<i>I</i>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				<strike>S</strike>
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				{'{}'}
			</Button>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				p
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				h1
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				h2
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				h3
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
				class="mt-0.5 h-6 px-2 text-sm"
				>-ul
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				1.ol
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				variant={editor.isActive('codeBlock') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				{'{...}'}
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'secondary'}
				class="my-0.5 h-6 px-2 text-sm"
			>
				|...
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="my-0.5 h-6 px-2 text-sm"
			>
				--
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHardBreak().run()}
				class="my-0.5 h-6 px-2 text-sm">Ent</Button
			>
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
			Bold
		</button>
		<button
			on:click={() => editor.chain().focus().toggleItalic().run()}
			class={editor.isActive('italic') ? 'is-active' : ''}
		>
			Italic
		</button>
		<button
			on:click={() => editor.chain().focus().toggleStrike().run()}
			class={editor.isActive('strike') ? 'is-active' : ''}
		>
			Strike
		</button>
	{/if}
</div>

<div bind:this={element} class="p-4" />
