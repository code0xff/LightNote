import type { AssistantMessage, ChatMessage, ToolCall, ToolDefinition } from './openai';

/**
 * Conversion between the internal `ChatMessage` format and the Responses API
 * (`/v1/responses`). Tool calls on `/v1/chat/completions` require reasoning to be
 * switched off, so tool-carrying requests go through Responses instead, where
 * reasoning and function tools work together.
 *
 * The internal format stays the chat-completions shape because it is also what
 * the fallback path sends; everything here is a pure translation.
 */

export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

/** Responses declares tools flat, without the nested `function` object. */
export type ResponsesTool = {
	type: 'function';
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type ResponsesInputItem =
	| { role: 'system' | 'user' | 'assistant'; content: string }
	| { type: 'function_call'; call_id: string; name: string; arguments: string }
	| { type: 'function_call_output'; call_id: string; output: string };

export function toResponsesTools(tools: ToolDefinition[]): ResponsesTool[] {
	return tools.map((tool) => ({
		type: 'function',
		name: tool.function.name,
		description: tool.function.description,
		parameters: tool.function.parameters
	}));
}

export function toResponsesInput(messages: ChatMessage[]): ResponsesInputItem[] {
	return messages.flatMap((message): ResponsesInputItem[] => {
		if (message.role === 'assistant' && message.output_items && message.output_items.length > 0) {
			// Replay the turn exactly as the API produced it: reasoning items must
			// come back with the tool outputs, and item order is significant.
			return message.output_items as ResponsesInputItem[];
		}

		if (message.role === 'tool') {
			return [
				{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }
			];
		}

		if (message.role === 'assistant') {
			// The text and each tool call become separate items, in that order.
			return [
				...(message.content.trim()
					? [{ role: 'assistant' as const, content: message.content }]
					: []),
				...(message.tool_calls ?? []).map((call) => ({
					type: 'function_call' as const,
					call_id: call.id,
					name: call.function.name,
					arguments: call.function.arguments
				}))
			];
		}

		return [{ role: message.role, content: message.content }];
	});
}

function collectOutputText(item: { content?: unknown }): string {
	if (typeof item.content === 'string') {
		return item.content;
	}

	if (!Array.isArray(item.content)) {
		return '';
	}

	return item.content
		.map((part) => {
			const chunk = part as { type?: unknown; text?: unknown };

			return chunk?.type === 'output_text' && typeof chunk.text === 'string' ? chunk.text : '';
		})
		.join('');
}

/**
 * Maps a Responses payload back onto an `AssistantMessage`. Malformed or
 * duplicate-id function calls are dropped for the same reason as on the
 * chat-completions path: the message is echoed back as input, so a dropped call
 * leaves no `function_call` without a matching output.
 */
export function parseResponsesMessage(data: unknown): AssistantMessage {
	const payload = data as { output?: unknown; output_text?: unknown };
	const items = Array.isArray(payload?.output) ? payload.output : [];
	const seenIds = new Set<string>();
	const toolCalls: ToolCall[] = [];
	/**
	 * The items to replay on the next turn: everything the API produced, minus the
	 * calls dropped below. A replayed `function_call` with no matching output would
	 * be rejected, and a duplicate id cannot be told apart by id alone.
	 */
	const replayable: unknown[] = [];
	let text = '';

	for (const entry of items) {
		const item = entry as {
			type?: unknown;
			role?: unknown;
			call_id?: unknown;
			name?: unknown;
			arguments?: unknown;
			content?: unknown;
		};

		if (item?.type === 'function_call') {
			if (
				typeof item.call_id !== 'string' ||
				!item.call_id ||
				typeof item.name !== 'string' ||
				typeof item.arguments !== 'string' ||
				seenIds.has(item.call_id)
			) {
				continue;
			}

			seenIds.add(item.call_id);
			toolCalls.push({
				id: item.call_id,
				type: 'function',
				function: { name: item.name, arguments: item.arguments }
			});
			replayable.push(entry);
			continue;
		}

		if (item?.type === 'message' || item?.role === 'assistant') {
			text += collectOutputText(item);
		}

		// Reasoning and any other item type is opaque to us but must survive.
		replayable.push(entry);
	}

	// `output_text` is an SDK convenience property rather than a documented raw
	// HTTP field, so it is only a last resort after reading `output`.
	if (!text.trim() && typeof payload?.output_text === 'string') {
		text = payload.output_text;
	}

	if (!text.trim() && toolCalls.length === 0) {
		throw new Error('OpenAI returned an empty response');
	}

	const outputItems = replayable.length > 0 ? { output_items: replayable } : {};

	return toolCalls.length > 0
		? { role: 'assistant', content: text, tool_calls: toolCalls, ...outputItems }
		: { role: 'assistant', content: text, ...outputItems };
}
