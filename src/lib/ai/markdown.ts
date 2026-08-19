import type { JSONContent } from '@tiptap/core';
import { escapeHtml, isSupportedUrl } from '$lib/utils';

/**
 * A deliberately small markdown subset turned into Tiptap nodes, so AI output
 * lands as real headings/lists/quotes instead of a wall of paragraphs. Nesting
 * is not supported: lists and quotes are flat, and table cells hold a single
 * paragraph each. Pipe tables are recognized, but their alignment row only
 * marks where the table starts — per-column alignment is dropped, because the
 * cell nodes carry no alignment attribute.
 */

const LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET_ITEM = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^(\d+)[.)]\s+(.*)$/;
const QUOTE_LINE = /^>\s?(.*)$/;
const HORIZONTAL_RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```([a-zA-Z0-9+#-]*)\s*$/;
const TABLE_DELIMITER_CELL = /^:?-+:?$/;

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

/**
 * Splits one pipe-table row into trimmed cells. An odd run of backslashes before
 * a pipe escapes it; an even run leaves the pipe as a separator. The empty
 * strings a leading/trailing pipe produces are edges of the row rather than
 * cells.
 */
function splitTableRow(line: string): string[] {
	const cells: string[] = [];
	let current = '';

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];

		if (character === '\\') {
			let slashCount = 1;

			while (line[index + slashCount] === '\\') {
				slashCount += 1;
			}

			if (line[index + slashCount] === '|') {
				current += '\\'.repeat(Math.floor(slashCount / 2));

				if (slashCount % 2 === 1) {
					current += '|';
					index += slashCount;
				} else {
					index += slashCount - 1;
				}

				continue;
			}

			current += '\\'.repeat(slashCount);
			index += slashCount - 1;
			continue;
		}

		if (character === '|') {
			cells.push(current);
			current = '';
			continue;
		}

		current += character;
	}

	cells.push(current);

	if (cells.length > 1 && !cells[0].trim()) {
		cells.shift();
	}
	if (cells.length > 1 && !cells[cells.length - 1].trim()) {
		cells.pop();
	}

	return cells.map((cell) => cell.trim());
}

function tableRow(cells: string[], columns: number, cellType: 'tableHeader' | 'tableCell') {
	const content = Array.from({ length: columns }, (_, index) => {
		const cell = cells[index] ?? '';
		const cellContent = parseInline(cell);

		return {
			type: cellType,
			content: [
				cellContent.length > 0 ? { type: 'paragraph', content: cellContent } : { type: 'paragraph' }
			]
		};
	});

	return { type: 'tableRow', content };
}

/**
 * A table needs both a header row and a matching delimiter row; without the
 * delimiter a line with pipes in it is just a paragraph.
 */
function tableStartsAt(lines: string[], index: number) {
	const header = lines[index];
	const delimiter = lines[index + 1];

	if (!header?.includes('|') || delimiter === undefined || !delimiter.includes('|')) {
		return false;
	}

	const delimiterCells = splitTableRow(delimiter.trim());

	return (
		delimiterCells.length === splitTableRow(header.trim()).length &&
		delimiterCells.every((cell) => TABLE_DELIMITER_CELL.test(cell))
	);
}

function startsBlock(line: string) {
	const trimmed = line.trim();

	return (
		HEADING.test(trimmed) ||
		BULLET_ITEM.test(trimmed) ||
		ORDERED_ITEM.test(trimmed) ||
		QUOTE_LINE.test(trimmed) ||
		HORIZONTAL_RULE.test(trimmed) ||
		FENCE.test(trimmed)
	);
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

		if (tableStartsAt(lines, index)) {
			const headerCells = splitTableRow(line.trim());
			const columns = headerCells.length;
			const rows: JSONContent[] = [tableRow(headerCells, columns, 'tableHeader')];

			// Skip the header and delimiter rows, then take body rows until a
			// blank line or another block-level structure ends the table. GFM allows
			// short rows without any pipe, which are padded by tableRow below.
			index += 2;

			while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
				rows.push(tableRow(splitTableRow(lines[index].trim()), columns, 'tableCell'));
				index += 1;
			}

			blocks.push({ type: 'table', content: rows });
			continue;
		}

		const textLines: string[] = [];

		while (index < lines.length) {
			const current = lines[index];

			if (!current.trim() || tableStartsAt(lines, index) || startsBlock(current)) {
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
				case 'table': {
					const rows = (block.content ?? [])
						.map((row) => {
							const cells = (row.content ?? [])
								.map((cell) => {
									const tag = cell.type === 'tableHeader' ? 'th' : 'td';

									return `<${tag}>${blocksToHtml(cell.content ?? [])}</${tag}>`;
								})
								.join('');

							return `<tr>${cells}</tr>`;
						})
						.join('');

					return `<table><tbody>${rows}</tbody></table>`;
				}
				case 'horizontalRule':
					return '<hr>';
				default:
					return `<p>${inlineToHtml(block.content)}</p>`;
			}
		})
		.join('');
}
