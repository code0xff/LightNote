import { escapeHtml } from '$lib/utils';

export const OPENAI_SETTINGS_KEY = 'openai';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

export const OPENAI_MODEL_OPTIONS = [
	'gpt-5.6-luna',
	'gpt-5.6-terra',
	'gpt-5.6-sol',
	'gpt-5.5'
] as const;

const CONTEXT_CHARACTER_LIMIT = 4000;
const SELECTION_CHARACTER_LIMIT = 6000;

export type OpenAiSettings = {
	apiKey: string;
	model: string;
};

export type AiAction = 'rewrite' | 'summarize' | 'proofread' | 'continue' | 'prompt';

export type SystemMessage = { role: 'system'; content: string };

export type UserMessage = { role: 'user'; content: string };

/** Messages the app writes to start a turn (never carries tool calls). */
export type PromptMessage = SystemMessage | UserMessage;

/** A tool call as it appears on the wire. `arguments` is an unparsed JSON string. */
export type ToolCall = {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
};

export type AssistantMessage = {
	role: 'assistant';
	content: string;
	tool_calls?: ToolCall[];
};

export type ToolResultMessage = {
	role: 'tool';
	tool_call_id: string;
	content: string;
};

export type ChatMessage = PromptMessage | AssistantMessage | ToolResultMessage;

/** An OpenAI function-tool declaration sent in the `tools` request field. */
export type ToolDefinition = {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
};

export type GenerateInput = {
	selection?: string;
	context?: string;
	instruction?: string;
};

export function readOpenAiSettings(storage: Storage = localStorage): OpenAiSettings {
	const raw = storage.getItem(OPENAI_SETTINGS_KEY);

	if (!raw) {
		return { apiKey: '', model: DEFAULT_OPENAI_MODEL };
	}

	try {
		const value = JSON.parse(raw) as Partial<OpenAiSettings>;

		return {
			apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
			model:
				typeof value.model === 'string' && value.model.trim() ? value.model : DEFAULT_OPENAI_MODEL
		};
	} catch {
		return { apiKey: '', model: DEFAULT_OPENAI_MODEL };
	}
}

export function writeOpenAiSettings(
	settings: OpenAiSettings,
	storage: Storage = localStorage
): OpenAiSettings {
	const normalized: OpenAiSettings = {
		apiKey: settings.apiKey.trim(),
		model: settings.model.trim() || DEFAULT_OPENAI_MODEL
	};

	storage.setItem(OPENAI_SETTINGS_KEY, JSON.stringify(normalized));

	return normalized;
}

/**
 * The selectable model list, guaranteeing the currently-configured model is
 * present even if it is not one of the built-in options (e.g. a newer model
 * saved by a future build) so a settings `<select>` can always show it.
 */
export function resolveModelOptions(current: string): string[] {
	const base: string[] = [...OPENAI_MODEL_OPTIONS];

	return current && !base.includes(current) ? [current, ...base] : base;
}

const SHARED_RULES =
	'Respond in the same language as the input. Return only the resulting text with no explanations, preamble, or surrounding quotation marks, and do not wrap the answer in code fences.';

export function buildMessages(action: AiAction, input: GenerateInput = {}): PromptMessage[] {
	const selection = input.selection?.trim() ?? '';
	const context = input.context?.trim() ?? '';
	const instruction = input.instruction?.trim() ?? '';

	switch (action) {
		case 'rewrite': {
			const guidance = instruction
				? `Rewrite the text following this instruction: ${instruction}.`
				: 'Rewrite the text to improve clarity and flow while preserving its meaning.';

			return [
				{ role: 'system', content: `You are a writing assistant. ${guidance} ${SHARED_RULES}` },
				{ role: 'user', content: selection }
			];
		}
		case 'summarize':
			return [
				{
					role: 'system',
					content: `You are a writing assistant. Summarize the text concisely while keeping the key points. ${SHARED_RULES}`
				},
				{ role: 'user', content: selection }
			];
		case 'proofread':
			return [
				{
					role: 'system',
					content: `You are a proofreader. Correct spelling, grammar, and punctuation without changing the meaning or style. ${SHARED_RULES}`
				},
				{ role: 'user', content: selection }
			];
		case 'continue':
			return [
				{
					role: 'system',
					content: `You are a writing assistant. Continue writing naturally from where the text ends. Produce only the continuation, not a repeat of the provided text. ${SHARED_RULES}`
				},
				{ role: 'user', content: context }
			];
		case 'prompt': {
			if (selection) {
				return [
					{
						role: 'system',
						content: `You are a writing assistant. Apply the user's instruction to the provided text. ${SHARED_RULES}`
					},
					{
						role: 'user',
						content: `Instruction: ${instruction}\n\nText:\n${selection}`
					}
				];
			}

			const userContent = context ? `${instruction}\n\nCurrent context:\n${context}` : instruction;

			return [
				{
					role: 'system',
					content: `You are a writing assistant helping to draft document content. ${SHARED_RULES}`
				},
				{ role: 'user', content: userContent }
			];
		}
	}
}

export function stripWrapping(text: string): string {
	let result = text.trim();

	// Strip a single wrapping code fence. Multi-line fences may carry a language
	// tag on the opening line (```lang\n...\n```); single-line fences (```...```)
	// have no language tag, so the whole inner body is content. Only strip when a
	// lone fence wraps the text (no additional ``` inside).
	const multiLineFence = result.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/);
	if (multiLineFence && !multiLineFence[1].includes('```')) {
		result = multiLineFence[1].trim();
	} else {
		const singleLineFence = result.match(/^```([\s\S]*?)```$/);
		if (singleLineFence && !singleLineFence[1].includes('```')) {
			result = singleLineFence[1].trim();
		}
	}

	if (result.length >= 2) {
		const first = result[0];
		const last = result[result.length - 1];
		if ((first === '"' && last === '"') || (first === '“' && last === '”')) {
			result = result.slice(1, -1).trim();
		}
	}

	return result;
}

/**
 * Keeps only well-formed tool calls with unique ids. Malformed entries are
 * dropped rather than repaired: the caller echoes this normalized message back
 * to the API, so a dropped call leaves no `tool_call` needing a paired result,
 * and a duplicate id can never produce two results claiming the same id.
 */
function normalizeToolCalls(value: unknown): ToolCall[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const seenIds = new Set<string>();

	return value.flatMap((entry) => {
		const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };

		if (
			typeof call?.id !== 'string' ||
			!call.id ||
			typeof call.function?.name !== 'string' ||
			typeof call.function.arguments !== 'string' ||
			seenIds.has(call.id)
		) {
			return [];
		}

		seenIds.add(call.id);

		return [
			{
				id: call.id,
				type: 'function' as const,
				function: { name: call.function.name, arguments: call.function.arguments }
			}
		];
	});
}

/**
 * Reads the assistant message out of a completion response. Unlike
 * `parseCompletion` this tolerates empty content when tool calls are present,
 * which is the normal shape of a tool-calling turn.
 */
export function parseAssistantMessage(data: unknown): AssistantMessage {
	const message = (
		data as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> }
	)?.choices?.[0]?.message;

	const content = typeof message?.content === 'string' ? message.content : '';
	const toolCalls = normalizeToolCalls(message?.tool_calls);

	if (!content.trim() && toolCalls.length === 0) {
		throw new Error('OpenAI returned an empty response');
	}

	return toolCalls.length > 0
		? { role: 'assistant', content, tool_calls: toolCalls }
		: { role: 'assistant', content };
}

export function parseCompletion(data: unknown): string {
	const message = parseAssistantMessage(data);

	if (!message.content.trim()) {
		throw new Error('OpenAI returned an empty response');
	}

	return stripWrapping(message.content);
}

export function toEditorHtml(text: string): string {
	const blocks = text
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`);

	return blocks.length > 0 ? blocks.join('') : '<p></p>';
}

export function truncateContext(text: string, limit = CONTEXT_CHARACTER_LIMIT): string {
	const trimmed = text.trim();

	return trimmed.length > limit ? trimmed.slice(trimmed.length - limit) : trimmed;
}

export function truncateSelection(text: string, limit = SELECTION_CHARACTER_LIMIT): string {
	const trimmed = text.trim();

	return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

async function extractErrorMessage(response: Response): Promise<string> {
	let detail = '';

	try {
		const body = (await response.json()) as { error?: { message?: unknown } };
		if (typeof body?.error?.message === 'string') {
			detail = body.error.message;
		}
	} catch {
		// ignore body parsing failures and fall back to the status code
	}

	const base = `OpenAI request failed (${response.status})`;

	return detail ? `${base}: ${detail}` : base;
}

export type CompletionParams = {
	apiKey: string;
	model: string;
	messages: ChatMessage[];
	/** Omitted from the request body when empty, keeping plain calls unchanged. */
	tools?: ToolDefinition[];
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

/**
 * Current GPT-5 models refuse function tools on `/v1/chat/completions` unless
 * reasoning is switched off: "Function tools with reasoning_effort are not
 * supported ... set reasoning_effort to 'none'". Only sent alongside `tools`, so
 * plain Ask requests keep exactly the shape they had before.
 */
const TOOL_REASONING_EFFORT = 'none';

/**
 * Single chat-completion round trip returning the raw assistant message, so
 * callers can act on `tool_calls` as well as text. `temperature` is
 * intentionally not sent (current GPT-5 models reject non-default values).
 */
export async function requestChatMessage({
	apiKey,
	model,
	messages,
	tools,
	signal,
	fetchImpl = fetch
}: CompletionParams): Promise<AssistantMessage> {
	const key = apiKey.trim();

	if (!key) {
		throw new Error('OpenAI API key is not set. Add it in AI settings.');
	}

	const hasTools = Boolean(tools && tools.length > 0);
	const send = (withReasoningEffort: boolean) =>
		fetchImpl(OPENAI_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${key}`
			},
			body: JSON.stringify({
				model,
				messages,
				...(hasTools ? { tools } : {}),
				...(hasTools && withReasoningEffort ? { reasoning_effort: TOOL_REASONING_EFFORT } : {})
			}),
			signal
		});

	let response = await send(true);

	if (!response.ok) {
		const message = await extractErrorMessage(response);

		// The user can name any model (`resolveModelOptions` allows unknown ones),
		// and some reject the field itself. Retry once without it rather than
		// failing a whole agent run over a request-shape difference.
		if (!hasTools || response.status !== 400 || !/reasoning_effort/i.test(message)) {
			throw new Error(message);
		}

		response = await send(false);

		if (!response.ok) {
			throw new Error(await extractErrorMessage(response));
		}
	}

	return parseAssistantMessage(await response.json());
}

export async function createChatCompletion(params: CompletionParams): Promise<string> {
	const message = await requestChatMessage(params);

	if (!message.content.trim()) {
		throw new Error('OpenAI returned an empty response');
	}

	return stripWrapping(message.content);
}

export type GenerateOptions = GenerateInput & {
	action: AiAction;
	settings: OpenAiSettings;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

export async function generateText({
	action,
	settings,
	selection,
	context,
	instruction,
	signal,
	fetchImpl
}: GenerateOptions): Promise<string> {
	const messages = buildMessages(action, {
		selection: selection ? truncateSelection(selection) : selection,
		context: context ? truncateContext(context) : context,
		instruction
	});

	return createChatCompletion({
		apiKey: settings.apiKey,
		model: settings.model,
		messages,
		signal,
		fetchImpl
	});
}
