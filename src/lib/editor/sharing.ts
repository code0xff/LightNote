import { HocuspocusProvider } from "@hocuspocus/provider";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from '@tiptap/extension-image';
import Youtube from "@tiptap/extension-youtube";

export function getExtensionsOnSharing(provider: HocuspocusProvider, bubbleMenu: HTMLElement) {
  return [
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
    Placeholder,
    Youtube.configure({
      inline: true
    })
  ]
}