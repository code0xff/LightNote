import BubbleMenu from "@tiptap/extension-bubble-menu";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import Image from '@tiptap/extension-image';

export function getExtensions(bubbleMenu: HTMLElement) {
  return [
    StarterKit,
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
  ];
}