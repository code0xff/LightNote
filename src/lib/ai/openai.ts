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

export type OpenAiSettings = {
	apiKey: string;
	model: string;
};

export type AiAction = 'rewrite' | 'summarize' | 'proofread' | 'continue' | 'prompt';

export type ChatMessage = {
	role: 'system' | 'user';
	content: string;
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

const SHARED_RULES =
	'Respond in the same language as the input. Return only the resulting text with no explanations, preamble, or surrounding quotation marks, and do not wrap the answer in code fences.';

export function buildMessages(action: AiAction, input: GenerateInput = {}): ChatMessage[] {
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

	const fenceMatch = result.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
	if (fenceMatch) {
		result = fenceMatch[1].trim();
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

export function parseCompletion(data: unknown): string {
	const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
		?.message?.content;

	if (typeof content !== 'string' || !content.trim()) {
		throw new Error('OpenAI returned an empty response');
	}

	return stripWrapping(content);
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
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
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
};

export async function createChatCompletion({
	apiKey,
	model,
	messages,
	signal,
	fetchImpl = fetch
}: CompletionParams): Promise<string> {
	const key = apiKey.trim();

	if (!key) {
		throw new Error('OpenAI API key is not set. Add it in AI settings.');
	}

	const response = await fetchImpl(OPENAI_ENDPOINT, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${key}`
		},
		body: JSON.stringify({
			model,
			messages
		}),
		signal
	});

	if (!response.ok) {
		throw new Error(await extractErrorMessage(response));
	}

	return parseCompletion(await response.json());
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
		selection,
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
