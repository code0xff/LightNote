import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
	CURRENT_DOCUMENT_ID_KEY,
	DB_BLOCKED_MESSAGE,
	DB_OUTDATED_MESSAGE,
	createDocument,
	describeOpenError,
	openRequestToPromise,
	deleteDocument,
	ensureInitialDocument,
	getDocument,
	getStoredCurrentDocumentId,
	listDocuments,
	migrateLegacyAutoSave,
	moveDocumentTo,
	normalizeDocument,
	reorderDocuments,
	sortDocuments,
	setStoredCurrentDocumentId,
	updateDocument,
	LEGACY_AUTO_SAVE_KEY
} from './store';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map<string, string>(Object.entries(initial));

	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value))
	} as unknown as Storage;
}

/** Minimal stand-in for an open request whose handlers the test fires. */
function fakeOpenRequest(result?: unknown, error?: { name?: string } | null) {
	return {
		onsuccess: null,
		onerror: null,
		onblocked: null,
		result,
		error
	} as unknown as IDBOpenDBRequest & {
		onsuccess: (() => void) | null;
		onerror: (() => void) | null;
		onblocked: (() => void) | null;
	};
}

describe('opening the database', () => {
	it('closes its connection when another tab needs to upgrade', async () => {
		const close = vi.fn();
		const db = { close } as unknown as IDBDatabase;
		const request = fakeOpenRequest(db);
		const promise = openRequestToPromise(request);

		request.onsuccess?.();

		const opened = await promise;
		expect(opened).toBe(db);

		// Without this, one open tab would block the next version indefinitely.
		(opened.onversionchange as unknown as () => void)();
		expect(close).toHaveBeenCalled();
	});

	it('explains a stale build instead of surfacing VersionError', async () => {
		const request = fakeOpenRequest(undefined, { name: 'VersionError' });
		const promise = openRequestToPromise(request);

		request.onerror?.();

		await expect(promise).rejects.toThrow(DB_OUTDATED_MESSAGE);
		expect(describeOpenError({ name: 'VersionError' }).message).toBe(DB_OUTDATED_MESSAGE);
		expect(describeOpenError(null).message).toContain('Failed to open');
		expect(describeOpenError(new Error('boom')).message).toBe('boom');
	});

	it('tolerates a momentary block but reports one that persists', async () => {
		vi.useFakeTimers();

		try {
			// A block that clears before the timeout resolves normally.
			const db = { close: vi.fn() } as unknown as IDBDatabase;
			const transient = fakeOpenRequest(db);
			const resolved = openRequestToPromise(transient, 3000);

			transient.onblocked?.();
			vi.advanceTimersByTime(1000);
			transient.onsuccess?.();
			await expect(resolved).resolves.toBe(db);

			// One that never clears rejects instead of hanging forever.
			const stuck = fakeOpenRequest();
			const rejected = openRequestToPromise(stuck, 3000);

			stuck.onblocked?.();
			// Repeated blocked events must not stack timers.
			stuck.onblocked?.();
			vi.advanceTimersByTime(3000);

			await expect(rejected).rejects.toThrow(DB_BLOCKED_MESSAGE);
		} finally {
			vi.useRealTimers();
		}
	});

	it('closes a connection that arrives after the blocked timeout gave up', async () => {
		vi.useFakeTimers();

		try {
			const close = vi.fn();
			const request = fakeOpenRequest({ close } as unknown as IDBDatabase);
			const rejected = openRequestToPromise(request, 3000);

			request.onblocked?.();
			vi.advanceTimersByTime(3000);
			await expect(rejected).rejects.toThrow(DB_BLOCKED_MESSAGE);

			// The open request stays live; nobody would ever close a late connection,
			// and leaving it open would block the next upgrade until reload.
			request.onsuccess?.();
			expect(close).toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

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

	it('leaves a record with no content at all empty', () => {
		expect(
			normalizeDocument({ id: 'doc-1', title: 'Empty', createdAt: 1, updatedAt: 2 }).content
		).toBe('');
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
			// Seeded from `createdAt`, so a record written before manual ordering
			// existed keeps exactly the place it already had.
			order: 1,
			sourceFileName: undefined
		});
	});

	it('keeps a stored order over the seeded one', () => {
		expect(
			normalizeDocument({
				id: 'doc-1',
				title: 'Moved',
				html: '<p>Saved</p>',
				createdAt: 1,
				updatedAt: 2,
				order: 4
			}).order
		).toBe(4);
	});

	it('keeps document list order stable by creation time', () => {
		expect(
			sortDocuments([
				legacyDocument({ id: 'newer', createdAt: 2, updatedAt: 3, order: 2 }),
				legacyDocument({ id: 'older', createdAt: 1, updatedAt: 10, order: 1 })
			]).map((document) => document.id)
		).toEqual(['older', 'newer']);
	});

	it('sorts by the manual order, not by creation time', () => {
		expect(
			sortDocuments([
				legacyDocument({ id: 'first-made', createdAt: 1, order: 2 }),
				legacyDocument({ id: 'moved-up', createdAt: 9, order: 1 })
			]).map((document) => document.id)
		).toEqual(['moved-up', 'first-made']);
	});

	it('breaks an order tie by creation time', () => {
		// Two documents can only share an order value if both were seeded from the
		// same creation time, but the sort must still be deterministic.
		expect(
			sortDocuments([
				legacyDocument({ id: 'b', createdAt: 5, order: 1 }),
				legacyDocument({ id: 'a', createdAt: 2, order: 1 })
			]).map((document) => document.id)
		).toEqual(['a', 'b']);
	});
});

describe('moveDocumentTo', () => {
	const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

	it('moves a document down and up', () => {
		expect(moveDocumentTo(list, 'a', 2).map((item) => item.id)).toEqual(['b', 'c', 'a']);
		expect(moveDocumentTo(list, 'c', 0).map((item) => item.id)).toEqual(['c', 'a', 'b']);
	});

	it('clamps a target past either end', () => {
		expect(moveDocumentTo(list, 'a', 99).map((item) => item.id)).toEqual(['b', 'c', 'a']);
		expect(moveDocumentTo(list, 'c', -5).map((item) => item.id)).toEqual(['c', 'a', 'b']);
	});

	it('returns the same array when nothing moves, so the caller can skip the write', () => {
		expect(moveDocumentTo(list, 'b', 1)).toBe(list);
		expect(moveDocumentTo(list, 'missing', 0)).toBe(list);
	});
});

/** A stored record as it comes off IndexedDB, before `normalizeDocument`. */
function legacyDocument(overrides: {
	id: string;
	createdAt: number;
	updatedAt?: number;
	order?: number;
}) {
	return normalizeDocument({
		title: 'Doc',
		html: '<p>Doc</p>',
		updatedAt: overrides.updatedAt ?? overrides.createdAt,
		...overrides
	});
}

describe('document store CRUD (IndexedDB)', () => {
	it('creates a document with defaults and reads it back', async () => {
		const factory = new IDBFactory();

		const created = await createDocument({ now: 100 }, factory);

		expect(created).toMatchObject({
			title: 'Untitled',
			// Empty, not a guide: a first-run document that has to be cleared before
			// it can be written in is worse than a blank page.
			content: '',
			contentFormat: 'html',
			createdAt: 100,
			updatedAt: 100
		});
		expect(typeof created.id).toBe('string');

		const fetched = await getDocument(created.id, factory);
		expect(fetched).toEqual(created);
	});

	it('returns null when a document is missing', async () => {
		const factory = new IDBFactory();

		expect(await getDocument('nope', factory)).toBeNull();
	});

	it('lists documents ordered by creation time', async () => {
		const factory = new IDBFactory();

		await createDocument({ title: 'B', now: 2 }, factory);
		await createDocument({ title: 'A', now: 1 }, factory);

		const documents = await listDocuments(factory);

		expect(documents.map((document) => document.title)).toEqual(['A', 'B']);
	});

	it('updates fields and refreshes updatedAt', async () => {
		const factory = new IDBFactory();
		const created = await createDocument({ title: 'Draft', now: 1 }, factory);

		const updated = await updateDocument(
			created.id,
			{ title: 'Final', content: '<p>Body</p>', contentFormat: 'html', now: 5 },
			factory
		);

		expect(updated).toMatchObject({
			id: created.id,
			title: 'Final',
			content: '<p>Body</p>',
			createdAt: 1,
			updatedAt: 5
		});

		const stored = await getDocument(created.id, factory);
		expect(stored).toEqual(updated);
		// The input-only `now` must not leak into the returned or stored document.
		expect(updated).not.toHaveProperty('now');
		expect(stored).not.toHaveProperty('now');
	});

	it('throws when updating a missing document', async () => {
		const factory = new IDBFactory();

		await expect(updateDocument('missing', { title: 'x' }, factory)).rejects.toThrow(
			'Document not found'
		);
	});

	it('deletes a document', async () => {
		const factory = new IDBFactory();
		const created = await createDocument({ now: 1 }, factory);

		await deleteDocument(created.id, factory);

		expect(await getDocument(created.id, factory)).toBeNull();
	});

	it('preserves data across concurrent updates to distinct fields', async () => {
		const factory = new IDBFactory();
		const created = await createDocument({ title: 'Start', now: 1 }, factory);

		await Promise.all([
			updateDocument(created.id, { title: 'Renamed', now: 2 }, factory),
			updateDocument(created.id, { content: '<p>New body</p>', now: 3 }, factory)
		]);

		const finalDocument = await getDocument(created.id, factory);

		// Same-transaction read-modify-write serializes the two updates, so
		// neither field is clobbered by the other.
		expect(finalDocument).toMatchObject({
			id: created.id,
			title: 'Renamed',
			content: '<p>New body</p>'
		});
	});
});

describe('ensureInitialDocument and legacy migration', () => {
	it('creates and remembers an initial document when the store is empty', async () => {
		const factory = new IDBFactory();
		const storage = memoryStorage();

		const document = await ensureInitialDocument(storage, factory);

		expect(document.id).toBeTruthy();
		expect(storage.setItem).toHaveBeenCalledWith(CURRENT_DOCUMENT_ID_KEY, document.id);
		expect(await listDocuments(factory)).toHaveLength(1);
	});

	it('restores the stored current document when it exists', async () => {
		const factory = new IDBFactory();
		const created = await createDocument({ title: 'Kept', now: 1 }, factory);
		const storage = memoryStorage({ [CURRENT_DOCUMENT_ID_KEY]: created.id });

		const document = await ensureInitialDocument(storage, factory);

		expect(document.id).toBe(created.id);
	});

	it('migrates a legacy auto-saved blob into a document', async () => {
		const factory = new IDBFactory();
		const storage = memoryStorage({ [LEGACY_AUTO_SAVE_KEY]: '<p>Legacy</p>' });

		const migrated = await migrateLegacyAutoSave(storage, factory);

		expect(migrated).toMatchObject({
			title: 'LightNote',
			content: '<p>Legacy</p>',
			contentFormat: 'html'
		});
	});

	it('does not migrate when documents already exist', async () => {
		const factory = new IDBFactory();
		await createDocument({ now: 1 }, factory);
		const storage = memoryStorage({ [LEGACY_AUTO_SAVE_KEY]: '<p>Legacy</p>' });

		expect(await migrateLegacyAutoSave(storage, factory)).toBeNull();
	});
});

describe('reorderDocuments', () => {
	it('writes the new order without touching updatedAt', async () => {
		const factory = new IDBFactory();
		const first = await createDocument({ title: 'First', now: 100 }, factory);
		const second = await createDocument({ title: 'Second', now: 200 }, factory);

		await reorderDocuments([second.id, first.id], factory);

		const documents = await listDocuments(factory);

		expect(documents.map((document) => document.title)).toEqual(['Second', 'First']);
		// Moving a card is not editing the document, and the card shows this date.
		expect(documents.map((document) => document.updatedAt)).toEqual([200, 100]);
	});

	it('skips ids that no longer exist', async () => {
		const factory = new IDBFactory();
		const first = await createDocument({ title: 'First', now: 100 }, factory);
		const second = await createDocument({ title: 'Second', now: 200 }, factory);

		await reorderDocuments(['deleted-elsewhere', second.id, first.id], factory);

		expect((await listDocuments(factory)).map((document) => document.title)).toEqual([
			'Second',
			'First'
		]);
	});
});
