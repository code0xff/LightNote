import { HocuspocusProvider } from "@hocuspocus/provider";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from '@tiptap/extension-image';
import { getExtensions } from "./extensions";

export function getExtensionsWithCol(url: string, name: string, bubbleMenu: HTMLElement) {
  const provider = new HocuspocusProvider({
    url,
    name,
    onConnect() {
      window.alert(`Connected to ${url}/${name}`);
    },
  });
  if (provider.isConnected) {
    return {
      provider, extensions: [
        StarterKit.configure({
          history: false
        }),
        Collaboration.configure({
          document: provider.document
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
      ]
    };
  } else {
    return { provider: null, extensions: getExtensions(bubbleMenu) };
  }
}