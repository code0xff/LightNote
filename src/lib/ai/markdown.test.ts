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
