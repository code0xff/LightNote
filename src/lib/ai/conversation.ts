import type { AssistantMessage, ChatMessage, ToolResultMessage } from './openai';

/**
 * Keeps the request sent each agent round small without losing what the model
 * needs. Two mechanisms, both deterministic — no extra model call:
 *
 * 1. Rounds older than the recent window collapse into one ledger line per tool
 *    call ("what has already been done"), built from the messages themselves.
 * 2. Inside the window, a read whose exact call is repeated later is stubbed,
 *    because the newer result supersedes it.
 *
 * The full transcript is still accumulated by the caller; only the payload sent
 * to the API is compressed.
 */

/** Rounds kept verbatim. Recent tool output is what the model acts on. */
export const DEFAULT_RECENT_ROUNDS = 3;

/** Reads are idempotent, so an older identical call carries nothing new. */
const SUPERSEDABLE_TOOLS = new Set(['list_documents', 'read_document']);

const LEDGER_PREFIX = 'Steps already completed in this run (do not repeat them):';

const SUPERSEDED_STUB = JSON.stringify({
	ok: true,
	note: 'Result omitted: a later call re-read this and supersedes it.'
});

/** Result excerpt kept per ledger line, so ids and titles survive the collapse. */
const LEDGER_RESULT_LIMIT = 240;

/** One assistant message plus the tool results answering it. */
type Round = {
	assistant: AssistantMessage;
	toolResults: ToolResultMessage[];
};

type Split = {
	/** System prompt and the original instruction, always kept. */
	preamble: ChatMessage[];
	rounds: Round[];
	/** Anything after the last tool result (e.g. a resume instruction). */
	trailing: ChatMessage[];
};

function splitConversation(messages: ChatMessage[]): Split {
	const preamble: ChatMessage[] = [];
	const rounds: Round[] = [];
	const trailing: ChatMessage[] = [];

	for (const message of messages) {
		if (message.role === 'assistant') {
			rounds.push({ assistant: message, toolResults: [] });
			continue;
		}

		if (message.role === 'tool') {
			// Attach only to the call it answers: a result with no matching call must
			// not be emitted, because the API rejects an unpaired output.
			const round = rounds.find((candidate) =>
				(candidate.assistant.tool_calls ?? []).some((call) => call.id === message.tool_call_id)
			);

			round?.toolResults.push(message);
			continue;
		}

		if (rounds.length === 0) {
			preamble.push(message);
		} else {
			trailing.push(message);
		}
	}

	return { preamble, rounds, trailing };
}

function summarizeArguments(rawArguments: string): string {
	try {
		const parsed = JSON.parse(rawArguments || '{}') as Record<string, unknown>;
		const parts = Object.entries(parsed).map(([key, value]) => {
			if (typeof value === 'string') {
				// Bodies can be document-sized; the ledger only needs the shape.
				return `${key}=${value.length > 40 ? `${value.slice(0, 40)}…` : value}`;
			}

			return `${key}=${JSON.stringify(value)}`;
		});

		return parts.join(', ');
	} catch {
		return '';
	}
}

/**
 * Summarizes a tool result for the ledger. Successful results keep an excerpt of
 * their payload: collapsing `list_documents` to a bare "ok" would strip the ids
 * the model needs, while the ledger tells it not to call again.
 */
function describeResult(result: string): string {
	try {
		const parsed = JSON.parse(result) as { ok?: unknown; error?: unknown; data?: unknown };

		if (parsed?.ok === false) {
			return typeof parsed.error === 'string' ? `failed: ${parsed.error}` : 'failed';
		}

		if (parsed?.data === undefined) {
			return 'ok';
		}

		const data = JSON.stringify(parsed.data) ?? '';

		return `ok: ${data.length > LEDGER_RESULT_LIMIT ? `${data.slice(0, LEDGER_RESULT_LIMIT)}…` : data}`;
	} catch {
		return 'ok';
	}
}

function isOkResult(result: string): boolean {
	try {
		return (JSON.parse(result) as { ok?: unknown })?.ok !== false;
	} catch {
		return true;
	}
}

/** One line per tool call: name, key arguments, and how it turned out. */
export function buildLedger(rounds: Round[]): string[] {
	return rounds.flatMap((round) => {
		const lines = (round.assistant.tool_calls ?? []).map((call) => {
			const result = round.toolResults.find((message) => message.tool_call_id === call.id);
			const args = summarizeArguments(call.function.arguments);
			const outcome = result ? describeResult(result.content) : 'no result';

			return `- ${call.function.name}(${args}) → ${outcome}`;
		});

		// The agent's own commentary is kept too: it is its reasoning about what to
		// do next, and dropping it whenever the round also called a tool loses the
		// plan behind the calls.
		return round.assistant.content.trim()
			? [`- said: ${round.assistant.content.trim()}`, ...lines]
			: lines;
	});
}

function callSignature(name: string, rawArguments: string) {
	return `${name}:${rawArguments}`;
}

/**
 * Replaces a superseded read result with a stub. The tool message itself stays,
 * so every `tool_call` keeps its matching result and the conversation stays valid.
 */
function stubSupersededReads(rounds: Round[]): Round[] {
	const latestBySignature = new Map<string, string>();

	for (const round of rounds) {
		for (const call of round.assistant.tool_calls ?? []) {
			const result = round.toolResults.find((message) => message.tool_call_id === call.id);

			// A later failure supersedes nothing: the older result may still hold the
			// only usable data.
			if (SUPERSEDABLE_TOOLS.has(call.function.name) && result && isOkResult(result.content)) {
				latestBySignature.set(callSignature(call.function.name, call.function.arguments), call.id);
			}
		}
	}

	if (latestBySignature.size === 0) {
		return rounds;
	}

	const superseded = new Set<string>();

	for (const round of rounds) {
		for (const call of round.assistant.tool_calls ?? []) {
			const signature = callSignature(call.function.name, call.function.arguments);
			const latestId = latestBySignature.get(signature);

			if (latestId && latestId !== call.id) {
				superseded.add(call.id);
			}
		}
	}

	return rounds.map((round) => ({
		assistant: round.assistant,
		toolResults: round.toolResults.map((message) =>
			// Never restate a failure as a success: only an already-ok result is
			// replaced by the ok-shaped stub.
			superseded.has(message.tool_call_id) && isOkResult(message.content)
				? { ...message, content: SUPERSEDED_STUB }
				: message
		)
	}));
}

function flattenRounds(rounds: Round[]): ChatMessage[] {
	return rounds.flatMap((round) => [round.assistant, ...round.toolResults]);
}

/**
 * Builds the payload for the next request: preamble, a ledger of older rounds,
 * then the recent rounds verbatim.
 */
export function compressConversation(
	messages: ChatMessage[],
	options: { recentRounds?: number } = {}
): ChatMessage[] {
	const recentRounds = Math.max(1, Math.floor(options.recentRounds ?? DEFAULT_RECENT_ROUNDS));
	const { preamble, rounds, trailing } = splitConversation(messages);

	if (rounds.length <= recentRounds) {
		return [...preamble, ...flattenRounds(stubSupersededReads(rounds)), ...trailing];
	}

	const older = rounds.slice(0, rounds.length - recentRounds);
	const recent = rounds.slice(rounds.length - recentRounds);
	const ledger = buildLedger(older);

	return [
		...preamble,
		...(ledger.length > 0
			? [{ role: 'system' as const, content: `${LEDGER_PREFIX}\n${ledger.join('\n')}` }]
			: []),
		...flattenRounds(stubSupersededReads(recent)),
		...trailing
	];
}
