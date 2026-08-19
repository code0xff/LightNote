import { describe, expect, it } from 'vitest';
import { blocksToHtml, markdownToDocument, parseInline, parseMarkdownBlocks } from './markdown';

const markdownToHtml = (markdown: string) => blocksToHtml(parseMarkdownBlocks(markdown));

describe('parseInline', () => {
	it('marks bold, italic, and inline code', () => {
		expect(parseInline('plain **bold** and *italic* with `code`')).toEqual([
			{ type: 'text', text: 'plain ' },
			{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
			{ type: 'text', text: ' and ' },
			{ type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
			{ type: 'text', text: ' with ' },
			{ type: 'text', text: 'code', marks: [{ type: 'code' }] }
		]);
		expect(parseInline('__also bold__ and _also italic_')).toEqual([
			{ type: 'text', text: 'also bold', marks: [{ type: 'bold' }] },
			{ type: 'text', text: ' and ' },
			{ type: 'text', text: 'also italic', marks: [{ type: 'italic' }] }
		]);
	});

	it('keeps http links but strips unsafe protocols', () => {
		expect(parseInline('[docs](https://example.com)')).toEqual([
			{
				type: 'text',
				text: 'docs',
				marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
			}
		]);
		expect(parseInline('[click](javascript:alert)')).toEqual([{ type: 'text', text: 'click' }]);
		// A link target is read up to the first ")", so parentheses inside a URL
		// are not supported; the remainder stays as plain text.
		expect(parseInline('[click](javascript:alert(1))')).toEqual([
			{ type: 'text', text: 'click' },
			{ type: 'text', text: ')' }
		]);
	});

	it('turns single newlines into hard breaks', () => {
		expect(parseInline('one\ntwo')).toEqual([
			{ type: 'text', text: 'one' },
			{ type: 'hardBreak' },
			{ type: 'text', text: 'two' }
		]);
	});

	it('leaves unmatched markers as text', () => {
		expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
	});
});

describe('parseMarkdownBlocks', () => {
	it('parses headings with their level', () => {
		expect(parseMarkdownBlocks('# Title\n\n### Sub')).toEqual([
			{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
			{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Sub' }] }
		]);
	});

	it('groups consecutive bullet items into one list', () => {
		expect(parseMarkdownBlocks('- one\n- two')).toEqual([
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }]
					},
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }]
					}
				]
			}
		]);
	});

	it('keeps the starting number of an ordered list', () => {
		const [list] = parseMarkdownBlocks('3. third\n4. fourth');

		expect(list.type).toBe('orderedList');
		expect(list.attrs).toEqual({ start: 3 });
		expect(list.content).toHaveLength(2);
	});

	it('parses blockquotes, rules, and fenced code', () => {
		expect(parseMarkdownBlocks('> quoted\n> lines')).toEqual([
			{
				type: 'blockquote',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'quoted' },
							{ type: 'hardBreak' },
							{ type: 'text', text: 'lines' }
						]
					}
				]
			}
		]);
		expect(parseMarkdownBlocks('---')).toEqual([{ type: 'horizontalRule' }]);
		expect(parseMarkdownBlocks('```ts\nconst a = 1;\n```')).toEqual([
			{
				type: 'codeBlock',
				attrs: { language: 'ts' },
				content: [{ type: 'text', text: 'const a = 1;' }]
			}
		]);
	});

	it('does not treat markdown inside a code fence as blocks', () => {
		expect(parseMarkdownBlocks('```\n# not a heading\n- not a list\n```')).toEqual([
			{ type: 'codeBlock', content: [{ type: 'text', text: '# not a heading\n- not a list' }] }
		]);
	});

	it('closes an unterminated fence at the end of the input', () => {
		expect(parseMarkdownBlocks('```\nunclosed')).toEqual([
			{ type: 'codeBlock', content: [{ type: 'text', text: 'unclosed' }] }
		]);
	});

	it('starts a new block when a paragraph is followed by a list', () => {
		const blocks = parseMarkdownBlocks('Intro line\n- item');

		expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'bulletList']);
	});

	it('parses a pipe table with a header row', () => {
		const blocks = parseMarkdownBlocks('| Name | Qty |\n| --- | ---: |\n| **Tea** | 2 |');

		expect(blocks).toEqual([
			{
				type: 'table',
				content: [
					{
						type: 'tableRow',
						content: [
							{
								type: 'tableHeader',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }]
							},
							{
								type: 'tableHeader',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Qty' }] }]
							}
						]
					},
					{
						type: 'tableRow',
						content: [
							{
								type: 'tableCell',
								content: [
									{
										type: 'paragraph',
										content: [{ type: 'text', text: 'Tea', marks: [{ type: 'bold' }] }]
									}
								]
							},
							{
								type: 'tableCell',
								content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }]
							}
						]
					}
				]
			}
		]);
	});

	it('squares rows off against the header and keeps escaped pipes', () => {
		const blocks = parseMarkdownBlocks('a | b\n--- | ---\n1\\|2\n1 | 2 | 3');
		const rows = blocks[0].content ?? [];

		expect(blocks[0].type).toBe('table');
		expect(rows.map((row) => (row.content ?? []).length)).toEqual([2, 2, 2]);
		expect(rows[1].content?.[0]).toEqual({
			type: 'tableCell',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: '1|2' }] }]
		});
		expect(rows[1].content?.[1]).toEqual({
			type: 'tableCell',
			content: [{ type: 'paragraph' }]
		});
	});

	it('needs a matching delimiter row to read pipes as a table', () => {
		expect(parseMarkdownBlocks('| a | b |').map((block) => block.type)).toEqual(['paragraph']);
		expect(parseMarkdownBlocks('| a | b |\n| --- |').map((block) => block.type)).toEqual([
			'paragraph'
		]);
	});

	it('keeps short body rows and ends before a new block', () => {
		const blocks = parseMarkdownBlocks(
			'Intro\n| a | b |\n| --- | --- |\n| 1 | 2 |\nAfter\n\n> quote | text'
		);

		expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'table', 'blockquote']);
		expect(blocks[1].content).toHaveLength(3);
		expect(blocks[1].content?.[2]).toEqual({
			type: 'tableRow',
			content: [
				{
					type: 'tableCell',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] }]
				},
				{ type: 'tableCell', content: [{ type: 'paragraph' }] }
			]
		});
	});

	it('does not absorb adjacent list, quote, or heading blocks', () => {
		for (const [line, type] of [
			['- item | text', 'bulletList'],
			['1. item | text', 'orderedList'],
			['> quote | text', 'blockquote'],
			['# heading | text', 'heading']
		] as const) {
			expect(
				parseMarkdownBlocks(`| a | b |\n| --- | --- |\n${line}`).map((block) => block.type)
			).toEqual(['table', type]);
		}
	});

	it('does not mistake a list or quote header for a table', () => {
		expect(parseMarkdownBlocks('> a | b\n--- | ---').map((block) => block.type)).toEqual([
			'blockquote',
			'paragraph'
		]);
		expect(parseMarkdownBlocks('- a | b\n--- | ---').map((block) => block.type)).toEqual([
			'bulletList',
			'paragraph'
		]);
	});

	it('treats an even backslash run before a pipe as a separator', () => {
		const blocks = parseMarkdownBlocks('a | b\n--- | ---\nleft\\\\|right | x');

		expect(blocks[0].content?.[1].content).toEqual([
			{
				type: 'tableCell',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'left\\' }] }]
			},
			{
				type: 'tableCell',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: 'right' }] }]
			}
		]);
	});

	it('always yields a non-empty document', () => {
		expect(markdownToDocument('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
	});
});

describe('markdownToHtml', () => {
	it('serializes blocks and escapes text', () => {
		expect(markdownToHtml('# Title\n\nbody with <tag> & **bold**')).toBe(
			'<h1>Title</h1><p>body with &lt;tag&gt; &amp; <strong>bold</strong></p>'
		);
	});

	it('serializes lists, quotes, rules, and code', () => {
		expect(markdownToHtml('- a\n- b')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>');
		expect(markdownToHtml('2. a')).toBe('<ol start="2"><li><p>a</p></li></ol>');
		expect(markdownToHtml('1. a')).toBe('<ol><li><p>a</p></li></ol>');
		expect(markdownToHtml('> note')).toBe('<blockquote><p>note</p></blockquote>');
		expect(markdownToHtml('---')).toBe('<hr>');
		expect(markdownToHtml('```js\nvar x = "<a>";\n```')).toBe(
			'<pre><code class="language-js">var x = &quot;&lt;a&gt;&quot;;</code></pre>'
		);
	});

	it('serializes tables as header and body cells', () => {
		expect(markdownToHtml('| a | b |\n| --- | --- |\n| <x> | |')).toBe(
			'<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr><tr><td><p>&lt;x&gt;</p></td><td><p></p></td></tr></tbody></table>'
		);
	});

	it('escapes link targets and drops unsafe ones', () => {
		expect(markdownToHtml('[a](https://example.com/?x=1&y=2)')).toBe(
			'<p><a href="https://example.com/?x=1&amp;y=2">a</a></p>'
		);
		expect(markdownToHtml('[a](javascript:alert)')).toBe('<p>a</p>');
	});

	it('serializes nothing for empty input', () => {
		expect(markdownToHtml('  ')).toBe('');
	});
});
