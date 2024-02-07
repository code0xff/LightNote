import type { Editor } from "@tiptap/core";
import { htmlStyle } from "./constants";

export function download(editor: Editor) {
  const fileName = localStorage.getItem('recently-edited') ?? `light_note_${Date.now()}.html`;
  let download = window.prompt('Please insert file name', fileName);
  if (download === null) {
    return;
  }
  if ((!download.endsWith('.html') && !download.endsWith('.txt')) || download.slice(0, download.lastIndexOf('.')).trim().length === 0) {
    window.alert('Invalid file name: e.g. (light_note.html, light_note.txt)');
    return;
  }

  let blob: Blob;
  if (download.endsWith('.html')) {
    const html = editor.getHTML();
    blob = new Blob([htmlStyle, html], { type: 'text/html;charset=utf-8' });
  } else {
    const txt = editor.getText();
    blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  }

  const element = document.createElement('a');
  element.setAttribute('href', window.URL.createObjectURL(blob));
  element.setAttribute('download', download);
  element.click();
}

export async function upload(editor: Editor, files: FileList) {
  if (files) {
    localStorage.setItem('recently-edited', files[0].name);
    editor.commands.setContent(await files[0].text());
  }
}

export function setLink(editor: Editor) {
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

export function clearContent(editor: Editor) {
  editor.commands.clearContent();
  editor.commands.focus();
}

export function addImage(editor: Editor) {
  const url = window.prompt('Please insert image url');
  if (url === null || url.trim().length === 0) {
    return;
  }
  editor.chain().focus().setImage({ src: url }).run();
}
