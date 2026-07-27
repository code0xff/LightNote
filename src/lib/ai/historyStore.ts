import { AI_HISTORY_DOCUMENT_INDEX, AI_HISTORY_STORE, withStore } from '$lib/documents/store';
import type { AgentStepStatus } from './agent';
import type { AiAction } from './openai';

/** Entries kept per document; older ones are pruned on append. */
export const MAX_HISTORY_ENTRIES = 50;

/** Caps a single entry so one huge document cannot bloat the history. */
const MAX_ENTRY_TEXT = 8000;

/** Step descriptions and error messages are short by nature; cap them tighter. */
const MAX_STEP_TEXT = 500;

/** An agent run is bounded at maxSteps × MAX_TOOL_CALLS_PER_STEP calls. */
const MAX_STEPS = 64;

export type AiHistoryStep = {
	description: string;
	status: AgentStepStatus;
	error?: string;
};

export type AiHistoryEntry = {
	id: string;
	/** Scope key from `documentHistoryKey` / `sharedHistoryKey`. */
	documentKey: string;
	mode: 'ask' | 'agent';
	action?: AiAction;
	prompt: string;
	selection?: string;
	response: string;
	steps?: AiHistoryStep[];
	error?: string;
	createdAt: number;
};

export type AiHistoryInput = Omit<AiHistoryEntry, 'id' | 'createdAt'> & {
	id?: string;
	now?: number;
};

export function documentHistoryKey(documentId: string): string {
	return `doc:${documentId}`;
}

/**
 * Shared sessions have no local document row, so their history is scoped by the
 * relay target instead — reopening the same workspace shows the same history.
 */
export function sharedHistoryKey(reference: { endpoint: string; workspace: string }): string {
	// Both parts can contain slashes, so they are encoded: without this,
	// `ws://host/a` + `b` and `ws://host` + `a/b` would share one history.
	return `shared:${encodeURIComponent(reference.endpoint)}/${encodeURIComponent(reference.workspace)}`;
}

function createEntryId() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	return `ai_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function truncateEntryText(text: string, limit = MAX_ENTRY_TEXT): string {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function sortHistory(entries: AiHistoryEntry[]): AiHistoryEntry[] {
	return [...entries].sort((a, b) => a.createdAt - b.createdAt);
}

const STEP_STATUSES: readonly AgentStepStatus[] = ['done', 'invalid', 'unavailable', 'denied'];

/**
 * Steps are validated element by element: the panel dereferences `status` and
 * `description`, so one malformed step must not reach it.
 */
function normalizeSteps(value: unknown): AiHistoryStep[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const steps = value.flatMap((item) => {
		const step = item as Partial<AiHistoryStep> | null;

		if (
			!step ||
			typeof step.description !== 'string' ||
			!STEP_STATUSES.includes(step.status as AgentStepStatus)
		) {
			return [];
		}

		return [
			{
				description: truncateEntryText(step.description, MAX_STEP_TEXT),
				status: step.status as AgentStepStatus,
				...(typeof step.error === 'string'
					? { error: truncateEntryText(step.error, MAX_STEP_TEXT) }
					: {})
			}
		];
	});

	return steps.length > 0 ? steps.slice(0, MAX_STEPS) : undefined;
}

/** Drops records that predate a schema change or were written malformed. */
function normalizeEntry(value: unknown): AiHistoryEntry | null {
	const entry = value as Partial<AiHistoryEntry> | null;

	if (
		!entry ||
		typeof entry.id !== 'string' ||
		typeof entry.documentKey !== 'string' ||
		(entry.mode !== 'ask' && entry.mode !== 'agent') ||
		typeof entry.createdAt !== 'number'
	) {
		return null;
	}

	return {
		id: entry.id,
		documentKey: entry.documentKey,
		mode: entry.mode,
		action: entry.action,
		prompt: typeof entry.prompt === 'string' ? entry.prompt : '',
		selection: typeof entry.selection === 'string' ? entry.selection : undefined,
		response: typeof entry.response === 'string' ? entry.response : '',
		steps: normalizeSteps(entry.steps),
		error: typeof entry.error === 'string' ? entry.error : undefined,
		createdAt: entry.createdAt
	};
}

export function buildHistoryEntry(input: AiHistoryInput): AiHistoryEntry {
	const { now, id, ...rest } = input;

	return {
		...rest,
		id: id ?? createEntryId(),
		prompt: truncateEntryText(rest.prompt),
		selection: rest.selection ? truncateEntryText(rest.selection) : undefined,
		response: truncateEntryText(rest.response),
		steps: normalizeSteps(rest.steps),
		// Every text field is capped, so one entry cannot grow without bound.
		error: rest.error ? truncateEntryText(rest.error, MAX_STEP_TEXT) : undefined,
		createdAt: now ?? Date.now()
	};
}

export async function listAiHistory(
	documentKey: string,
	factory?: IDBFactory
): Promise<AiHistoryEntry[]> {
	const entries = await withStore<unknown[]>(
		AI_HISTORY_STORE,
		'readonly',
		(store) => store.index(AI_HISTORY_DOCUMENT_INDEX).getAll(documentKey),
		factory
	);

	return sortHistory(
		entries.map(normalizeEntry).filter((entry): entry is AiHistoryEntry => !!entry)
	);
}

/**
 * Appends an entry, prunes the oldest ones beyond `MAX_HISTORY_ENTRIES`, and
 * returns the resulting list. Callers must render the returned list rather than
 * appending locally, or the UI would keep entries that pruning just deleted.
 */
export async function appendAiHistory(
	input: AiHistoryInput,
	factory?: IDBFactory,
	maxEntries = MAX_HISTORY_ENTRIES
): Promise<{ entry: AiHistoryEntry; entries: AiHistoryEntry[] }> {
	const entry = buildHistoryEntry(input);

	await withStore(AI_HISTORY_STORE, 'readwrite', (store) => store.put(entry), factory);

	const existing = await listAiHistory(entry.documentKey, factory);
	const excess = existing.slice(0, Math.max(0, existing.length - maxEntries));

	for (const stale of excess) {
		await deleteAiHistoryEntry(stale.id, factory);
	}

	return { entry, entries: existing.slice(excess.length) };
}

export async function deleteAiHistoryEntry(id: string, factory?: IDBFactory): Promise<void> {
	await withStore(AI_HISTORY_STORE, 'readwrite', (store) => store.delete(id), factory);
}

/**
 * Clears by primary key rather than by normalized entry, so records too
 * malformed to read are removed as well and cannot outlive their document.
 */
export async function clearAiHistory(documentKey: string, factory?: IDBFactory): Promise<void> {
	const keys = await withStore<IDBValidKey[]>(
		AI_HISTORY_STORE,
		'readonly',
		(store) => store.index(AI_HISTORY_DOCUMENT_INDEX).getAllKeys(documentKey),
		factory
	);

	for (const key of keys) {
		await withStore(AI_HISTORY_STORE, 'readwrite', (store) => store.delete(key), factory);
	}
}
