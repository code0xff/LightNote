import { describe, expect, it, vi } from 'vitest';
import {
	buildAgentSystemPrompt,
	buildAgentUserMessage,
	DEFAULT_AGENT_MAX_STEPS,
	MAX_STALLED_ROUNDS,
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

		// Tool-carrying requests go to /v1/responses, so the fake replies in that
		// shape: an optional assistant message item plus one item per tool call.
		return {
			ok: true,
			json: async () => ({
				output: [
					...('text' in turn
						? [
								{
									type: 'message',
									role: 'assistant',
									content: [{ type: 'output_text', text: turn.text }]
								}
							]
						: []),
					...('calls' in turn
						? turn.calls.map((call) => ({
								type: 'function_call',
								call_id: call.id,
								name: call.name,
								arguments: call.args
							}))
						: [])
				]
			})
		};
	}) as unknown as typeof fetch;

	return { fetchImpl, bodies };
}

/**
 * Always answers with a single tool call. `unique: true` varies the arguments so
 * the run makes progress; `false` repeats the same call, which is what stall
 * detection is meant to catch.
 */
function repeatingFetch(options: { unique: boolean }) {
	const bodies: Array<Record<string, unknown>> = [];
	let round = 0;

	const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
		bodies.push(JSON.parse(init.body as string));

		const item = options.unique
			? { name: 'read_document', arguments: `{"id":"d${round}"}` }
			: { name: 'list_documents', arguments: '{}' };
		const callId = `c${round}`;
		round += 1;

		return {
			ok: true,
			json: async () => ({
				output: [{ type: 'function_call', call_id: callId, ...item }]
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

		expect(run).toMatchObject({ text: 'nothing to do', steps: [], stopReason: 'completed' });
		// The transcript comes back so a stopped run can be continued.
		expect(run.messages).toHaveLength(3);
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

		const followUp = bodies[1].input as Array<Record<string, unknown>>;
		expect(followUp[2]).toMatchObject({ type: 'function_call', call_id: 'c1' });
		expect(followUp[3]).toEqual({
			type: 'function_call_output',
			call_id: 'c1',
			output: '{"ok":true,"data":[{"id":"d1","title":"Notes"}]}'
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
		expect((denied.bodies[1].input as Array<Record<string, unknown>>)[3]).toMatchObject({
			type: 'function_call_output',
			call_id: 'c1'
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
		expect((bodies[1].input as Array<Record<string, unknown>>)[3]).toMatchObject({
			type: 'function_call_output',
			call_id: 'c1'
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
		expect((bodies[0].tools as Array<{ name: string }>).map((tool) => tool.name)).not.toContain(
			'create_document'
		);
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

	it('stops at the step budget while the model keeps making progress', async () => {
		const { fetchImpl } = repeatingFetch({ unique: true });
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('keep reading', {
			settings,
			executeTool,
			maxSteps: 3,
			fetchImpl
		});

		expect(run.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(3);
		expect(DEFAULT_AGENT_MAX_STEPS).toBe(24);
	});

	it('stops a run that keeps repeating the same call', async () => {
		const { fetchImpl } = repeatingFetch({ unique: false });
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('spin', { settings, executeTool, fetchImpl });

		expect(run.stopReason).toBe('stalled');
		// The first sighting runs, the repeat runs, the second repeat stops it —
		// well before the step budget of 24.
		expect(executeTool).toHaveBeenCalledTimes(MAX_STALLED_ROUNDS);
		expect(MAX_STALLED_ROUNDS).toBe(2);
	});

	it('compresses older rounds into a ledger before sending', async () => {
		const { fetchImpl, bodies } = repeatingFetch({ unique: true });
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		await runAgent('keep reading', {
			settings,
			executeTool,
			maxSteps: 4,
			recentRounds: 1,
			fetchImpl
		});

		const lastInput = bodies[bodies.length - 1].input as Array<{
			role?: string;
			content?: string;
		}>;
		const ledger = lastInput.find((item) => item.content?.includes('already completed'));

		expect(ledger?.role).toBe('system');
		expect(ledger?.content).toContain('read_document(id=d0)');
		// Only the most recent round stays verbatim as call/output items.
		expect(lastInput.filter((item) => !item.role)).toHaveLength(2);
	});

	it('continues a stopped run from its transcript', async () => {
		const first = scriptedFetch([{ text: 'stopped early' }]);
		const initial = await runAgent('start', {
			settings,
			executeTool: vi.fn(),
			fetchImpl: first.fetchImpl
		});

		const second = scriptedFetch([{ text: 'finished' }]);
		const resumed = await runAgent('Continue.', {
			settings,
			executeTool: vi.fn(),
			priorMessages: initial.messages,
			fetchImpl: second.fetchImpl
		});

		const input = second.bodies[0].input as Array<{ role?: string; content?: string }>;

		expect(resumed.text).toBe('finished');
		// The prior transcript is reused instead of rebuilding a fresh conversation.
		expect(input).toHaveLength(initial.messages.length + 1);
		expect(input[0].role).toBe('system');
		expect(input[input.length - 1]).toEqual({ role: 'user', content: 'Continue.' });
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
		// Capped calls are answered first, so count rather than assume an order.
		expect(run.steps.filter((step) => step.status === 'invalid')).toHaveLength(
			calls.length - MAX_TOOL_CALLS_PER_STEP
		);
		expect(run.steps.filter((step) => step.status === 'done')).toHaveLength(
			MAX_TOOL_CALLS_PER_STEP
		);
	});

	it('normalizes a non-finite or fractional step budget', async () => {
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));
		const fractional = await runAgent('loop', {
			settings,
			executeTool,
			maxSteps: 2.7,
			fetchImpl: repeatingFetch({ unique: true }).fetchImpl
		});

		expect(fractional.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(2);

		executeTool.mockClear();

		// Infinity would otherwise mean an unbounded loop; it falls back to the
		// default budget instead.
		const unbounded = await runAgent('loop', {
			settings,
			executeTool,
			maxSteps: Number.POSITIVE_INFINITY,
			fetchImpl: repeatingFetch({ unique: true }).fetchImpl
		});

		expect(unbounded.stopReason).toBe('max-steps');
		expect(executeTool).toHaveBeenCalledTimes(DEFAULT_AGENT_MAX_STEPS);
	});

	it('answers every pending call when it stops for a stall', async () => {
		const { fetchImpl } = repeatingFetch({ unique: false });
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('spin', { settings, executeTool, fetchImpl });

		// A transcript ending in an unanswered call cannot be continued: the API
		// requires an output for every function call.
		const callIds = run.messages.flatMap((message) =>
			message.role === 'assistant' ? (message.tool_calls ?? []).map((call) => call.id) : []
		);
		const resultIds = run.messages.flatMap((message) =>
			message.role === 'tool' ? [message.tool_call_id] : []
		);

		expect(callIds).toHaveLength(3);
		expect(resultIds.sort()).toEqual(callIds.sort());
		expect(run.steps[run.steps.length - 1].result).toEqual({
			ok: false,
			error: 'Stopped: this call repeated an earlier one, so the run was making no progress.'
		});
	});

	it('refuses to apply a mutation the resumed transcript already applied', async () => {
		const apply = { id: 'c1', name: 'insert_at_cursor', args: '{"text":"hi"}' };
		const first = scriptedFetch([{ calls: [apply] }, { text: 'inserted' }]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true }));

		const initial = await runAgent('insert it', {
			settings,
			executeTool,
			requestApproval: async () => true,
			fetchImpl: first.fetchImpl
		});

		expect(executeTool).toHaveBeenCalledTimes(1);

		// The resumed model asks for the identical change again.
		const second = scriptedFetch([
			{ calls: [{ ...apply, id: 'c2' }] },
			{ text: 'nothing left to do' }
		]);
		const requestApproval = vi.fn(async () => true);
		const resumed = await runAgent('Continue.', {
			settings,
			executeTool,
			requestApproval,
			priorMessages: initial.messages,
			fetchImpl: second.fetchImpl
		});

		expect(executeTool).toHaveBeenCalledTimes(1);
		// Not even an approval prompt: the duplicate never gets that far.
		expect(requestApproval).not.toHaveBeenCalled();
		expect(resumed.steps[0]).toMatchObject({ status: 'duplicate' });
	});

	it('counts only the calls it will run toward a stall', async () => {
		const repeated = { id: 'r1', name: 'list_documents', args: '{}' };
		const overflow = Array.from({ length: MAX_TOOL_CALLS_PER_STEP + 1 }, (_, index) => ({
			id: `x${index}`,
			name: 'read_document',
			args: `{"id":"d${index}"}`
		}));
		const { fetchImpl } = scriptedFetch([
			{ calls: [repeated] },
			{ calls: [repeated, ...overflow] },
			{ text: 'done' }
		]);
		const executeTool = vi.fn(async (): Promise<AgentToolResult> => ({ ok: true, data: [] }));

		const run = await runAgent('mix', { settings, executeTool, maxSteps: 4, fetchImpl });

		// The capped calls are answered but never run, so they cannot mask a stall.
		expect(run.steps.filter((step) => step.status === 'invalid').length).toBeGreaterThan(0);
		expect(run.stopReason).toBe('completed');
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

		const input = bodies[0].input as Array<{ role: string; content: string }>;
		expect(input[0].role).toBe('system');
		expect(input[1].content).toContain('a long sentence');
		expect(input[1].content).toContain('preceding paragraph');
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
