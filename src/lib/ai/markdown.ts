import type { JSONContent } from '@tiptap/core';
import { escapeHtml, isSupportedUrl } from '$lib/utils';

/**
 * A deliberately small markdown subset turned into Tiptap nodes, so AI output
 * lands as real headings/lists/quotes instead of a wall of paragraphs. Nesting
 * is not supported: lists and quotes are flat.
 */

const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET_ITEM = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^(\d+)[.)]\s+(.*)$/;
const QUOTE_LINE = /^>\s?(.*)$/;
const HORIZONTAL_RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```([a-zA-Z0-9+#-]*)\s*$/;

const INLINE_TOKEN =
	/(`[^`]+`)|(\*\*(?!\s)[^*]+\*\*)|(__(?!\s)[^_]+__)|(\*(?!\s)[^*]+\*)|(_(?!\s)[^_]+_)|(\[[^\]]*\]\([^)\s]+\))/;

function textNode(text: string, mark?: string): JSONContent {
	return mark ? { type: 'text', text, marks: [{ type: mark }] } : { type: 'text', text };
}

function linkNode(text: string, href: string): JSONContent {
	if (!isSupportedUrl(href, LINK_PROTOCOLS)) {
		// Keep the label but drop an unusable (or unsafe) target.
		return textNode(text);
	}

	return { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] };
}

function parseInlineSegment(segment: string): JSONContent[] {
	const nodes: JSONContent[] = [];
	let rest = segment;

	while (rest) {
		const match = INLINE_TOKEN.exec(rest);

		if (!match || match.index === undefined) {
			nodes.push(textNode(rest));
			break;
		}

		if (match.index > 0) {
			nodes.push(textNode(rest.slice(0, match.index)));
		}

		const [token] = match;

		if (token.startsWith('`')) {
			nodes.push(textNode(token.slice(1, -1), 'code'));
		} else if (token.startsWith('**') || token.startsWith('__')) {
			nodes.push(textNode(token.slice(2, -2), 'bold'));
		} else if (token.startsWith('[')) {
			const closing = token.indexOf('](');
			nodes.push(linkNode(token.slice(1, closing), token.slice(closing + 2, -1)));
		} else {
			nodes.push(textNode(token.slice(1, -1), 'italic'));
		}

		rest = rest.slice(match.index + token.length);
	}

	return nodes.filter((node) => node.type !== 'text' || node.text);
}

/** Parses inline markdown, turning single newlines into hard breaks. */
export function parseInline(text: string): JSONContent[] {
	return text
		.split('\n')
		.flatMap((line, index) => [
			...(index > 0 ? [{ type: 'hardBreak' }] : []),
			...parseInlineSegment(line)
		]);
}

function paragraph(text: string): JSONContent {
	const content = parseInline(text);

	return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function listItem(text: string): JSONContent {
	return { type: 'listItem', content: [paragraph(text)] };
}

export function parseMarkdownBlocks(markdown: string): JSONContent[] {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const blocks: JSONContent[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];

		if (!line.trim()) {
			index += 1;
			continue;
		}

		const fence = FENCE.exec(line.trim());

		if (fence) {
			const code: string[] = [];
			index += 1;

			while (index < lines.length && !FENCE.test(lines[index].trim())) {
				code.push(lines[index]);
				index += 1;
			}

			// Skip the closing fence when there is one; an unterminated fence just
			// runs to the end of the input.
			index += 1;
			blocks.push({
				type: 'codeBlock',
				...(fence[1] ? { attrs: { language: fence[1] } } : {}),
				...(code.length > 0 ? { content: [{ type: 'text', text: code.join('\n') }] } : {})
			});
			continue;
		}

		if (HORIZONTAL_RULE.test(line.trim())) {
			blocks.push({ type: 'horizontalRule' });
			index += 1;
			continue;
		}

		const heading = HEADING.exec(line.trim());

		if (heading) {
			blocks.push({
				type: 'heading',
				attrs: { level: heading[1].length },
				content: parseInline(heading[2].trim())
			});
			index += 1;
			continue;
		}

		if (BULLET_ITEM.test(line.trim())) {
			const items: JSONContent[] = [];

			while (index < lines.length) {
				const item = BULLET_ITEM.exec(lines[index].trim());

				if (!item) {
					break;
				}

				items.push(listItem(item[1]));
				index += 1;
			}

			blocks.push({ type: 'bulletList', content: items });
			continue;
		}

		const firstOrdered = ORDERED_ITEM.exec(line.trim());

		if (firstOrdered) {
			const items: JSONContent[] = [];
			const start = Number(firstOrdered[1]);

			while (index < lines.length) {
				const item = ORDERED_ITEM.exec(lines[index].trim());

				if (!item) {
					break;
				}

				items.push(listItem(item[2]));
				index += 1;
			}

			blocks.push({ type: 'orderedList', attrs: { start }, content: items });
			continue;
		}

		if (QUOTE_LINE.test(line.trim())) {
			const quoted: string[] = [];

			while (index < lines.length) {
				const quote = QUOTE_LINE.exec(lines[index].trim());

				if (!quote) {
					break;
				}

				quoted.push(quote[1]);
				index += 1;
			}

			blocks.push({ type: 'blockquote', content: [paragraph(quoted.join('\n').trim())] });
			continue;
		}

		const textLines: string[] = [];

		while (index < lines.length) {
			const current = lines[index];

			if (
				!current.trim() ||
				HEADING.test(current.trim()) ||
				BULLET_ITEM.test(current.trim()) ||
				ORDERED_ITEM.test(current.trim()) ||
				QUOTE_LINE.test(current.trim()) ||
				HORIZONTAL_RULE.test(current.trim()) ||
				FENCE.test(current.trim())
			) {
				break;
			}

			textLines.push(current.trim());
			index += 1;
		}

		blocks.push(paragraph(textLines.join('\n')));
	}

	return blocks;
}

export function markdownToDocument(markdown: string): JSONContent {
	const blocks = parseMarkdownBlocks(markdown);

	return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] };
}

function inlineToHtml(nodes: JSONContent[] = []): string {
	return nodes
		.map((node) => {
			if (node.type === 'hardBreak') {
				return '<br>';
			}

			if (node.type !== 'text') {
				return '';
			}

			const text = escapeHtml(node.text ?? '');

			return (node.marks ?? []).reduce((wrapped, mark) => {
				if (mark.type === 'bold') {
					return `<strong>${wrapped}</strong>`;
				}

				if (mark.type === 'italic') {
					return `<em>${wrapped}</em>`;
				}

				if (mark.type === 'code') {
					return `<code>${wrapped}</code>`;
				}

				if (mark.type === 'link') {
					return `<a href="${escapeHtml(String(mark.attrs?.href ?? ''))}">${wrapped}</a>`;
				}

				return wrapped;
			}, text);
		})
		.join('');
}

/** Serializes parsed blocks to HTML, for appending to legacy HTML documents. */
export function blocksToHtml(blocks: JSONContent[]): string {
	return blocks
		.map((block) => {
			switch (block.type) {
				case 'heading': {
					const level = Number(block.attrs?.level ?? 1);

					return `<h${level}>${inlineToHtml(block.content)}</h${level}>`;
				}
				case 'bulletList':
				case 'orderedList': {
					const tag = block.type === 'bulletList' ? 'ul' : 'ol';
					const start = Number(block.attrs?.start ?? 1);
					const openTag = tag === 'ol' && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
					const items = (block.content ?? [])
						.map((item) => `<li>${blocksToHtml(item.content ?? [])}</li>`)
						.join('');

					return `${openTag}${items}</${tag}>`;
				}
				case 'blockquote':
					return `<blockquote>${blocksToHtml(block.content ?? [])}</blockquote>`;
				case 'codeBlock': {
					const text = escapeHtml(block.content?.[0]?.text ?? '');
					const language = block.attrs?.language;

					return language
						? `<pre><code class="language-${escapeHtml(String(language))}">${text}</code></pre>`
						: `<pre><code>${text}</code></pre>`;
				}
				case 'horizontalRule':
					return '<hr>';
				default:
					return `<p>${inlineToHtml(block.content)}</p>`;
			}
		})
		.join('');
}
