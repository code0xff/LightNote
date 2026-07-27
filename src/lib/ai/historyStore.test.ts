import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
	appendAiHistory,
	buildHistoryEntry,
	clearAiHistory,
	deleteAiHistoryEntry,
	documentHistoryKey,
	listAiHistory,
	sharedHistoryKey,
	sortHistory,
	truncateEntryText,
	type AiHistoryInput
} from './historyStore';
import { AI_HISTORY_STORE, withStore } from '$lib/documents/store';

function askEntry(overrides: Partial<AiHistoryInput> = {}): AiHistoryInput {
	return {
		documentKey: documentHistoryKey('d1'),
		mode: 'ask',
		action: 'prompt',
		prompt: 'write an intro',
		response: 'Once upon a time',
		...overrides
	};
}

describe('history keys', () => {
	it('scopes by document id and by shared workspace', () => {
		expect(documentHistoryKey('d1')).toBe('doc:d1');
		expect(sharedHistoryKey({ endpoint: 'ws://localhost:1234', workspace: 'team' })).toBe(
			`shared:${encodeURIComponent('ws://localhost:1234')}/team`
		);
	});

	it('does not let slashes in the endpoint or workspace collide', () => {
		expect(sharedHistoryKey({ endpoint: 'ws://host/a', workspace: 'b' })).not.toBe(
			sharedHistoryKey({ endpoint: 'ws://host', workspace: 'a/b' })
		);
	});
});

describe('entry building', () => {
	it('caps long text and stamps the given time and id', () => {
		const entry = buildHistoryEntry(
			askEntry({
				id: 'fixed',
				now: 1_000,
				prompt: 'a'.repeat(20),
				response: 'b'.repeat(20),
				selection: 'c'.repeat(20)
			})
		);

		expect(entry.id).toBe('fixed');
		expect(entry.createdAt).toBe(1_000);
		expect(truncateEntryText('abcdef', 3)).toBe('abc…');
		expect(truncateEntryText('abc', 3)).toBe('abc');
		// The default limit is well above these, so they stay intact.
		expect(entry.prompt).toHaveLength(20);
	});

	it('omits an empty selection', () => {
		expect(buildHistoryEntry(askEntry({ selection: '' })).selection).toBeUndefined();
	});

	it('sorts oldest first', () => {
		const entries = [
			buildHistoryEntry(askEntry({ id: 'b', now: 2 })),
			buildHistoryEntry(askEntry({ id: 'a', now: 1 }))
		];

		expect(sortHistory(entries).map((entry) => entry.id)).toEqual(['a', 'b']);
	});
});

describe('history persistence', () => {
	it('reads back only the entries of the requested document', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(askEntry({ id: 'one', now: 1 }), factory);
		await appendAiHistory(askEntry({ id: 'two', now: 2 }), factory);
		await appendAiHistory(
			askEntry({ id: 'other', now: 3, documentKey: documentHistoryKey('d2') }),
			factory
		);

		expect((await listAiHistory(documentHistoryKey('d1'), factory)).map((e) => e.id)).toEqual([
			'one',
			'two'
		]);
		expect((await listAiHistory(documentHistoryKey('d2'), factory)).map((e) => e.id)).toEqual([
			'other'
		]);
		expect(await listAiHistory(documentHistoryKey('missing'), factory)).toEqual([]);
	});

	it('keeps agent steps and errors', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(
			{
				documentKey: documentHistoryKey('d1'),
				mode: 'agent',
				prompt: 'draft a plan',
				response: 'created it',
				steps: [{ description: 'Create a new document "Plan"', status: 'done' }],
				error: 'stopped early',
				id: 'agent-1',
				now: 5
			},
			factory
		);

		const [entry] = await listAiHistory(documentHistoryKey('d1'), factory);

		expect(entry).toMatchObject({
			mode: 'agent',
			steps: [{ description: 'Create a new document "Plan"', status: 'done' }],
			error: 'stopped early'
		});
	});

	it('prunes the oldest entries beyond the cap', async () => {
		const factory = new IDBFactory();

		for (let index = 0; index < 5; index += 1) {
			await appendAiHistory(askEntry({ id: `e${index}`, now: index }), factory, 3);
		}

		expect((await listAiHistory(documentHistoryKey('d1'), factory)).map((e) => e.id)).toEqual([
			'e2',
			'e3',
			'e4'
		]);
	});

	it('deletes a single entry and clears a whole document', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(askEntry({ id: 'one', now: 1 }), factory);
		await appendAiHistory(askEntry({ id: 'two', now: 2 }), factory);
		await appendAiHistory(
			askEntry({ id: 'other', now: 3, documentKey: documentHistoryKey('d2') }),
			factory
		);

		await deleteAiHistoryEntry('one', factory);
		expect((await listAiHistory(documentHistoryKey('d1'), factory)).map((e) => e.id)).toEqual([
			'two'
		]);

		await clearAiHistory(documentHistoryKey('d1'), factory);
		expect(await listAiHistory(documentHistoryKey('d1'), factory)).toEqual([]);
		// Clearing one document leaves the others untouched.
		expect((await listAiHistory(documentHistoryKey('d2'), factory)).map((e) => e.id)).toEqual([
			'other'
		]);
	});

	it('returns the pruned list so callers never show deleted entries', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(askEntry({ id: 'e0', now: 0 }), factory, 2);
		await appendAiHistory(askEntry({ id: 'e1', now: 1 }), factory, 2);
		const { entry, entries } = await appendAiHistory(askEntry({ id: 'e2', now: 2 }), factory, 2);

		expect(entry.id).toBe('e2');
		expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);
		expect(entries).toEqual(await listAiHistory(documentHistoryKey('d1'), factory));
	});

	it('drops malformed steps instead of handing them to the UI', async () => {
		const factory = new IDBFactory();

		await withStore(
			AI_HISTORY_STORE,
			'readwrite',
			(store) =>
				store.put({
					id: 'mixed',
					documentKey: documentHistoryKey('d1'),
					mode: 'agent',
					prompt: 'do it',
					response: 'done',
					createdAt: 1,
					steps: [
						null,
						{ description: 'ok', status: 'done' },
						{ status: 'done' },
						{ description: 'x', status: 'bogus' }
					]
				}),
			factory
		);

		const [entry] = await listAiHistory(documentHistoryKey('d1'), factory);

		expect(entry.steps).toEqual([{ description: 'ok', status: 'done' }]);
	});

	it('caps step and error text', async () => {
		const entry = buildHistoryEntry(
			askEntry({
				id: 'long',
				now: 1,
				error: 'e'.repeat(600),
				steps: [{ description: 'd'.repeat(600), status: 'done', error: 'x'.repeat(600) }]
			})
		);

		expect(entry.error).toHaveLength(501);
		expect(entry.steps?.[0].description).toHaveLength(501);
		expect(entry.steps?.[0].error).toHaveLength(501);
	});

	it('clears records that are too malformed to read', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(askEntry({ id: 'good', now: 1 }), factory);
		await withStore(
			AI_HISTORY_STORE,
			'readwrite',
			(store) => store.put({ id: 'bad', documentKey: documentHistoryKey('d1') }),
			factory
		);

		await clearAiHistory(documentHistoryKey('d1'), factory);

		const remaining = await withStore<unknown[]>(
			AI_HISTORY_STORE,
			'readonly',
			(store) => store.getAll(),
			factory
		);
		expect(remaining).toEqual([]);
	});

	it('skips malformed records instead of failing the read', async () => {
		const factory = new IDBFactory();

		await appendAiHistory(askEntry({ id: 'good', now: 1 }), factory);
		await withStore(
			AI_HISTORY_STORE,
			'readwrite',
			(store) => store.put({ id: 'bad', documentKey: documentHistoryKey('d1') }),
			factory
		);

		expect((await listAiHistory(documentHistoryKey('d1'), factory)).map((e) => e.id)).toEqual([
			'good'
		]);
	});
});
