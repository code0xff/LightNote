import { describe, expect, it } from 'vitest';
import { compressConversation, DEFAULT_RECENT_ROUNDS } from './conversation';
import type { ChatMessage } from './openai';

function round(
	id: string,
	name: string,
	args: string,
	result = '{"ok":true}',
	text = ''
): ChatMessage[] {
	return [
		{
			role: 'assistant',
			content: text,
			tool_calls: [{ id, type: 'function', function: { name, arguments: args } }]
		},
		{ role: 'tool', tool_call_id: id, content: result }
	];
}

const preamble: ChatMessage[] = [
	{ role: 'system', content: 'rules' },
	{ role: 'user', content: 'reorganize my notes' }
];

/** Every kept tool result must still answer a kept tool call. */
function assertPaired(messages: ChatMessage[]) {
	const callIds = new Set(
		messages.flatMap((message) =>
			message.role === 'assistant' ? (message.tool_calls ?? []).map((call) => call.id) : []
		)
	);

	for (const message of messages) {
		if (message.role === 'tool') {
			expect(callIds.has(message.tool_call_id)).toBe(true);
		}
	}
}

describe('compressConversation', () => {
	it('leaves a short conversation untouched', () => {
		const messages = [...preamble, ...round('c1', 'list_documents', '{}')];

		expect(compressConversation(messages)).toEqual(messages);
	});

	it('collapses older rounds into a ledger and keeps the recent ones verbatim', () => {
		const messages = [
			...preamble,
			...round('c1', 'list_documents', '{}'),
			...round('c2', 'read_document', '{"id":"d1"}'),
			...round('c3', 'create_document', '{"title":"Plan","text":"body"}'),
			...round('c4', 'update_document', '{"id":"d1","text":"x"}'),
			...round('c5', 'read_document', '{"id":"d2"}')
		];

		const compressed = compressConversation(messages, { recentRounds: 2 });

		expect(compressed[0]).toEqual(preamble[0]);
		expect(compressed[1]).toEqual(preamble[1]);

		const ledger = compressed[2];
		expect(ledger.role).toBe('system');
		expect(ledger.content).toContain('already completed');
		expect(ledger.content).toContain('list_documents');
		expect(ledger.content).toContain('read_document(id=d1)');
		expect(ledger.content).toContain('create_document(title=Plan');

		// Only the last two rounds survive as real messages.
		const kept = compressed.slice(3);
		expect(kept).toEqual([
			...round('c4', 'update_document', '{"id":"d1","text":"x"}'),
			...round('c5', 'read_document', '{"id":"d2"}')
		]);
		assertPaired(compressed);
	});

	it('records failures and denials in the ledger', () => {
		const messages = [
			...preamble,
			...round('c1', 'replace_selection', '{"text":"x"}', '{"ok":false,"error":"no selection"}'),
			...round('c2', 'list_documents', '{}'),
			...round('c3', 'read_document', '{"id":"d1"}')
		];

		const [, , ledger] = compressConversation(messages, { recentRounds: 2 });

		expect(ledger.content).toContain('replace_selection');
		expect(ledger.content).toContain('failed: no selection');
	});

	it('keeps a text-only round in the ledger', () => {
		const messages = [
			...preamble,
			[{ role: 'assistant' as const, content: 'I will read the plan first.' }],
			round('c2', 'list_documents', '{}'),
			round('c3', 'read_document', '{"id":"d1"}')
		].flat();

		const [, , ledger] = compressConversation(messages, { recentRounds: 2 });

		expect(ledger.content).toContain('said: I will read the plan first.');
	});

	it('stubs a read whose exact call is repeated later', () => {
		const messages = [
			...preamble,
			...round('c1', 'read_document', '{"id":"d1"}', '{"ok":true,"data":{"text":"old"}}'),
			...round('c2', 'read_document', '{"id":"d1"}', '{"ok":true,"data":{"text":"new"}}')
		];

		const compressed = compressConversation(messages, { recentRounds: 5 });
		const [firstResult, secondResult] = compressed.filter((message) => message.role === 'tool');

		expect(firstResult.content).toContain('supersedes');
		expect(secondResult.content).toContain('new');
		assertPaired(compressed);
	});

	it('never stubs a mutating call, even when repeated', () => {
		const messages = [
			...preamble,
			...round('c1', 'insert_at_cursor', '{"text":"x"}'),
			...round('c2', 'insert_at_cursor', '{"text":"x"}')
		];

		const compressed = compressConversation(messages, { recentRounds: 5 });

		for (const message of compressed) {
			if (message.role === 'tool') {
				expect(message.content).toBe('{"ok":true}');
			}
		}
	});

	it('keeps a trailing resume instruction after the rounds', () => {
		const messages: ChatMessage[] = [
			...preamble,
			...round('c1', 'list_documents', '{}'),
			...round('c2', 'read_document', '{"id":"d1"}'),
			...round('c3', 'read_document', '{"id":"d2"}'),
			...round('c4', 'read_document', '{"id":"d3"}'),
			{ role: 'user', content: 'Continue.' }
		];

		const compressed = compressConversation(messages, { recentRounds: 1 });

		expect(compressed[compressed.length - 1]).toEqual({ role: 'user', content: 'Continue.' });
		assertPaired(compressed);
	});

	it('normalizes the window size', () => {
		const messages = [
			...preamble,
			...round('c1', 'list_documents', '{}'),
			...round('c2', 'read_document', '{"id":"d1"}')
		];

		// A zero or fractional window still keeps at least one round verbatim.
		expect(compressConversation(messages, { recentRounds: 0 }).some((m) => m.role === 'tool')).toBe(
			true
		);
		expect(DEFAULT_RECENT_ROUNDS).toBe(3);
	});
});
