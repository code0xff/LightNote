import { describe, expect, it } from 'vitest';
import { escapeHtml, isSupportedUrl } from './utils';

describe('escapeHtml', () => {
	it('escapes HTML-significant characters', () => {
		expect(escapeHtml(`<a href="x" data-y='z'>&`)).toBe(
			'&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;'
		);
	});

	it('leaves plain text untouched', () => {
		expect(escapeHtml('plain text 123')).toBe('plain text 123');
	});
});

describe('isSupportedUrl', () => {
	it('accepts URLs whose protocol is allowed', () => {
		expect(isSupportedUrl('https://example.com', ['http:', 'https:'])).toBe(true);
		expect(isSupportedUrl('mailto:a@b.com', ['mailto:'])).toBe(true);
	});

	it('rejects disallowed protocols and invalid URLs', () => {
		expect(isSupportedUrl('http://example.com', ['https:'])).toBe(false);
		expect(isSupportedUrl('javascript:alert(1)', ['http:', 'https:'])).toBe(false);
		expect(isSupportedUrl('not a url', ['https:'])).toBe(false);
	});
});
