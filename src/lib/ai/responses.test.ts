import { describe, expect, it } from 'vitest';
import {
	parseResponsesMessage,
	toResponsesInput,
	toResponsesTools,
	OPENAI_RESPONSES_ENDPOINT
} from './responses';
import type { ChatMessage } from './openai';

describe('toResponsesTools', () => {
	it('flattens the nested chat-completions tool shape', () => {
		expect(
			toResponsesTools([
				{
					type: 'function',
					function: {
						name: 'read_document',
						description: 'read it',
						parameters: { type: 'object', properties: {} }
					}
				}
			])
		).toEqual([
			{
				type: 'function',
				name: 'read_document',
				description: 'read it',
				parameters: { type: 'object', properties: {} }
			}
		]);
	});
});

describe('toResponsesInput', () => {
	it('maps tool calls and their results onto Responses items', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'rules' },
			{ role: 'user', content: 'do it' },
			{
				role: 'assistant',
				content: 'reading first',
				tool_calls: [
					{ id: 'c1', type: 'function', function: { name: 'read_document', arguments: '{}' } }
				]
			},
			{ role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' }
		];

		expect(toResponsesInput(messages)).toEqual([
			{ role: 'system', content: 'rules' },
			{ role: 'user', content: 'do it' },
			{ role: 'assistant', content: 'reading first' },
			{ type: 'function_call', call_id: 'c1', name: 'read_document', arguments: '{}' },
			{ type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' }
		]);
	});

	it('omits an assistant item when the turn was tool calls only', () => {
		expect(
			toResponsesInput([
				{
					role: 'assistant',
					content: '',
					tool_calls: [
						{ id: 'c1', type: 'function', function: { name: 'list_documents', arguments: '{}' } }
					]
				}
			])
		).toEqual([{ type: 'function_call', call_id: 'c1', name: 'list_documents', arguments: '{}' }]);
	});
});

describe('parseResponsesMessage', () => {
	it('reads text out of output_text content parts', () => {
		expect(
			parseResponsesMessage({
				output: [
					{
						type: 'message',
						role: 'assistant',
						content: [
							{ type: 'output_text', text: 'first ' },
							{ type: 'output_text', text: 'second' }
						]
					}
				]
			})
		).toMatchObject({ role: 'assistant', content: 'first second' });
	});

	it('maps function_call items onto tool calls', () => {
		expect(
			parseResponsesMessage({
				output: [
					{ type: 'reasoning', summary: [] },
					{
						type: 'function_call',
						call_id: 'call_1',
						name: 'create_document',
						arguments: '{"title":"Plan","text":"body"}'
					}
				]
			})
		).toMatchObject({
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_1',
					type: 'function',
					function: { name: 'create_document', arguments: '{"title":"Plan","text":"body"}' }
				}
			]
		});
	});

	it('drops malformed and duplicate function calls', () => {
		const message = parseResponsesMessage({
			output: [
				{ type: 'function_call', call_id: 'dup', name: 'list_documents', arguments: '{}' },
				{ type: 'function_call', call_id: 'dup', name: 'read_document', arguments: '{}' },
				{ type: 'function_call', call_id: 'x', name: 'read_document' },
				{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }
			]
		});

		expect(message.tool_calls).toHaveLength(1);
		expect(message.tool_calls?.[0].function.name).toBe('list_documents');
		expect(message.content).toBe('hi');
	});

	it('keeps the raw output items so reasoning can be replayed', () => {
		const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' };
		const call = {
			type: 'function_call',
			call_id: 'c1',
			name: 'list_documents',
			arguments: '{}'
		};

		const message = parseResponsesMessage({ output: [reasoning, call] });

		// With store:false the whole turn is replayed by us, and reasoning items must
		// come back with the tool outputs.
		expect(message.output_items).toEqual([reasoning, call]);
		expect(toResponsesInput([message])).toEqual([reasoning, call]);
	});

	it('does not replay a call it dropped', () => {
		const message = parseResponsesMessage({
			output: [
				{ type: 'function_call', call_id: 'dup', name: 'list_documents', arguments: '{}' },
				{ type: 'function_call', call_id: 'dup', name: 'read_document', arguments: '{}' },
				{ type: 'function_call', call_id: 'broken', name: 'read_document' }
			]
		});

		// A replayed call with no matching output would be rejected by the API.
		expect(message.output_items).toEqual([
			{ type: 'function_call', call_id: 'dup', name: 'list_documents', arguments: '{}' }
		]);
	});

	it('falls back to the top-level output_text', () => {
		expect(parseResponsesMessage({ output: [], output_text: 'summary' })).toEqual({
			role: 'assistant',
			content: 'summary'
		});
		expect(parseResponsesMessage({ output: [], output_text: 'summary' })).not.toHaveProperty(
			'output_items'
		);
	});

	it('rejects a payload with neither text nor calls', () => {
		expect(() => parseResponsesMessage({ output: [] })).toThrow('empty response');
		expect(() => parseResponsesMessage({})).toThrow('empty response');
	});

	it('targets the responses endpoint', () => {
		expect(OPENAI_RESPONSES_ENDPOINT).toBe('https://api.openai.com/v1/responses');
	});
});
