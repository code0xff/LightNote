import { describe, expect, it, vi } from 'vitest';
import {
	CURRENT_DOCUMENT_ID_KEY,
	getStoredCurrentDocumentId,
	normalizeDocument,
	sortDocuments,
	setStoredCurrentDocumentId
} from './store';

describe('document store helpers', () => {
	it('stores and reads the current document id', () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: vi.fn((key: string) => values.get(key) ?? null),
			setItem: vi.fn((key: string, value: string) => values.set(key, value))
		} as unknown as Storage;

		setStoredCurrentDocumentId('doc-1', storage);

		expect(storage.setItem).toHaveBeenCalledWith(CURRENT_DOCUMENT_ID_KEY, 'doc-1');
		expect(getStoredCurrentDocumentId(storage)).toBe('doc-1');
	});

	it('normalizes legacy html documents to content documents', () => {
		expect(
			normalizeDocument({
				id: 'doc-1',
				title: 'Legacy',
				html: '<p>Saved</p>',
				createdAt: 1,
				updatedAt: 2
			})
		).toEqual({
			id: 'doc-1',
			title: 'Legacy',
			content: '<p>Saved</p>',
			contentFormat: 'html',
			createdAt: 1,
			updatedAt: 2,
			sourceFileName: undefined
		});
	});

	it('keeps document list order stable by creation time', () => {
		expect(
			sortDocuments([
				{
					id: 'newer',
					title: 'Newer',
					content: '<p>Newer</p>',
					contentFormat: 'html',
					createdAt: 2,
					updatedAt: 3
				},
				{
					id: 'older',
					title: 'Older',
					content: '<p>Older</p>',
					contentFormat: 'html',
					createdAt: 1,
					updatedAt: 10
				}
			]).map((document) => document.id)
		).toEqual(['older', 'newer']);
	});
});
