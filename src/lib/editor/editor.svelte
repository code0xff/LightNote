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
					class: 'border-2 border-[#0F172A] rounded-lg mt-2 md:mt-4 p-4 outline-none mx-0.5'
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
		const blob = new Blob([html], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const ele = document.createElement('a');
		ele.href = url;
		ele.download = `note_${Date.now()}.html`;
		ele.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function upload() {
		if (files) {
			editor.commands.setContent(await files[0].text());
		}
	}
</script>

{#if editor}
	<div>
		<div>
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				bold
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				italic
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				strike
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				code
			</Button>
			<Button
				on:click={() => editor.chain().focus().unsetAllMarks().run()}
				class="m-0.5 h-6 px-2 text-sm">clear marks</Button
			>
			<Button
				on:click={() => editor.chain().focus().clearNodes().run()}
				class="m-0.5 h-6 px-2 text-sm">clear nodes</Button
			>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				paragraph
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				h1
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				h2
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				h3
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				bullet list
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				ordered list
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				class={(editor.isActive('codeBlock') ? 'secondary' : 'outline') + ' m-0.5 h-6 px-2 text-sm'}
			>
				code block
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'secondary'}
				class="m-0.5 h-6 px-2 text-sm"
			>
				blockquote
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="m-0.5 h-6 px-2 text-sm"
			>
				horizontal rule
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHardBreak().run()}
				class="m-0.5 h-6 px-2 text-sm">hard break</Button
			>
			<Button
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
				class="m-0.5 h-6 px-2 text-sm"
			>
				undo
			</Button>
			<Button
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
				class="m-0.5 h-6 px-2 text-sm"
			>
				redo
			</Button>
			<Button on:click={download} class="m-0.5 h-6 px-2 text-sm">download</Button>
			<input type="file" id="selectedFile" style="display: none;" bind:files on:change={upload} />
			<Button
				on:click={() => document.getElementById('selectedFile')?.click()}
				class="m-0.5 h-6 px-2 text-sm">upload</Button
			>
			<Button on:click={toggleMode} class="m-0.5 h-6 px-2 text-sm">mode</Button>
		</div>
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

<div bind:this={element} />
