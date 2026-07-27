import { defaultContent } from '$lib/editor/constants';
import type { JSONContent } from '@tiptap/core';

export const CURRENT_DOCUMENT_ID_KEY = 'currentDocumentId';
export const LEGACY_AUTO_SAVE_KEY = 'auto_saved';

const DB_NAME = 'light-note';
const DB_VERSION = 3;
const DOCUMENT_STORE = 'documents';
const UNTITLED_TITLE = 'Untitled';

/**
 * AI conversation history, scoped per document. Lives in the same database so
 * one place owns the schema version; the records themselves are managed by
 * `$lib/ai/historyStore`.
 */
export const AI_HISTORY_STORE = 'aiHistory';
export const AI_HISTORY_DOCUMENT_INDEX = 'documentKey';

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

		if (!db.objectStoreNames.contains(AI_HISTORY_STORE)) {
			const store = db.createObjectStore(AI_HISTORY_STORE, { keyPath: 'id' });

			store.createIndex(AI_HISTORY_DOCUMENT_INDEX, 'documentKey');
		}
	};

	return requestToPromise(request);
}

/**
 * Runs one request against a named object store. Exported so the AI history
 * module can reuse this database without opening it at a second version.
 */
export async function withStore<T>(
	storeName: string,
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
	factory?: IDBFactory
): Promise<T> {
	const db = await openDatabase(factory);
	const transaction = db.transaction(storeName, mode);
	const store = transaction.objectStore(storeName);

	try {
		const result = await requestToPromise(run(store));
		await transactionDone(transaction);

		return result;
	} finally {
		db.close();
	}
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
	return [...documents].sort((a, b) => a.createdAt - b.createdAt);
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
	const documents = await withStore<LegacyLightNoteDocument[]>(
		DOCUMENT_STORE,
		'readonly',
		(store) => store.getAll(),
		factory
	);

	return sortDocuments(documents.map(normalizeDocument));
}

export async function getDocument(id: string, factory?: IDBFactory) {
	const document = await withStore<LegacyLightNoteDocument | undefined>(
		DOCUMENT_STORE,
		'readonly',
		(store) => store.get(id),
		factory
	);

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

	await withStore(DOCUMENT_STORE, 'readwrite', (store) => store.add(document), factory);

	return document;
}

export async function updateDocument(id: string, input: UpdateDocumentInput, factory?: IDBFactory) {
	const { now, ...changes } = input;
	const db = await openDatabase(factory);
	const transaction = db.transaction(DOCUMENT_STORE, 'readwrite');
	const store = transaction.objectStore(DOCUMENT_STORE);

	// Read and write in the same transaction so concurrent updates serialize
	// instead of clobbering each other, and so the input-only `now` never
	// leaks into the stored/returned document.
	const updatedPromise = new Promise<LightNoteDocument>((resolve, reject) => {
		const getRequest = store.get(id);

		getRequest.onerror = () => reject(getRequest.error ?? new Error('IndexedDB request failed'));
		getRequest.onsuccess = () => {
			const existing = getRequest.result as LegacyLightNoteDocument | undefined;

			if (!existing) {
				reject(new Error(`Document not found: ${id}`));
				return;
			}

			const normalized = normalizeDocument(existing);
			const updated: LightNoteDocument = {
				...normalized,
				...changes,
				title: changes.title === undefined ? normalized.title : normalizeTitle(changes.title),
				updatedAt: now ?? Date.now()
			};
			const putRequest = store.put(updated);

			putRequest.onerror = () => reject(putRequest.error ?? new Error('IndexedDB request failed'));
			putRequest.onsuccess = () => resolve(updated);
		};
	});

	try {
		const updated = await updatedPromise;
		await transactionDone(transaction);

		return updated;
	} finally {
		db.close();
	}
}

export async function deleteDocument(id: string, factory?: IDBFactory) {
	await withStore(DOCUMENT_STORE, 'readwrite', (store) => store.delete(id), factory);
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
