/**
 * The document column: the title block and the editor body share it so they
 * stay aligned. Kept as one string because the two elements are styled in
 * different places (a Svelte class attribute and Tiptap's `editorProps`), and
 * drifting values would misalign the title from the text under it.
 *
 * The column only centres itself; every horizontal offset (the fixed sidebar,
 * the AI panel) is padding on `.editor-shell`. Splitting that job between a
 * margin here and padding there is what made closing the panel throw the text
 * to the right and snap back: the margin changed instantly while the padding
 * was still animating.
 */
export const documentColumnClass = 'md:mx-auto md:w-[min(708px,100%)] md:px-0';

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
      background-color: rgba(97, 97, 97, 0.1);
      color: crimson;
    }

    pre {
      display: block;
      font-family: monospace;
      white-space: pre-wrap;
      background: rgba(97, 97, 97, 0.1);
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

    /* Column widths are an editor-only concept (prosemirror-tables keeps them in
       a colgroup that getHTML does not emit), so the export lets the browser size
       columns to their content instead of forcing the editor's fixed layout. */
    table {
      border-collapse: collapse;
      margin: 1em 0;
      width: 100%;
    }

    td,
    th {
      border: 1px solid #d1d5db;
      box-sizing: border-box;
      padding: 0.375rem 0.5rem;
      vertical-align: top;
    }

    td > *,
    th > * {
      margin-bottom: 0;
      margin-top: 0;
    }

    th {
      background-color: rgba(97, 97, 97, 0.1);
      font-weight: bold;
      text-align: left;
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
