import type { Editor } from "@tiptap/core";
import { htmlStyle } from "./constants";
import type { HocuspocusProvider } from "@hocuspocus/provider";

export function download(editor: Editor) {
  const fileName = localStorage.getItem('edited') ?? `light_note_${Date.now()}`;
  const download = window.prompt('Please insert file name', fileName);
  if (!download) {
    return;
  }
  if (download.trim().length === 0) {
    window.alert(`Invalid file name. filename: ${download}`);
    return;
  }

  localStorage.setItem('edited', download);
  const html = editor.getHTML();
  const blob = new Blob([htmlStyle, html], { type: 'text/html;charset=utf-8' });

  const element = document.createElement('a');
  element.setAttribute('href', window.URL.createObjectURL(blob));
  element.setAttribute('download', download);
  element.click();
}

export async function upload(editor: Editor, files: FileList) {
  if (files) {
    localStorage.setItem('edited', files[0].name);
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
  if (!url || url.trim().length === 0) {
    return;
  }
  editor.chain().focus().setImage({ src: url }).run();
}

export function startSharing(endpoint: string, workspace: string) {
  try {
    if (!endpoint || !(endpoint.startsWith('ws://') || endpoint.startsWith('wss://'))) {
      throw new Error('Invalid endpoint. endpoint should start with ws:// or wss://');
    }
    if (!workspace) {
      throw new Error('Invalid workspace');
    }
    location.replace(`${location.protocol}//${location.host}${location.pathname}?endpoint=${endpoint}&workspace=${workspace}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    window.alert(e.toString());
    console.error(e);
  }
}

export function endSharing(provider: HocuspocusProvider) {
  if (provider) {
    window.alert('Disconnecting...');
    localStorage.removeItem('connected');
    location.replace(`${location.protocol}//${location.host}${location.pathname}`);
  }
}

export function addYoutube(editor: Editor) {
  const url = window.prompt('Please insert youtube url');
  if (!url || url.trim().length === 0) {
    return;
  }
  editor.commands.setYoutubeVideo({
    src: url,
    width: 640,
    height: 480,
  });
}