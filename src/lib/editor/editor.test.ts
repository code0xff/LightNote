import { describe, expect, it, vi } from 'vitest';
import {
	buildShareUrl,
	createExportHtml,
	extractEditorContent,
	getDefaultDownloadName,
	normalizeDownloadName,
	readUploadedDocument,
	readSharedMetadata,
	validateShareMetadata,
	validateUploadFile
} from './editor';

describe('editor helpers', () => {
	it('validates and trims sharing metadata', () => {
		expect(validateShareMetadata(' wss://example.com/socket ', ' workspace ')).toEqual({
			endpoint: 'wss://example.com/socket',
			workspace: 'workspace'
		});
		expect(() => validateShareMetadata('https://example.com', 'workspace')).toThrow(
			'Invalid endpoint'
		);
		expect(() => validateShareMetadata('ws://example.com', ' ')).toThrow('Invalid workspace');
	});

	it('builds encoded sharing URLs', () => {
		const url = buildShareUrl('https://code0xff.github.io', '/LightNote/', {
			endpoint: 'wss://example.com/socket?token=a b',
			workspace: 'team notes'
		});

		expect(url).toBe(
			'https://code0xff.github.io/LightNote/?endpoint=wss%3A%2F%2Fexample.com%2Fsocket%3Ftoken%3Da+b&workspace=team+notes'
		);
	});

	it('reads valid shared metadata from storage', () => {
		const getItem = vi.fn(() =>
			JSON.stringify({ endpoint: 'ws://localhost:1234', workspace: 'drafts' })
		);
		const storage = { getItem } as unknown as Storage;

		expect(readSharedMetadata(storage)).toEqual({
			endpoint: 'ws://localhost:1234',
			workspace: 'drafts'
		});
	});

	it('ignores invalid shared metadata from storage', () => {
		const storage = { getItem: vi.fn(() => '{bad json') } as unknown as Storage;

		expect(readSharedMetadata(storage)).toBeNull();
	});

	it('normalizes download file names', () => {
		expect(normalizeDownloadName(' project:plan ')).toBe('project-plan.html');
		expect(normalizeDownloadName('note.htm')).toBe('note.htm');
		expect(getDefaultDownloadName(null, null, 123)).toBe('light_note_123.html');
		expect(() => normalizeDownloadName('   ')).toThrow('Invalid file name');
	});

	it('creates a complete HTML document for export', () => {
		const html = createExportHtml('<h1>Hello</h1>', 'A < B');

		expect(html).toContain('<!doctype html>');
		expect(html).toContain('<html lang="en">');
		expect(html).toContain('<title>A &lt; B</title>');
		expect(html).toContain('<body>\n<h1>Hello</h1>\n</body>');
	});

	it('extracts editor content from uploaded full HTML documents', () => {
		expect(extractEditorContent('<!doctype html><html><body><p>Saved</p></body></html>')).toBe(
			'<p>Saved</p>'
		);
		expect(extractEditorContent('<p>Fragment</p>')).toBe('<p>Fragment</p>');
	});

	it('validates upload file metadata', () => {
		const htmlFile = { name: 'note.html', type: 'text/html', size: 1024 } as File;
		const extensionOnlyHtmlFile = { name: 'note.htm', type: '', size: 1024 } as File;
		const textFile = { name: 'note.txt', type: 'text/plain', size: 1024 } as File;
		const largeFile = { name: 'note.html', type: 'text/html', size: 11 * 1024 * 1024 } as File;

		expect(validateUploadFile(htmlFile)).toBe(htmlFile);
		expect(validateUploadFile(extensionOnlyHtmlFile)).toBe(extensionOnlyHtmlFile);
		expect(() => validateUploadFile(textFile)).toThrow('Please upload an HTML file');
		expect(() => validateUploadFile(largeFile)).toThrow('too large');
		expect(() => validateUploadFile(undefined)).toThrow('No file selected');
	});

	it('reads uploaded HTML documents for document creation', async () => {
		const file = {
			name: 'meeting notes.html',
			type: 'text/html',
			size: 1024,
			text: vi.fn(async () => '<!doctype html><html><body><h1>Meeting</h1></body></html>')
		} as unknown as File;
		const files = { 0: file } as unknown as FileList;

		await expect(readUploadedDocument(files)).resolves.toEqual({
			title: 'meeting notes',
			content: '<h1>Meeting</h1>',
			contentFormat: 'html',
			sourceFileName: 'meeting notes.html'
		});
	});
});
