import { describe, expect, it, vi } from 'vitest';
import {
	buildAgentSystemPrompt,
	buildAgentUserMessage,
	DEFAULT_AGENT_MAX_STEPS,
	MAX_TOOL_CALLS_PER_STEP,
	runAgent,
	stringifyToolResult,
	type AgentEvent,
	type AgentToolResult
} from './agent';
import type { AiToolInvocation } from './tools';

const settings = { apiKey: 'sk-key', model: 'gpt-5.6-luna' };

type Turn =
	| { text: string }
	| { calls: Array<{ id: string; name: string; args: string }> }
	| { calls: Array<{ id: string; name: string; args: string }>; text: string };

/**
 * Fake `fetch` replaying scripted assistant turns, so the loop can be driven
 * without touching the network. Returns the request bodies it received.
 */
function scriptedFetch(turns: Turn[]) {
	const bodies: Array<Record<string, unknown>> = [];
	let index = 0;

	const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
		bodies.push(JSON.parse(init.body as string));

		const turn = turns[Math.min(index, turns.length - 1)];
		index += 1;

		return {
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: 'text' in turn ? turn.text : null,
							tool_calls:
								'calls' in turn
									? turn.calls.map((call) => ({
											id: call.id,
											type: 'function',
											function: { name: call.name, arguments: call.args }
										}))
									: undefined
						}
					}
				]
			})
		};
	}) as unknown as typeof fetch;

	return { fetchImpl, bodies };
}

describe('agent prompts', () => {
	it('describes the available surface in the system prompt', () => {
		const normal = buildAgentSystemPrompt({ hasSelection: true });

		expect(normal).toContain('replace_selection is available');
		expect(normal).not.toContain('shared collaboration session');

		const sharing = buildAgentSystemPrompt({ isSharingMode: true });

		expect(sharing).toContain('shared collaboration session');
		expect(sharing).toContain('replace_selection will fail');
	});

	it('appends selection and context sections to the instruction', () => {
		const message = buildAgentUserMessage('  tidy this up  ', {
			selection: 'chosen text',
			context: 'earlier text'
		});

		expect(message).toBe(
			'tidy this up\n\nSelected text:\nchosen text\n\nText before the cursor:\nearlier text'
		);
		expect(buildAgentUserMessage('just write')).toBe('just write');
	});
});

describe('stringifyToolResult', () => {
	it('caps long payloads', () => {
		const result: AgentToolResult = { ok: true, data: 'a'.repeat(100) };

		expect(stringifyToolResult(result, 20)).toBe(
			`${JSON.stringify(result).slice(0, 20)}… (truncated)`
		);
		expect(stringifyToolResult({ ok: false, error: 'nope' })).toBe('{"ok":false,"error":"nope"}');
	});
});

describe('runAgent', () => {
	it('returns text without calling tools when the model answers directly', async () => {
		const { fetchImpl, bodies } = scriptedFetch([{ text: 'nothing to do' }]);
		const executeTool = vi.fn();

		const run = await runAgent('hello', { settings, executeTool, fetchImpl });

		expect(run).toEqual({ text: 'nothing to do', steps: [], stopReason: 'completed' });
		expect(executeTool).not.toHaveBeenCalled();
		expect((bodies[0].tools as unknown[]).length).toBeGreaterThan(0);
	});

	it('runs a read tool without approval and feeds the result back', async () => {
		const { fetchImpl, bodies } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'list_documents', args: '{}' }] },
			{ text: 'you have 1 document' }
		]);
		const executeTool = vi.fn(
			async (): Promise<AgentToolResult> => ({
				ok: true,
				data: [{ id: 'd1', title: 'Notes' }]
			})
		);
		const requestApproval = vi.fn(async () => true);

		const run = await runAgent('what do I have?', {
			settings,
			executeTool,
			requestApproval,
			fetchImpl
		});

		expect(run.stopReason).toBe('completed');
		expect(run.text).toBe('you have 1 document');
		expect(run.steps).toHaveLength(1);
		expect(run.steps[0]).toMatchObject({ callId: 'c1', name: 'list_documents', status: 'done' });
		expect(requestApproval).not.toHaveBeenCalled();

		const followUp = bodies[1].messages as Array<Record<string, unknown>>;
		expect(followUp[2]).toMatchObject({ role: 'assistant' });
		expect(followUp[3]).toEqual({
			role: 'tool',
			tool_call_id: 'c1',
			content: '{"ok":true,"data":[{"id":"d1","title":"Notes"}]}'
		});
	});

	it('asks for approval before a mutating tool and runs it once approved', async () => {
		const { fetchImpl } = scriptedFetch([
			{
				calls: [{ id: 'c1', name: 'create_document', args: '{"title":"Plan","text":"body"}' }]
			},
			{ text: 'created it' }
		]);
		const executeTool = vi.fn(
			async (): Promise<AgentToolResult> => ({ ok: true, data: { id: 'd9' } })
		);
		const requestApproval = vi.fn(async () => true);
		const events: AgentEvent[] = [];

		const run = await runAgent('draft a plan', {
			settings,
			executeTool,
			requestApproval,
			onEvent: (event) => events.push(event),
			fetchImpl
		});

		expect(requestApproval).toHaveBeenCalledWith({
			invocation: { name: 'create_document', args: { title: 'Plan', text: 'body' } },
			description: 'Create a new document "Plan"'
		});
		expect(executeTool).toHaveBeenCalledTimes(1);
		expect(run.steps[0].status).toBe('done');
		expect(events.map((event) => event.type)).toEqual([
			'tool-start',
			'step',
			'assistant-text',
			'done'
		]);
	});

	it('denies a mutating tool when approval is refused or unavailable', async () => {
		const call = { id: 'c1', name: 'insert_at_cursor', args: '{"text":"hi"}' };
		const denied = scriptedFetch([{ calls: [call] }, { text: 'stopped' }]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true }));

		const refused = await runAgent('write something', {
			settings,
			executeTool,
			requestApproval: async () => false,
			fetchImpl: denied.fetchImpl
		});

		expect(executeTool).not.toHaveBeenCalled();
		expect(refused.steps[0]).toMatchObject({ status: 'denied' });
		expect((denied.bodies[1].messages as Array<Record<string, unknown>>)[3]).toMatchObject({
			role: 'tool',
			tool_call_id: 'c1'
		});

		const noApprover = scriptedFetch([{ calls: [call] }, { text: 'stopped' }]);
		const withoutApproval = await runAgent('write something', {
			settings,
			executeTool,
			fetchImpl: noApprover.fetchImpl
		});

		expect(executeTool).not.toHaveBeenCalled();
		expect(withoutApproval.steps[0].status).toBe('denied');
	});

	it('reports invalid arguments back to the model instead of throwing', async () => {
		const { fetchImpl, bodies } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'update_document', args: '{}' }] },
			{ text: 'sorry' }
		]);
		const executeTool = vi.fn();

		const run = await runAgent('update it', { settings, executeTool, fetchImpl });

		expect(executeTool).not.toHaveBeenCalled();
		expect(run.steps[0]).toMatchObject({
			status: 'invalid',
			result: { ok: false, error: 'update_document requires at least one of "title" or "text"' }
		});
		expect((bodies[1].messages as Array<Record<string, unknown>>)[3]).toMatchObject({
			role: 'tool',
			tool_call_id: 'c1'
		});
	});

	it('refuses store writes in sharing mode', async () => {
		const { fetchImpl, bodies } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'create_document', args: '{"title":"a","text":"b"}' }] },
			{ text: 'cannot do that here' }
		]);
		const executeTool = vi.fn();
		const requestApproval = vi.fn(async () => true);

		const run = await runAgent('make a document', {
			settings,
			executeTool,
			requestApproval,
			isSharingMode: true,
			fetchImpl
		});

		expect(requestApproval).not.toHaveBeenCalled();
		expect(executeTool).not.toHaveBeenCalled();
		expect(run.steps[0]).toMatchObject({ status: 'unavailable' });
		expect(
			(bodies[0].tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
		).not.toContain('create_document');
	});

	it('turns a thrown tool error into a failed result', async () => {
		const { fetchImpl } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'read_document', args: '{}' }] },
			{ text: 'could not read' }
		]);
		const executeTool = vi.fn(async () => {
			throw new Error('IndexedDB is not available in this browser');
		});

		const run = await runAgent('read it', { settings, executeTool, fetchImpl });

		expect(run.steps[0]).toMatchObject({
			status: 'done',
			result: { ok: false, error: 'IndexedDB is not available in this browser' }
		});
	});

	it('stops at the step budget when the model keeps calling tools', async () => {
		const { fetchImpl } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'list_documents', args: '{}' }] }
		]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('loop forever', {
			settings,
			executeTool,
			maxSteps: 3,
			fetchImpl
		});

		expect(run.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(3);
		expect(DEFAULT_AGENT_MAX_STEPS).toBe(8);
	});

	it('stops the rest of a batch when cancelled during a tool call', async () => {
		const { fetchImpl } = scriptedFetch([
			{
				calls: [
					{ id: 'c1', name: 'list_documents', args: '{}' },
					{ id: 'c2', name: 'list_documents', args: '{}' }
				]
			},
			{ text: 'done' }
		]);
		const controller = new AbortController();
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => {
			controller.abort();

			return { ok: true, data: [] };
		});

		await expect(
			runAgent('list twice', {
				settings,
				executeTool,
				signal: controller.signal,
				fetchImpl
			})
		).rejects.toMatchObject({ name: 'AbortError' });

		expect(executeTool).toHaveBeenCalledTimes(1);
	});

	it('does not run a mutation when cancelled while approval was pending', async () => {
		const { fetchImpl } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'insert_at_cursor', args: '{"text":"hi"}' }] },
			{ text: 'done' }
		]);
		const controller = new AbortController();
		const executeTool = vi.fn();

		await expect(
			runAgent('write', {
				settings,
				executeTool,
				// Approving late, after the user cancelled, must not let it through.
				requestApproval: async () => {
					controller.abort();

					return true;
				},
				signal: controller.signal,
				fetchImpl
			})
		).rejects.toMatchObject({ name: 'AbortError' });

		expect(executeTool).not.toHaveBeenCalled();
	});

	it('caps the tool calls executed from one assistant message', async () => {
		const calls = Array.from({ length: MAX_TOOL_CALLS_PER_STEP + 2 }, (_, index) => ({
			id: `c${index}`,
			name: 'list_documents',
			args: '{}'
		}));
		const { fetchImpl } = scriptedFetch([{ calls }, { text: 'done' }]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('list many times', {
			settings,
			executeTool,
			maxSteps: 1,
			fetchImpl
		});

		expect(executeTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_STEP);
		expect(run.steps).toHaveLength(calls.length);
		expect(
			run.steps.slice(MAX_TOOL_CALLS_PER_STEP).every((step) => step.status === 'invalid')
		).toBe(true);
	});

	it('normalizes a non-finite or fractional step budget', async () => {
		const { fetchImpl } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'list_documents', args: '{}' }] }
		]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const fractional = await runAgent('loop', { settings, executeTool, maxSteps: 2.7, fetchImpl });

		expect(fractional.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(2);

		executeTool.mockClear();
		const infinite = scriptedFetch([{ calls: [{ id: 'c1', name: 'list_documents', args: '{}' }] }]);

		const unbounded = await runAgent('loop', {
			settings,
			executeTool,
			maxSteps: Number.POSITIVE_INFINITY,
			fetchImpl: infinite.fetchImpl
		});

		expect(unbounded.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(DEFAULT_AGENT_MAX_STEPS);
	});

	it('throws an AbortError when the signal is already aborted', async () => {
		const { fetchImpl } = scriptedFetch([{ text: 'never sent' }]);
		const controller = new AbortController();
		controller.abort();

		await expect(
			runAgent('stop', {
				settings,
				executeTool: vi.fn(),
				signal: controller.signal,
				fetchImpl
			})
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('passes the selection and context through to the request', async () => {
		const { fetchImpl, bodies } = scriptedFetch([{ text: 'ok' }]);

		await runAgent('shorten this', {
			settings,
			executeTool: vi.fn(),
			selection: 'a long sentence',
			context: 'preceding paragraph',
			fetchImpl
		});

		const messages = bodies[0].messages as Array<{ role: string; content: string }>;
		expect(messages[0].role).toBe('system');
		expect(messages[1].content).toContain('a long sentence');
		expect(messages[1].content).toContain('preceding paragraph');
	});

	const invocation: AiToolInvocation = { name: 'list_documents', args: {} };

	it('exposes typed invocations to the executor', async () => {
		const { fetchImpl } = scriptedFetch([
			{ calls: [{ id: 'c1', name: 'list_documents', args: '{}' }] },
			{ text: 'done' }
		]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		await runAgent('list', { settings, executeTool, fetchImpl });

		expect(executeTool).toHaveBeenCalledWith(invocation);
	});
});
