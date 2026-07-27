import {
	requestChatMessage,
	truncateContext,
	truncateSelection,
	type ChatMessage,
	type OpenAiSettings
} from './openai';
import {
	describeToolCall,
	isMutatingTool,
	isToolAvailable,
	listAvailableTools,
	parseToolCalls,
	validateToolCall,
	type AiToolInvocation
} from './tools';

export const DEFAULT_AGENT_MAX_STEPS = 8;

/**
 * Tool calls executed from a single assistant message. One response can ask for
 * an arbitrary number of calls, so without this the step budget alone would not
 * bound how much work (or how many mutations) a run performs.
 */
export const MAX_TOOL_CALLS_PER_STEP = 8;

const TOOL_RESULT_CHARACTER_LIMIT = 6000;

export type AgentToolResult = { ok: true; data?: unknown } | { ok: false; error: string };

export type AgentStepStatus =
	/** The tool ran (its own result may still be `ok: false`). */
	| 'done'
	/** Arguments failed validation, so nothing ran. */
	| 'invalid'
	/** The tool is not usable in the current mode. */
	| 'unavailable'
	/** The user declined the mutating call. */
	| 'denied';

export type AgentStep = {
	callId: string;
	name: string;
	description: string;
	status: AgentStepStatus;
	invocation?: AiToolInvocation;
	result: AgentToolResult;
};

export type AgentStopReason = 'completed' | 'max-steps';

export type AgentRun = {
	text: string;
	steps: AgentStep[];
	stopReason: AgentStopReason;
};

export type ApprovalRequest = {
	invocation: AiToolInvocation;
	description: string;
};

export type AgentEvent =
	| { type: 'assistant-text'; text: string }
	| { type: 'tool-start'; callId: string; description: string; invocation: AiToolInvocation }
	| { type: 'step'; step: AgentStep }
	| { type: 'done'; stopReason: AgentStopReason };

export type AgentDeps = {
	settings: OpenAiSettings;
	/** Runs a validated tool call. Thrown errors are reported back to the model. */
	executeTool: (invocation: AiToolInvocation) => Promise<AgentToolResult>;
	/** Asked before every mutating call. Without it, mutating calls are denied. */
	requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
	onEvent?: (event: AgentEvent) => void;
	isSharingMode?: boolean;
	selection?: string;
	context?: string;
	maxSteps?: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

export function buildAgentSystemPrompt(
	options: { isSharingMode?: boolean; hasSelection?: boolean } = {}
): string {
	const lines = [
		'You are the writing agent inside LightNote, an offline-first note editor. You can inspect and change the user documents only through the provided tools.',
		'Rules:',
		'- Respond in the same language as the user.',
		'- Call list_documents before referring to a document id; never invent an id.',
		'- For the document the user has open, prefer insert_at_cursor or replace_selection over update_document so the change stays undoable.',
		'- Never touch a document the user did not ask about, and make the smallest change that satisfies the request.',
		'- Tool text arguments accept a markdown subset (headings, lists, quotes, fenced code, bold, italic, inline code, links) which is converted to rich content. Avoid tables and nested lists.',
		'- Mutating tool calls need the user approval. If one is denied, stop and explain instead of retrying it.',
		'- When the work is done, reply with one or two short sentences describing what changed. Do not repeat the inserted text.'
	];

	if (options.isSharingMode) {
		lines.push(
			'- This document is in a shared collaboration session, so create_document and update_document are unavailable. Use the editor tools only.'
		);
	}

	lines.push(
		options.hasSelection
			? '- The user currently has text selected, so replace_selection is available.'
			: '- The user has no text selected, so replace_selection will fail.'
	);

	return lines.join('\n');
}

export function buildAgentUserMessage(
	instruction: string,
	input: { selection?: string; context?: string } = {}
): string {
	const selection = input.selection ? truncateSelection(input.selection) : '';
	const context = input.context ? truncateContext(input.context) : '';
	const sections = [instruction.trim()];

	if (selection) {
		sections.push(`Selected text:\n${selection}`);
	}

	if (context) {
		sections.push(`Text before the cursor:\n${context}`);
	}

	return sections.join('\n\n');
}

/**
 * Serializes a tool result for the follow-up request, capping the size so a
 * long document read cannot dominate the context window.
 */
export function stringifyToolResult(
	result: AgentToolResult,
	limit = TOOL_RESULT_CHARACTER_LIMIT
): string {
	const serialized = JSON.stringify(result) ?? '';

	return serialized.length > limit ? `${serialized.slice(0, limit)}… (truncated)` : serialized;
}

function abortError() {
	const error = new Error('AI request aborted');
	error.name = 'AbortError';

	return error;
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw abortError();
	}
}

/** Keeps the budget a finite whole number so the loop cannot run unbounded. */
function normalizeMaxSteps(maxSteps?: number) {
	if (maxSteps === undefined || !Number.isFinite(maxSteps)) {
		return DEFAULT_AGENT_MAX_STEPS;
	}

	return Math.max(1, Math.floor(maxSteps));
}

async function runTool(
	executeTool: AgentDeps['executeTool'],
	invocation: AiToolInvocation
): Promise<AgentToolResult> {
	try {
		return await executeTool(invocation);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Tool execution failed' };
	}
}

/**
 * Drives the tool-calling loop: ask the model, run (or refuse) the tools it
 * requests, feed the results back, and repeat until it answers with text or the
 * step budget runs out. Every tool call always gets a matching tool message so
 * the conversation stays valid even when a call is invalid or denied.
 */
export async function runAgent(instruction: string, deps: AgentDeps): Promise<AgentRun> {
	const maxSteps = normalizeMaxSteps(deps.maxSteps);
	const isSharingMode = Boolean(deps.isSharingMode);
	const tools = listAvailableTools({ isSharingMode });
	const emit = (event: AgentEvent) => deps.onEvent?.(event);

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: buildAgentSystemPrompt({
				isSharingMode,
				hasSelection: Boolean(deps.selection?.trim())
			})
		},
		{
			role: 'user',
			content: buildAgentUserMessage(instruction, {
				selection: deps.selection,
				context: deps.context
			})
		}
	];

	const steps: AgentStep[] = [];
	let text = '';

	for (let step = 0; step < maxSteps; step += 1) {
		throwIfAborted(deps.signal);

		const message = await requestChatMessage({
			apiKey: deps.settings.apiKey,
			model: deps.settings.model,
			messages,
			tools,
			signal: deps.signal,
			fetchImpl: deps.fetchImpl
		});

		messages.push(message);

		if (message.content.trim()) {
			text = message.content.trim();
			emit({ type: 'assistant-text', text });
		}

		const calls = parseToolCalls(message);

		if (calls.length === 0) {
			emit({ type: 'done', stopReason: 'completed' });

			return { text, steps, stopReason: 'completed' };
		}

		for (const [callIndex, call] of calls.entries()) {
			// Cancelling must stop the remaining calls of this batch too, not just
			// the next request.
			throwIfAborted(deps.signal);

			if (callIndex >= MAX_TOOL_CALLS_PER_STEP) {
				const skipped: AgentStep = {
					callId: call.id,
					name: call.name,
					description: call.name,
					status: 'invalid',
					result: {
						ok: false,
						error: `Too many tool calls in one turn (limit ${MAX_TOOL_CALLS_PER_STEP}). This call was not run; request it again in a later turn.`
					}
				};

				steps.push(skipped);
				emit({ type: 'step', step: skipped });
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: stringifyToolResult(skipped.result)
				});
				continue;
			}

			const validation = validateToolCall(call.name, call.rawArguments);

			if (validation.status === 'error') {
				const failed: AgentStep = {
					callId: call.id,
					name: call.name,
					description: call.name,
					status: 'invalid',
					result: { ok: false, error: validation.message }
				};

				steps.push(failed);
				emit({ type: 'step', step: failed });
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: stringifyToolResult(failed.result)
				});
				continue;
			}

			const { invocation } = validation;
			const description = describeToolCall(invocation);

			if (!isToolAvailable(invocation.name, { isSharingMode })) {
				const unavailable: AgentStep = {
					callId: call.id,
					name: invocation.name,
					description,
					status: 'unavailable',
					invocation,
					result: {
						ok: false,
						error: `${invocation.name} is not available while collaborating on a shared document`
					}
				};

				steps.push(unavailable);
				emit({ type: 'step', step: unavailable });
				messages.push({
					role: 'tool',
					tool_call_id: call.id,
					content: stringifyToolResult(unavailable.result)
				});
				continue;
			}

			if (isMutatingTool(invocation.name)) {
				const approved = deps.requestApproval
					? await deps.requestApproval({ invocation, description })
					: false;

				// Approval can take arbitrarily long, so re-check: a cancellation
				// during it must not let the mutation through.
				throwIfAborted(deps.signal);

				if (!approved) {
					const denied: AgentStep = {
						callId: call.id,
						name: invocation.name,
						description,
						status: 'denied',
						invocation,
						result: { ok: false, error: 'The user declined this change. Do not retry it.' }
					};

					steps.push(denied);
					emit({ type: 'step', step: denied });
					messages.push({
						role: 'tool',
						tool_call_id: call.id,
						content: stringifyToolResult(denied.result)
					});
					continue;
				}
			}

			emit({ type: 'tool-start', callId: call.id, description, invocation });

			const result = await runTool(deps.executeTool, invocation);
			const completed: AgentStep = {
				callId: call.id,
				name: invocation.name,
				description,
				status: 'done',
				invocation,
				result
			};

			steps.push(completed);
			emit({ type: 'step', step: completed });
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				content: stringifyToolResult(result)
			});
		}
	}

	emit({ type: 'done', stopReason: 'max-steps' });

	return { text, steps, stopReason: 'max-steps' };
}
