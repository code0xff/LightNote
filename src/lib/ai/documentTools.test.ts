import { describe, expect, it, vi } from 'vitest';
import {
	appendToContent,
	createDocumentToolExecutor,
	documentToPlainText,
	toContentNodes,
	toDocumentContent,
	type DocumentToolDeps
} from './documentTools';
import type { LightNoteDocument } from '$lib/documents/store';

function document(overrides: Partial<LightNoteDocument> = {}): LightNoteDocument {
	return {
		id: 'd1',
		title: 'Notes',
		content: { type: 'doc', content: toContentNodes('stored body') },
		contentFormat: 'tiptap-json',
		createdAt: 1_000,
		updatedAt: 2_000,
		...overrides
	};
}

function deps(overrides: Partial<DocumentToolDeps> = {}) {
	const editor = {
		getText: vi.fn(() => 'editor text'),
		hasSelection: vi.fn(() => true),
		insertAtCursor: vi.fn(),
		replaceSelection: vi.fn(),
		setContent: vi.fn(),
		appendContent: vi.fn(),
		setTitle: vi.fn()
	};
	const store = {
		listDocuments: vi.fn(async () => [document()]),
		getDocument: vi.fn(async (id: string) => (id === 'd1' ? document() : null)),
		createDocument: vi.fn(async (input: { title: string }) =>
			document({ id: 'new', title: input.title })
		),
		updateDocument: vi.fn(async (id: string, input: { title?: string }) =>
			document({ id, title: input.title ?? 'Notes' })
		)
	};
	const onStoreChanged = vi.fn();
	const openDocument = vi.fn();

	const resolved = {
		store,
		editor,
		getCurrentDocumentId: () => 'd1',
		getCurrentDocumentTitle: () => 'Notes',
		onStoreChanged,
		openDocument,
		...overrides
	} as DocumentToolDeps;

	return { deps: resolved, store, editor, onStoreChanged, openDocument };
}

describe('text and content conversion', () => {
	it('splits paragraphs on blank lines and single newlines into hard breaks', () => {
		expect(toContentNodes('one\ntwo\n\nthree')).toEqual([
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'one' },
					{ type: 'hardBreak' },
					{ type: 'text', text: 'two' }
				]
			},
			{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }
		]);
	});

	it('always produces a non-empty doc', () => {
		expect(toDocumentContent('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
		expect(toDocumentContent('body').content).toHaveLength(1);
	});

	it('flattens tiptap json to text, including lists and hard breaks', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', content: [{ type: 'text', text: 'Title' }] },
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'first' },
						{ type: 'hardBreak' },
						{ type: 'text', text: 'second' }
					]
				},
				{
					type: 'bulletList',
					content: [
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]
						},
						{
							type: 'listItem',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }]
						}
					]
				}
			]
		};

		expect(documentToPlainText(content)).toBe('Title\n\nfirst\nsecond\n\na\nb');
	});

	it('flattens legacy html content to text', () => {
		expect(documentToPlainText('<p>one<br>two</p><p>three &amp; four</p>')).toBe(
			'one\ntwo\n\nthree & four'
		);
	});

	it('appends in the format the document already uses', () => {
		expect(
			appendToContent(document({ content: '<p>old</p>', contentFormat: 'html' }), 'new\nline')
		).toEqual({ content: '<p>old</p><p>new<br>line</p>', contentFormat: 'html' });

		const appended = appendToContent(document(), 'new');
		expect(appended.contentFormat).toBe('tiptap-json');
		expect(documentToPlainText(appended.content as never)).toBe('stored body\n\nnew');
	});
});

describe('read tools', () => {
	it('lists documents and flags the open one', async () => {
		const { deps: resolved } = deps();
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({ name: 'list_documents', args: {} });

		expect(result).toEqual({
			ok: true,
			data: {
				documents: [
					{
						id: 'd1',
						title: 'Notes',
						updatedAt: new Date(2_000).toISOString(),
						current: true
					}
				]
			}
		});
	});

	it('reads the open document from the editor, not the store', async () => {
		const { deps: resolved, store, editor } = deps();
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({ name: 'read_document', args: {} });

		expect(result).toEqual({
			ok: true,
			data: { id: 'd1', title: 'Notes', current: true, text: 'editor text', truncated: false }
		});
		expect(editor.getText).toHaveBeenCalled();
		expect(store.getDocument).not.toHaveBeenCalled();

		// An explicit id matching the open document takes the same path.
		await execute({ name: 'read_document', args: { id: 'd1' } });
		expect(store.getDocument).not.toHaveBeenCalled();
	});

	it('reads another document from the store and caps long text', async () => {
		const { deps: resolved } = deps({
			getCurrentDocumentId: () => 'other',
			textLimit: 5
		});
		const execute = createDocumentToolExecutor(resolved);

		expect(await execute({ name: 'read_document', args: { id: 'd1' } })).toEqual({
			ok: true,
			data: { id: 'd1', title: 'Notes', current: false, text: 'store', truncated: true }
		});
	});

	it('reports a missing document', async () => {
		const { deps: resolved } = deps({ getCurrentDocumentId: () => 'other' });
		const execute = createDocumentToolExecutor(resolved);

		expect(await execute({ name: 'read_document', args: { id: 'ghost' } })).toEqual({
			ok: false,
			error: 'Document not found: ghost'
		});
	});
});

describe('editor write tools', () => {
	it('inserts at the cursor', async () => {
		const { deps: resolved, editor } = deps();
		const execute = createDocumentToolExecutor(resolved);

		expect(await execute({ name: 'insert_at_cursor', args: { text: 'added' } })).toEqual({
			ok: true,
			data: { inserted: 5 }
		});
		expect(editor.insertAtCursor).toHaveBeenCalledWith(toContentNodes('added'));
	});

	it('refuses to replace when nothing is selected', async () => {
		const { deps: resolved, editor } = deps();
		editor.hasSelection.mockReturnValue(false);
		const execute = createDocumentToolExecutor(resolved);

		expect(await execute({ name: 'replace_selection', args: { text: 'x' } })).toEqual({
			ok: false,
			error: 'There is no selected text to replace.'
		});
		expect(editor.replaceSelection).not.toHaveBeenCalled();
	});
});

describe('create_document', () => {
	it('creates, notifies, and opens the new document', async () => {
		const { deps: resolved, store, onStoreChanged, openDocument } = deps();
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({
			name: 'create_document',
			args: { title: 'Plan', text: 'first\n\nsecond' }
		});

		expect(store.createDocument).toHaveBeenCalledWith({
			title: 'Plan',
			content: toDocumentContent('first\n\nsecond'),
			contentFormat: 'tiptap-json'
		});
		expect(onStoreChanged).toHaveBeenCalled();
		expect(openDocument).toHaveBeenCalled();
		expect(result).toEqual({ ok: true, data: { id: 'new', title: 'Plan', opened: true } });
	});

	it('is refused in sharing mode', async () => {
		const { deps: resolved, store } = deps({ isSharingMode: true });
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({ name: 'create_document', args: { title: 'a', text: 'b' } });

		expect(result.ok).toBe(false);
		expect(store.createDocument).not.toHaveBeenCalled();
	});
});

describe('update_document', () => {
	it('routes edits to the open document through the editor so they stay undoable', async () => {
		const { deps: resolved, store, editor } = deps();
		const execute = createDocumentToolExecutor(resolved);

		expect(
			await execute({
				name: 'update_document',
				args: { title: 'Renamed', text: 'body', mode: 'replace' }
			})
		).toEqual({ ok: true, data: { id: 'd1', current: true, mode: 'replace' } });

		expect(editor.setContent).toHaveBeenCalledWith(toContentNodes('body'));
		expect(editor.setTitle).toHaveBeenCalledWith('Renamed');
		expect(store.updateDocument).not.toHaveBeenCalled();

		await execute({ name: 'update_document', args: { text: 'more', mode: 'append' } });
		expect(editor.appendContent).toHaveBeenCalledWith(toContentNodes('more'));
	});

	it('writes another document through the store and refreshes the list', async () => {
		const {
			deps: resolved,
			store,
			editor,
			onStoreChanged
		} = deps({
			getCurrentDocumentId: () => 'other'
		});
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({
			name: 'update_document',
			args: { id: 'd1', title: 'Renamed', text: 'fresh', mode: 'replace' }
		});

		expect(store.updateDocument).toHaveBeenCalledWith('d1', {
			content: toDocumentContent('fresh'),
			contentFormat: 'tiptap-json',
			title: 'Renamed'
		});
		expect(editor.setContent).not.toHaveBeenCalled();
		expect(onStoreChanged).toHaveBeenCalled();
		expect(result).toEqual({ ok: true, data: { id: 'd1', title: 'Renamed', mode: 'replace' } });
	});

	it('appends to another document without changing its format', async () => {
		const { deps: resolved, store } = deps({ getCurrentDocumentId: () => 'other' });
		store.getDocument.mockResolvedValue(document({ content: '<p>old</p>', contentFormat: 'html' }));
		const execute = createDocumentToolExecutor(resolved);

		await execute({ name: 'update_document', args: { id: 'd1', text: 'new', mode: 'append' } });

		expect(store.updateDocument).toHaveBeenCalledWith('d1', {
			content: '<p>old</p><p>new</p>',
			contentFormat: 'html'
		});
	});

	it('renames another document without touching its body', async () => {
		const { deps: resolved, store } = deps({ getCurrentDocumentId: () => 'other' });
		const execute = createDocumentToolExecutor(resolved);

		await execute({
			name: 'update_document',
			args: { id: 'd1', title: 'Renamed', mode: 'replace' }
		});

		expect(store.updateDocument).toHaveBeenCalledWith('d1', { title: 'Renamed' });
	});

	it('reports a missing target document', async () => {
		const { deps: resolved } = deps({ getCurrentDocumentId: () => 'other' });
		const execute = createDocumentToolExecutor(resolved);

		expect(
			await execute({ name: 'update_document', args: { id: 'ghost', text: 'x', mode: 'replace' } })
		).toEqual({ ok: false, error: 'Document not found: ghost' });
	});

	it('still edits the open document in sharing mode, where there is no stored id', async () => {
		const { deps: resolved, editor } = deps({
			isSharingMode: true,
			getCurrentDocumentId: () => null
		});
		const execute = createDocumentToolExecutor(resolved);

		expect(
			await execute({ name: 'update_document', args: { text: 'body', mode: 'replace' } })
		).toEqual({ ok: true, data: { id: null, current: true, mode: 'replace' } });
		expect(editor.setContent).toHaveBeenCalledWith(toContentNodes('body'));
	});

	it('refuses to write another stored document in sharing mode', async () => {
		const { deps: resolved, store } = deps({
			isSharingMode: true,
			getCurrentDocumentId: () => null
		});
		const execute = createDocumentToolExecutor(resolved);

		const result = await execute({
			name: 'update_document',
			args: { id: 'd1', text: 'body', mode: 'replace' }
		});

		expect(result.ok).toBe(false);
		expect(store.updateDocument).not.toHaveBeenCalled();
	});
});
