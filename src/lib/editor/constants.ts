export const defaultContent = '<h1>Hello,</h1><p>This application has been developed utilizing <a target="_blank" rel="noopener noreferrer nofollow" href="https://kit.svelte.dev">SvelteKit</a>, <a target="_blank" rel="noopener noreferrer nofollow" href="https://tiptap.dev">Tiptap</a>, and <a target="_blank" rel="noopener noreferrer nofollow" href="https://ui.shadcn.com/">shadcn/ui</a> to ensure accessibility even in offline environments.</p><p>This note app essentially supports three types of headers, basic paragraph type, code block, unordered list, and ordered list types necessary for document creation.</p><p>Header types and basic paragraph types can be emphasized with formatting options such as <strong>bold</strong>, <em>italic</em>, and <s>strike</s>.</p><p>Links can be added or modified through the link button, and they can be removed using the link removal button.</p><p>The history feature is also provided through undo and redo actions.</p><p>Documents are basically stored in <strong>LocalStorage</strong>, and if you wish to save them permanently, you should use the provided save function to store them as HTML files. Additionally, you can upload these files to continue editing.</p><p>The theme supports both Light and Dark modes.</p><p>If you want more features, please visit the tiptap documentation and extend the functionality through extensions.</p><hr><h1><code># H1</code>: H1</h1><h2><code>## H2</code>: H2</h2><h3><code>### H3</code>: H3</h3><p><code>`code`</code>: <code>code</code></p><p><code>**bold**</code>: <strong>bold</strong></p><p><code>*italic*</code>: <em>italic</em></p><p><code>~~strike~~</code>: <s>strike</s></p><p><code>- or * unordered list</code>:</p><ul><li><p>unordered list</p></li></ul><p><code>1. ordered list</code>:</p><ol><li><p>ordered list</p></li></ol><p><code>```code block```</code>:</p><pre><code>```code block```</code></pre><p><code>&gt; block quote</code>:</p><blockquote><p>block quote</p></blockquote><p><code>---</code>:</p><hr><p><code>cmd+z</code>: undo</p><p><code>cmd+shift+z</code>: redo</p>';

export const htmlStyle = `
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta charset="utf-8">
  <style>
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    code {
      font-family: monospace;
      background-color: rgb(97, 97, 97, 0.1);
      color: #616161;
    }
    pre {
      display: block;
      font-family: monospace;
      white-space: pre-wrap;
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
</head>
`;