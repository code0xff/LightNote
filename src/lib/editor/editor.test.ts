import { describe, expect, it, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import {
	buildShareUrl,
	checkUrlInsert,
	createExportHtml,
	extractEditorContent,
	formatPageTitle,
	getDefaultDownloadName,
	isCellSelection,
	normalizeDownloadName,
	readSharedDocumentHistory,
	readUploadedDocument,
	removeSharedDocumentHistory,
	readSharedMetadata,
	readSidebarOpen,
	SHARED_DOCUMENTS_KEY,
	upsertSharedDocumentHistory,
	validateShareMetadata,
	validateUploadFile,
	writeSidebarOpen
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

	it('stores recent shared documents by endpoint and workspace', () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: vi.fn((key: string) => values.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => values.set(key, value))
		} as unknown as Storage;

		upsertSharedDocumentHistory(
			{ endpoint: 'wss://example.com/socket', workspace: 'alpha' },
			storage,
			1
		);
		upsertSharedDocumentHistory(
			{ endpoint: 'wss://example.com/socket', workspace: 'beta' },
			storage,
			2
		);
		upsertSharedDocumentHistory(
			{ endpoint: 'wss://example.com/socket', workspace: 'alpha' },
			storage,
			3
		);

		expect(storage.setItem).toHaveBeenCalledWith(SHARED_DOCUMENTS_KEY, expect.any(String));
		expect(readSharedDocumentHistory(storage)).toEqual([
			{ endpoint: 'wss://example.com/socket', workspace: 'alpha', updatedAt: 3 },
			{ endpoint: 'wss://example.com/socket', workspace: 'beta', updatedAt: 2 }
		]);
	});

	it('removes shared documents from recent history', () => {
		const values = new Map([
			[
				SHARED_DOCUMENTS_KEY,
				JSON.stringify([
					{ endpoint: 'wss://example.com/socket', workspace: 'alpha', updatedAt: 1 },
					{ endpoint: 'wss://example.com/socket', workspace: 'beta', updatedAt: 2 }
				])
			]
		]);
		const storage = {
			getItem: vi.fn((key: string) => values.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => values.set(key, value))
		} as unknown as Storage;

		expect(
			removeSharedDocumentHistory(
				{ endpoint: 'wss://example.com/socket', workspace: 'alpha' },
				storage
			)
		).toEqual([{ endpoint: 'wss://example.com/socket', workspace: 'beta', updatedAt: 2 }]);
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

describe('formatPageTitle', () => {
	it('names the open document', () => {
		expect(formatPageTitle('Meeting notes')).toBe('LightNote - Meeting notes');
		expect(formatPageTitle('  Meeting notes  ')).toBe('LightNote - Meeting notes');
	});

	it('falls back to the app name for an empty or missing title', () => {
		expect(formatPageTitle('')).toBe('LightNote');
		expect(formatPageTitle('   ')).toBe('LightNote');
		expect(formatPageTitle()).toBe('LightNote');
	});
});

describe('isCellSelection', () => {
	const schema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);
	const cell = (text: string, type: 'tableHeader' | 'tableCell') => ({
		type,
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
	});
	const doc = schema.nodeFromJSON({
		type: 'doc',
		content: [
			{
				type: 'table',
				content: [
					{ type: 'tableRow', content: [cell('a', 'tableHeader'), cell('b', 'tableHeader')] },
					{ type: 'tableRow', content: [cell('1', 'tableCell'), cell('2', 'tableCell')] }
				]
			}
		]
	});
	const cellPositions: number[] = [];

	doc.descendants((node, pos) => {
		if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
			cellPositions.push(pos);
		}
	});

	it('detects a selection of a single cell, which has only one range', () => {
		const selection = CellSelection.create(doc, cellPositions[0]);

		// The trap this guard exists for: one range looks exactly like a text
		// selection, so counting ranges would let a single cell through.
		expect(selection.ranges).toHaveLength(1);
		expect(isCellSelection(selection)).toBe(true);
	});

	it('detects a selection spanning several cells', () => {
		const selection = CellSelection.create(doc, cellPositions[0], cellPositions[3]);

		expect(isCellSelection(selection)).toBe(true);
	});

	it('leaves a text selection inside a cell alone', () => {
		const selection = TextSelection.create(doc, cellPositions[0] + 2, cellPositions[0] + 3);

		expect(isCellSelection(selection)).toBe(false);
	});
});

describe('document list visibility', () => {
	function fakeStorage(initial: Record<string, string> = {}) {
		const values = new Map(Object.entries(initial));

		return {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value)
		} as unknown as Storage;
	}

	it('opens the docked list by default and remembers it collapsed', () => {
		const storage = fakeStorage();

		expect(readSidebarOpen(storage, true)).toBe(true);

		writeSidebarOpen(storage, true, false);

		expect(readSidebarOpen(storage, true)).toBe(false);
	});

	it('starts the overlaid list closed whatever the docked preference is', () => {
		// Below `lg` the list covers the note, so restoring it open would hide the
		// document the user came back to read.
		expect(readSidebarOpen(fakeStorage({ sidebar: 'open' }), false)).toBe(false);
	});

	it('does not let the overlaid list overwrite the docked preference', () => {
		const storage = fakeStorage({ sidebar: 'open' });

		writeSidebarOpen(storage, false, false);

		expect(readSidebarOpen(storage, true)).toBe(true);
	});
});

describe('checkUrlInsert', () => {
	it('accepts the protocols each kind can render', () => {
		expect(checkUrlInsert('link', 'https://example.com')).toEqual({
			status: 'ok',
			url: 'https://example.com'
		});
		expect(checkUrlInsert('link', 'mailto:a@b.com').status).toBe('ok');
		expect(checkUrlInsert('image', 'data:image/png;base64,AAA').status).toBe('ok');
		expect(checkUrlInsert('youtube', 'https://youtu.be/abc').status).toBe('ok');
	});

	it('trims the address before applying it', () => {
		expect(checkUrlInsert('image', '  https://example.com/a.png  ')).toEqual({
			status: 'ok',
			url: 'https://example.com/a.png'
		});
	});

	it('rejects a protocol the kind cannot render', () => {
		// A javascript: URL must never reach setLink or setImage.
		expect(checkUrlInsert('link', 'javascript:alert(1)').status).toBe('invalid');
		expect(checkUrlInsert('image', 'mailto:a@b.com').status).toBe('invalid');
		// data: renders an image but is not a page or a video.
		expect(checkUrlInsert('youtube', 'data:text/html,hi').status).toBe('invalid');
		expect(checkUrlInsert('link', 'example.com').status).toBe('invalid');
	});

	it('reads an empty box as removing the link, and as nothing to insert otherwise', () => {
		expect(checkUrlInsert('link', '   ')).toEqual({ status: 'clear' });
		expect(checkUrlInsert('image', '')).toEqual({ status: 'invalid', message: 'Enter a URL.' });
		expect(checkUrlInsert('youtube', '')).toMatchObject({ status: 'invalid' });
	});
});
