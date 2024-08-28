export const defaultContent = `
<h1>LightNote</h1>
<p>LightNote has been developed utilizing <a target="_blank" rel="noopener noreferrer nofollow"
    href="https://kit.svelte.dev">SvelteKit</a>, <a target="_blank" rel="noopener noreferrer nofollow"
    href="https://tiptap.dev">Tiptap</a>, and <a target="_blank" rel="noopener noreferrer nofollow"
    href="https://ui.shadcn.com/">shadcn/ui</a> to ensure accessibility even in offline environments.</p>
<p>LightNote essentially supports three types of headers, basic paragraph type, code block, unordered list, and ordered
  list types necessary for document creation.</p>
<p>Header types and basic paragraph types can be emphasized with formatting options such as <strong>bold</strong>,
  <em>italic</em>, and <s>strike</s>.</p>
<p>Links can be added or modified through the link button, and they can be removed using the link removal button.</p>
<p>The history feature is also provided through undo and redo actions.</p>
<p>Documents are basically stored in <strong>LocalStorage</strong>, and if you wish to save them permanently, you should
  use the provided save function to store them as HTML files. Additionally, you can upload these files to continue
  editing.</p>
<p>The theme supports both Light and Dark modes.</p>
<p>If you want more features, please visit the Tiptap documentation and extend the functionality through extensions.</p>
<hr>
<h1><code># H1</code>: H1</h1>
<h2><code>## H2</code>: H2</h2>
<h3><code>### H3</code>: H3</h3>
<p><code>\`code\`</code>: <code>code</code></p>
<p><code>**bold**</code>: <strong>bold</strong></p>
<p><code>*italic*</code>: <em>italic</em></p>
<p><code>~~strike~~</code>: <s>strike</s></p>
<p><code>- or * unordered list</code>:</p>
<ul>
  <li>
    <p>unordered list</p>
  </li>
</ul>
<p><code>1. ordered list</code>:</p>
<ol>
  <li>
    <p>ordered list</p>
  </li>
</ol>
<p><code>\`\`\`code block\`\`\`</code>:</p>
<pre><code>\`\`\`code block\`\`\`</code></pre>
<p><code>&gt; block quote</code>:</p>
<blockquote>
  <p>block quote</p>
</blockquote>
<p><code>---</code>:</p>
<hr>
<p><code>cmd+z or ctrl+z</code>: undo</p>
<p><code>cmd+shift+z or ctrl+shift+z</code>: redo</p>
<p><code>cmd+shift+l or ctrl+shift+l</code>: text align left</p>
<p><code>cmd+shift+e or ctrl+shift+e</code>: text align center</p>
<p><code>cmd+shift+r or ctrl+shift+r</code>: text align right</p>
<hr>
<h3>Collaboration</h3>
<p>LightNote supports collaboration features. LightNote utilizes Tiptap's Collaboration extension and supports
  cross-device connections through WebSocket, requiring a <a target="_blank" rel="noopener noreferrer nofollow"
    href="https://tiptap.dev/docs/hocuspocus/introduction">Hocuspocus</a> server for relay. The Hocuspocus server can
  either be hosted directly or leverage a third-party service that provides the necessary functionality. If Node.js is
  installed on the device, enter the following command to start the Hocuspocus server.</p>
<pre><code>npx @hocuspocus/cli --port 1234 --sqlite</code></pre>
<p style="text-align: start">If it is not possible to provide the hosting endpoint over HTTPS, you can use the <a
    target="_blank" rel="noopener noreferrer nofollow" href="https://ngrok.com">ngrok</a> proxy to expose it via HTTPS.
  After signing up for ngrok and obtaining the token, use the command below to expose the previously launched server
  over HTTPS.</p>
<pre><code>ngrok http http://localhost:1234</code></pre>
<p style="text-align: start">Finally, connect to relay server using the ngrok proxy address and workspace name.</p>
<p style="text-align: start"><a target="_blank" rel="noopener noreferrer nofollow" 
href="https://code0xff.github.io/LightNote?endpoint={porxy_url}&workspace={workspace}">
https://code0xff.github.io/LightNote?endpoint={porxy_url}&workspace={workspace}</a></p>
<p style="text-align: start">Now, collaboration mode is active!</p>
`;

export const htmlStyle = `
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta charset="utf-8">
  <style>
    html {
      margin: 0;
      padding: 0;
    }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    @media only screen and (min-width: 768px) {
      body {
        margin: 0 auto;
        padding: 4rem 0;
        width: 708px;
      }
    }
    @media only screen and (max-width: 768px) {
      body {
        margin: 0;
        padding: 1rem;
      }
    }

    h1 {
      display: block;
      font-size: 2em;
      margin-top: 0.67em;
      margin-bottom: 0.67em;
      margin-left: 0;
      margin-right: 0;
      font-weight: bold;
    }

    h2 {
      display: block;
      font-size: 1.5em;
      margin-top: 0.83em;
      margin-bottom: 0.83em;
      margin-left: 0;
      margin-right: 0;
      font-weight: bold;
    }

    h3 {
      display: block;
      font-size: 1.17em;
      margin-top: 1em;
      margin-bottom: 1em;
      margin-left: 0;
      margin-right: 0;
      font-weight: bold;
    }

    p {
      display: block;
      margin-top: 1em;
      margin-bottom: 1em;
      margin-left: 0;
      margin-right: 0;
    }

    ul {
      display: block;
      list-style-type: disc;
      margin-top: 1em;
      margin-bottom: 1em;
      margin-left: 0;
      margin-right: 0;
      padding-left: 1.3em;
    }

    ol {
      display: block;
      list-style-type: decimal;
      margin-top: 1em;
      margin-bottom: 1em;
      margin-left: 0;
      margin-right: 0;
      padding-left: 1.3em;
    }

    code {
      font-family: monospace;
      background-color: rgba(#616161, 0.1);
      color: crimson;
    }

    pre {
      display: block;
      font-family: monospace;
      white-space: pre-wrap;
      background: rgba(#616161, 0.1);
      color: #616161;
      margin: 1em 0;
      padding: 1rem;

      code {
        color: inherit;
        padding: 0;
        background: none;
      }
    }

    img {
      display: inline-block;
      height: auto;
      max-width: 100%;
    }

    blockquote {
      padding-left: 1rem;
      border-left: 2px solid #616161;
    }

    hr {
      display: block;
      margin-top: 0.5em;
      margin-bottom: 0.5em;
      margin-left: auto;
      margin-right: auto;
      border-style: inset;
      border-width: 1px;
      border-color: #616161;
    }

    a {
      text-decoration: none;
      color: #1e90ff;
    }

    a:hover {
      text-decoration: underline;
      cursor: pointer;
    }

    p.is-editor-empty:first-child::before {
      color: #adb5bd;
      content: attr(data-placeholder);
      float: left;
      height: 0;
      pointer-events: none;
    }
  </style>
</head>
`;