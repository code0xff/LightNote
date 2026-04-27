import { defaultContent } from '$lib/editor/constants';
import type { JSONContent } from '@tiptap/core';

export const CURRENT_DOCUMENT_ID_KEY = 'currentDocumentId';
export const LEGACY_AUTO_SAVE_KEY = 'auto_saved';

const DB_NAME = 'light-note';
const DB_VERSION = 2;
const DOCUMENT_STORE = 'documents';
const UNTITLED_TITLE = 'Untitled';

export type LightNoteDocument = {
	id: string;
	title: string;
	content: string | JSONContent;
	contentFormat: 'html' | 'tiptap-json';
	createdAt: number;
	updatedAt: number;
	sourceFileName?: string;
};

type CreateDocumentInput = {
	title?: string;
	content?: string | JSONContent;
	contentFormat?: LightNoteDocument['contentFormat'];
	sourceFileName?: string;
	now?: number;
};

type UpdateDocumentInput = Partial<
	Pick<LightNoteDocument, 'title' | 'content' | 'contentFormat' | 'sourceFileName'>
> & {
	now?: number;
};

type LegacyLightNoteDocument = Omit<LightNoteDocument, 'content' | 'contentFormat'> & {
	content?: string | JSONContent;
	contentFormat?: LightNoteDocument['contentFormat'];
	html?: string;
};

function requestToPromise<T>(request: IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionDone(transaction: IDBTransaction) {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
	});
}

function getIndexedDB(factory?: IDBFactory) {
	const resolvedFactory = factory ?? globalThis.indexedDB;

	if (!resolvedFactory) {
		throw new Error('IndexedDB is not available in this browser');
	}

	return resolvedFactory;
}

function openDatabase(factory?: IDBFactory) {
	const request = getIndexedDB(factory).open(DB_NAME, DB_VERSION);

	request.onupgradeneeded = () => {
		const db = request.result;

		if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
			const store = db.createObjectStore(DOCUMENT_STORE, { keyPath: 'id' });

			store.createIndex('updatedAt', 'updatedAt');
		}
	};

	return requestToPromise(request);
}

function normalizeTitle(title: string | undefined) {
	const normalizedTitle = title?.trim();

	return normalizedTitle || UNTITLED_TITLE;
}

function createDocumentId() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	return `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function sortDocuments(documents: LightNoteDocument[]) {
	return documents.sort((a, b) => a.createdAt - b.createdAt);
}

export function normalizeDocument(document: LegacyLightNoteDocument): LightNoteDocument {
	return {
		id: document.id,
		title: normalizeTitle(document.title),
		content: document.content ?? document.html ?? defaultContent,
		contentFormat: document.contentFormat ?? 'html',
		createdAt: document.createdAt,
		updatedAt: document.updatedAt,
		sourceFileName: document.sourceFileName
	};
}

export function getStoredCurrentDocumentId(storage: Storage = localStorage) {
	return storage.getItem(CURRENT_DOCUMENT_ID_KEY);
}

export function setStoredCurrentDocumentId(id: string, storage: Storage = localStorage) {
	storage.setItem(CURRENT_DOCUMENT_ID_KEY, id);
}

export async function listDocuments(factory?: IDBFactory) {
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readonly');
	const store = transaction.objectStore(DOCUMENT_STORE);
	const documents = await requestToPromise<LegacyLightNoteDocument[]>(store.getAll());

	await transactionDone(transaction);
	db.close();

	return sortDocuments(documents.map(normalizeDocument));
}

export async function getDocument(id: string, factory?: IDBFactory) {
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readonly');
	const store = transaction.objectStore(DOCUMENT_STORE);
	const document = await requestToPromise<LegacyLightNoteDocument | undefined>(store.get(id));

	await transactionDone(transaction);
	db.close();

	return document ? normalizeDocument(document) : null;
}

export async function createDocument(input: CreateDocumentInput = {}, factory?: IDBFactory) {
	const now = input.now ?? Date.now();
	const document: LightNoteDocument = {
		id: createDocumentId(),
		title: normalizeTitle(input.title),
		content: input.content ?? defaultContent,
		contentFormat: input.contentFormat ?? 'html',
		createdAt: now,
		updatedAt: now,
		sourceFileName: input.sourceFileName
	};
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readwrite');

	transaction.objectStore(DOCUMENT_STORE).add(document);
	await transactionDone(transaction);
	db.close();

	return document;
}

export async function updateDocument(id: string, input: UpdateDocumentInput, factory?: IDBFactory) {
	const existing = await getDocument(id, factory);

	if (!existing) {
		throw new Error(`Document not found: ${id}`);
	}

	const updated: LightNoteDocument = {
		...existing,
		...input,
		title: input.title === undefined ? existing.title : normalizeTitle(input.title),
		updatedAt: input.now ?? Date.now()
	};
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readwrite');

	transaction.objectStore(DOCUMENT_STORE).put(updated);
	await transactionDone(transaction);
	db.close();

	return updated;
}

export async function deleteDocument(id: string, factory?: IDBFactory) {
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readwrite');

	transaction.objectStore(DOCUMENT_STORE).delete(id);
	await transactionDone(transaction);
	db.close();
}

export async function migrateLegacyAutoSave(storage: Storage = localStorage, factory?: IDBFactory) {
	const documents = await listDocuments(factory);
	const legacyHtml = storage.getItem(LEGACY_AUTO_SAVE_KEY);

	if (documents.length > 0 || !legacyHtml) {
		return null;
	}

	return createDocument(
		{
			title: 'LightNote',
			content: legacyHtml,
			contentFormat: 'html'
		},
		factory
	);
}

export async function ensureInitialDocument(storage: Storage = localStorage, factory?: IDBFactory) {
	const migratedDocument = await migrateLegacyAutoSave(storage, factory);
	const documents = migratedDocument ? [migratedDocument] : await listDocuments(factory);
	const currentDocumentId = getStoredCurrentDocumentId(storage);
	const currentDocument = currentDocumentId ? await getDocument(currentDocumentId, factory) : null;
	const document = currentDocument ?? documents[0] ?? (await createDocument({}, factory));

	setStoredCurrentDocumentId(document.id, storage);

	return document;
}
