<script lang="ts">
	import './styles.scss';

	import StarterKit from '@tiptap/starter-kit';
	import { Editor } from '@tiptap/core';
	import { onMount } from 'svelte';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import { Button } from '@/lib/components/ui/button';

	let element: Element;
	let editor: Editor;
	let bubbleMenu: any;
	let files: FileList;
	let html2pdf: any;

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
					class:
						'prose dark:prose-invert prose-sm sm:prose-base lg:prose-lg xl:prose-2xl m-5 focus:outline-none'
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

		// @ts-ignore
		html2pdf = await import('html2pdf.js');
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

	async function downloadPdf() {
		await html2pdf
			.default()
			.set({
				margin: 1,
				filename: `note_${Date.now()}.pdf`,
				image: { type: 'jpeg', quality: 0.98 },
				html2canvas: { scale: 2 },
				jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
			})
			.from(editor.getHTML())
			.save();
	}
</script>

{#if editor}
	<div>
		<div>
			<Button
				on:click={() => editor.chain().focus().toggleBold().run()}
				disabled={!editor.can().chain().focus().toggleBold().run()}
				variant={editor.isActive('bold') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				bold
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				disabled={!editor.can().chain().focus().toggleItalic().run()}
				variant={editor.isActive('italic') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				italic
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				disabled={!editor.can().chain().focus().toggleStrike().run()}
				variant={editor.isActive('strike') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				strike
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCode().run()}
				disabled={!editor.can().chain().focus().toggleCode().run()}
				variant={editor.isActive('code') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				code
			</Button>
			<Button
				on:click={() => editor.chain().focus().unsetAllMarks().run()}
				class="m-0.5 h-6 px-2 text-sm outline">clear marks</Button
			>
			<Button
				on:click={() => editor.chain().focus().clearNodes().run()}
				class="m-0.5 h-6 px-2 text-sm outline">clear nodes</Button
			>
			<Button
				on:click={() => editor.chain().focus().setParagraph().run()}
				variant={editor.isActive('paragraph') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				paragraph
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				h1
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				h2
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				h3
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBulletList().run()}
				variant={editor.isActive('bulletList') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				bullet list
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleOrderedList().run()}
				variant={editor.isActive('orderedList') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				ordered list
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleCodeBlock().run()}
				class={(editor.isActive('codeBlock') ? 'ghost' : 'outline') + ' m-0.5 h-6 px-2 text-sm'}
			>
				code block
			</Button>
			<Button
				on:click={() => editor.chain().focus().toggleBlockquote().run()}
				variant={editor.isActive('blockquote') ? 'default' : 'ghost'}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				blockquote
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHorizontalRule().run()}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				horizontal rule
			</Button>
			<Button
				on:click={() => editor.chain().focus().setHardBreak().run()}
				class="m-0.5 h-6 px-2 text-sm outline">hard break</Button
			>
			<Button
				on:click={() => editor.chain().focus().undo().run()}
				disabled={!editor.can().chain().focus().undo().run()}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				undo
			</Button>
			<Button
				on:click={() => editor.chain().focus().redo().run()}
				disabled={!editor.can().chain().focus().redo().run()}
				class="m-0.5 h-6 px-2 text-sm outline"
			>
				redo
			</Button>
			<Button on:click={download} class="m-0.5 h-6 px-2 text-sm outline">download</Button>
			<input type="file" id="selectedFile" style="display: none;" bind:files on:change={upload} />
			<Button
				on:click={() => document.getElementById('selectedFile')?.click()}
				class="m-0.5 h-6 px-2 text-sm outline">upload</Button
			>
			<Button on:click={downloadPdf} class="m-0.5 h-6 px-2 text-sm outline">pdf</Button>
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
