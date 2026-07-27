import {
	requestChatMessage,
	truncateContext,
	truncateSelection,
	type ChatMessage,
	type OpenAiSettings,
	type ToolResultMessage
} from './openai';
import { compressConversation } from './conversation';
import {
	describeToolCall,
	isAiToolName,
	isMutatingTool,
	isToolAvailable,
	listAvailableTools,
	parseToolCalls,
	validateToolCall,
	type AiToolInvocation
} from './tools';

/**
 * A generous ceiling rather than a working limit: stall detection ends a stuck
 * run long before this, and the panel offers Continue when it is reached, so the
 * cap only exists so a run can never be unbounded.
 */
export const DEFAULT_AGENT_MAX_STEPS = 24;

/**
 * Consecutive rounds whose every tool call repeats an earlier one before the run
 * is treated as stuck. Repetition is the shape a real loop takes; a round count
 * alone cannot tell progress from spinning.
 */
export const MAX_STALLED_ROUNDS = 2;

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
	| 'denied'
	/** The identical change already succeeded, so it was not applied again. */
	| 'duplicate';

export type AgentStep = {
	callId: string;
	name: string;
	description: string;
	status: AgentStepStatus;
	invocation?: AiToolInvocation;
	result: AgentToolResult;
};

export type AgentStopReason = 'completed' | 'max-steps' | 'stalled';

export type AgentRun = {
	text: string;
	steps: AgentStep[];
	stopReason: AgentStopReason;
	/** Full transcript, so a stopped run can be continued instead of restarted. */
	messages: ChatMessage[];
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
	/** Rounds sent verbatim before older ones collapse into a ledger. */
	recentRounds?: number;
	/** Transcript of a stopped run to continue from, instead of starting over. */
	priorMessages?: ChatMessage[];
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
		'- Tool text is written into the document verbatim, so it must contain document content only. Never put explanations, progress notes, or descriptions of what you changed into a tool argument — those belong in your reply, which the user reads next to the document.',
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

function callSignature(name: string, rawArguments: string) {
	return `${name}:${rawArguments}`;
}

/**
 * Mutating calls that already succeeded in this conversation. Continuing a run
 * replays its transcript, and a model that repeats an insert or a create would
 * otherwise apply it twice — approval alone is a weak guard, because the prompt
 * looks identical to the first one and session auto-approve skips it entirely.
 */
function collectAppliedMutations(messages: ChatMessage[]): Set<string> {
	const applied = new Set<string>();

	for (const [index, message] of messages.entries()) {
		if (message.role !== 'assistant') {
			continue;
		}

		for (const call of message.tool_calls ?? []) {
			if (!isAiToolName(call.function.name) || !isMutatingTool(call.function.name)) {
				continue;
			}

			const result = messages
				.slice(index + 1)
				.find((candidate) => candidate.role === 'tool' && candidate.tool_call_id === call.id) as
				| ToolResultMessage
				| undefined;

			if (result && !/"ok"\s*:\s*false/.test(result.content)) {
				applied.add(callSignature(call.function.name, call.function.arguments));
			}
		}
	}

	return applied;
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

	// Continuing keeps the stopped run's transcript and appends the new
	// instruction, so the model does not redo work already recorded in it.
	const messages: ChatMessage[] =
		deps.priorMessages && deps.priorMessages.length > 0
			? [
					...deps.priorMessages,
					{
						role: 'user',
						content: buildAgentUserMessage(instruction, {
							selection: deps.selection,
							context: deps.context
						})
					}
				]
			: [
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
	/** Call signatures seen so far, to tell progress from spinning. */
	const seenCallSignatures = new Set<string>(
		(deps.priorMessages ?? []).flatMap((message) =>
			message.role === 'assistant'
				? (message.tool_calls ?? []).map((call) =>
						callSignature(call.function.name, call.function.arguments)
					)
				: []
		)
	);
	const appliedMutations = collectAppliedMutations(deps.priorMessages ?? []);
	let stalledRounds = 0;
	let text = '';

	for (let step = 0; step < maxSteps; step += 1) {
		throwIfAborted(deps.signal);

		const message = await requestChatMessage({
			apiKey: deps.settings.apiKey,
			model: deps.settings.model,
			// The full transcript is kept for the audit trail and for continuing;
			// only what goes over the wire is compressed.
			messages: compressConversation(messages, { recentRounds: deps.recentRounds }),
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

			return { text, steps, stopReason: 'completed', messages };
		}

		/** Records a step and its matching tool message, keeping the pair intact. */
		const record = (step: AgentStep) => {
			steps.push(step);
			emit({ type: 'step', step });
			messages.push({
				role: 'tool',
				tool_call_id: step.callId,
				content: stringifyToolResult(step.result)
			});
		};

		// The cap is applied first: calls that will never run must not influence
		// stall detection, and they still need a result so the transcript stays
		// valid for a later Continue.
		const executable = calls.slice(0, MAX_TOOL_CALLS_PER_STEP);

		for (const call of calls.slice(MAX_TOOL_CALLS_PER_STEP)) {
			record({
				callId: call.id,
				name: call.name,
				description: call.name,
				status: 'invalid',
				result: {
					ok: false,
					error: `Too many tool calls in one turn (limit ${MAX_TOOL_CALLS_PER_STEP}). This call was not run; request it again in a later turn.`
				}
			});
		}

		// A round that only repeats earlier calls has made no progress. Reads are
		// legitimately repeated after a write, so require several in a row.
		const signatures = executable.map((call) => callSignature(call.name, call.rawArguments));
		const allRepeated = signatures.every((signature) => seenCallSignatures.has(signature));

		stalledRounds = allRepeated ? stalledRounds + 1 : 0;
		signatures.forEach((signature) => seenCallSignatures.add(signature));

		if (stalledRounds >= MAX_STALLED_ROUNDS) {
			// Every pending call still gets a result: a transcript ending in an
			// unanswered call would be rejected when the user continues the run.
			for (const call of executable) {
				record({
					callId: call.id,
					name: call.name,
					description: call.name,
					status: 'invalid',
					result: {
						ok: false,
						error: 'Stopped: this call repeated an earlier one, so the run was making no progress.'
					}
				});
			}

			emit({ type: 'done', stopReason: 'stalled' });

			return { text, steps, stopReason: 'stalled', messages };
		}

		for (const call of executable) {
			// Cancelling must stop the remaining calls of this batch too, not just
			// the next request.
			throwIfAborted(deps.signal);

			const validation = validateToolCall(call.name, call.rawArguments);

			if (validation.status === 'error') {
				record({
					callId: call.id,
					name: call.name,
					description: call.name,
					status: 'invalid',
					result: { ok: false, error: validation.message }
				});
				continue;
			}

			const { invocation } = validation;
			const description = describeToolCall(invocation);

			if (!isToolAvailable(invocation.name, { isSharingMode })) {
				record({
					callId: call.id,
					name: invocation.name,
					description,
					status: 'unavailable',
					invocation,
					result: {
						ok: false,
						error: `${invocation.name} is not available while collaborating on a shared document`
					}
				});
				continue;
			}

			if (isMutatingTool(invocation.name)) {
				const signature = callSignature(call.name, call.rawArguments);

				if (appliedMutations.has(signature)) {
					record({
						callId: call.id,
						name: invocation.name,
						description,
						status: 'duplicate',
						invocation,
						result: {
							ok: false,
							error:
								'This exact change was already applied in this run. It was not applied again; do something different or finish.'
						}
					});
					continue;
				}

				const approved = deps.requestApproval
					? await deps.requestApproval({ invocation, description })
					: false;

				// Approval can take arbitrarily long, so re-check: a cancellation
				// during it must not let the mutation through.
				throwIfAborted(deps.signal);

				if (!approved) {
					record({
						callId: call.id,
						name: invocation.name,
						description,
						status: 'denied',
						invocation,
						result: { ok: false, error: 'The user declined this change. Do not retry it.' }
					});
					continue;
				}
			}

			emit({ type: 'tool-start', callId: call.id, description, invocation });

			const result = await runTool(deps.executeTool, invocation);

			if (result.ok && isMutatingTool(invocation.name)) {
				appliedMutations.add(callSignature(call.name, call.rawArguments));
			}

			record({
				callId: call.id,
				name: invocation.name,
				description,
				status: 'done',
				invocation,
				result
			});
		}
	}

	emit({ type: 'done', stopReason: 'max-steps' });

	return { text, steps, stopReason: 'max-steps', messages };
}
