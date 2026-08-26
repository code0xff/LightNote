import type { AssistantMessage, ToolDefinition } from './openai';

export const AI_TOOL_NAMES = [
	'list_documents',
	'replace_text',
	'read_document',
	'insert_at_cursor',
	'replace_selection',
	'create_document',
	'update_document'
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/**
 * Tools that change the user's content. Used to guard against applying the same
 * change twice when a run is continued — not to decide what needs approval; see
 * `requiresApproval`.
 */
const MUTATING_TOOLS: readonly AiToolName[] = [
	'insert_at_cursor',
	'replace_selection',
	'replace_text',
	'create_document',
	'update_document'
];

/**
 * Tools that write through the editor instance instead of the document store.
 * These stay available while collaborating because Yjs owns the content there,
 * whereas store writes are skipped in sharing mode (see `isSharingMode` in
 * `editor.svelte`) and would silently do nothing.
 */
const STORE_WRITE_TOOLS: readonly AiToolName[] = ['create_document', 'update_document'];

/** A selected fragment is an explicit safety boundary for an agent edit. */
const SELECTION_SCOPED_UNAVAILABLE_TOOLS: readonly AiToolName[] = [
	'insert_at_cursor',
	'replace_text',
	'create_document',
	'update_document'
];

export type UpdateDocumentMode = 'replace' | 'append';

export type AiToolInvocation =
	| { name: 'list_documents'; args: Record<string, never> }
	| { name: 'read_document'; args: { id?: string } }
	| { name: 'insert_at_cursor'; args: { text: string } }
	| { name: 'replace_selection'; args: { text: string } }
	| { name: 'replace_text'; args: { target: string; text: string } }
	| { name: 'create_document'; args: { title: string; text: string } }
	| {
			name: 'update_document';
			args: { id?: string; title?: string; text?: string; mode: UpdateDocumentMode };
	  };

/** A tool call pulled off an assistant message, arguments still unparsed. */
export type AiToolCall = {
	id: string;
	name: string;
	rawArguments: string;
};

export type ToolValidation =
	| { status: 'ok'; invocation: AiToolInvocation }
	| { status: 'error'; message: string };

/** Guards against a single call trying to write an unbounded document. */
const MAX_TEXT_LENGTH = 20000;

const TEXT_ARGUMENT_DESCRIPTION =
	'Document text. Separate paragraphs with a blank line. A markdown subset is supported and converted to rich content: # headings, - and 1. lists, > quotes, ``` fenced code, **bold**, *italic*, `code`, and [links](https://example.com). Tables and nested lists are not supported.';

export const AI_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'list_documents',
			description:
				'List the saved documents with their id, title, and last update time. Call this before touching a document by id.',
			parameters: { type: 'object', properties: {}, additionalProperties: false }
		}
	},
	{
		type: 'function',
		function: {
			name: 'replace_text',
			description:
				'Replace one exact, unique text fragment in the open document. Read the document first and copy the target exactly. The target must stay within one paragraph. This fails rather than guessing when the target is missing or appears more than once.',
			parameters: {
				type: 'object',
				properties: {
					target: {
						type: 'string',
						description: 'The exact original text to replace, copied verbatim from the document.'
					},
					text: { type: 'string', description: TEXT_ARGUMENT_DESCRIPTION }
				},
				required: ['target', 'text'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_document',
			description:
				'Read a document as plain text. Omit `id` to read the document the user currently has open.',
			parameters: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Document id from list_documents.' }
				},
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'insert_at_cursor',
			description:
				'Insert new text into the open document at the cursor. Use this only for content that is not in the document yet — to change existing text use replace_text, because inserting leaves the original text in place.',
			parameters: {
				type: 'object',
				properties: { text: { type: 'string', description: TEXT_ARGUMENT_DESCRIPTION } },
				required: ['text'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'replace_selection',
			description:
				'Replace the text the user has selected in the open document. Fails when there is no selection.',
			parameters: {
				type: 'object',
				properties: { text: { type: 'string', description: TEXT_ARGUMENT_DESCRIPTION } },
				required: ['text'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_document',
			description: 'Create a new document with the given title and body, then open it.',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Short document title.' },
					text: { type: 'string', description: TEXT_ARGUMENT_DESCRIPTION }
				},
				required: ['title', 'text'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'update_document',
			description:
				'Change the title and/or body of a saved document. Omit `id` to target the open document. Provide at least one of `title` or `text`.',
			parameters: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Document id from list_documents.' },
					title: { type: 'string', description: 'New title.' },
					text: { type: 'string', description: TEXT_ARGUMENT_DESCRIPTION },
					mode: {
						type: 'string',
						enum: ['replace', 'append'],
						description:
							'Whether `text` replaces the body or is appended to it. Defaults to replace.'
					}
				},
				additionalProperties: false
			}
		}
	}
];

export function isAiToolName(name: string): name is AiToolName {
	return (AI_TOOL_NAMES as readonly string[]).includes(name);
}

export function isMutatingTool(name: AiToolName): boolean {
	return MUTATING_TOOLS.includes(name);
}

/**
 * Whether a call must be confirmed before it runs. Only the store writes are:
 * they create or rewrite a whole document, and `create_document` writes one the
 * user is not even looking at. The three editor-scoped writes are not — they
 * change the open document through editor commands, so they are visible where
 * the user is already looking, undone with one ⌘Z, and listed in the step
 * timeline afterwards. Asking for each of those turned every edit into a
 * two-step confirmation for a change the editor could already take back.
 */
export function requiresApproval(name: AiToolName): boolean {
	return STORE_WRITE_TOOLS.includes(name);
}

/** The three independent reasons a tool can be withheld from a run. */
export type ToolAvailability = {
	isSharingMode?: boolean;
	selectionOnly?: boolean;
	allowDocumentWideEdits?: boolean;
};

export function isToolAvailable(name: AiToolName, options: ToolAvailability = {}): boolean {
	return !(
		(options.isSharingMode && STORE_WRITE_TOOLS.includes(name)) ||
		(options.selectionOnly && SELECTION_SCOPED_UNAVAILABLE_TOOLS.includes(name))
	);
}

/**
 * Whether a call rewrites a whole document body — the operation the user opts into,
 * as opposed to the renames and appends `update_document` also performs. Gating the
 * tool by name would take those away too, so the gate belongs on the invocation.
 */
export function isDocumentWideReplacement(invocation: AiToolInvocation): boolean {
	return (
		invocation.name === 'update_document' &&
		invocation.args.mode === 'replace' &&
		Boolean(invocation.args.text)
	);
}

export const DOCUMENT_WIDE_REPLACEMENT_REFUSAL =
	'Replacing a whole document body is not allowed for this request: the user did not enable it. Rename or append with update_document, or edit one fragment with replace_text.';

/**
 * The reason a withheld tool is unavailable, in the same precedence order
 * `isToolAvailable` applies. The model reads this and reports it to the user, so
 * a wrong reason sends it down the wrong recovery path — telling the user that
 * collaboration blocked a change instead of making the permitted targeted edit.
 */
export function explainUnavailableTool(name: AiToolName, options: ToolAvailability = {}): string {
	if (options.isSharingMode && STORE_WRITE_TOOLS.includes(name)) {
		return `${name} is not available while collaborating on a shared document`;
	}

	if (options.selectionOnly && SELECTION_SCOPED_UNAVAILABLE_TOOLS.includes(name)) {
		return `${name} is not available because this request may only replace the selected text`;
	}

	return `${name} is not available for this request`;
}

export function listAvailableTools(options: ToolAvailability = {}): ToolDefinition[] {
	return AI_TOOLS.filter((tool) => isToolAvailable(tool.function.name as AiToolName, options));
}

export function parseToolCalls(message: AssistantMessage): AiToolCall[] {
	return (message.tool_calls ?? []).map((call) => ({
		id: call.id,
		name: call.function.name,
		rawArguments: call.function.arguments
	}));
}

/**
 * Reads an optional string field, distinguishing "absent" from "present but the
 * wrong type". Coercing a wrong-typed field would silently change the operation
 * — a numeric `id` would become "the current document", for instance.
 */
function readOptionalString(value: unknown): { ok: true; value?: string } | { ok: false } {
	if (value === undefined || value === null) {
		return { ok: true };
	}

	if (typeof value !== 'string') {
		return { ok: false };
	}

	const trimmed = value.trim();

	return { ok: true, value: trimmed ? trimmed : undefined };
}

function readText(
	name: AiToolName,
	value: unknown,
	field = 'text',
	/**
	 * `replace_text`'s target is matched against the document character for
	 * character, so trimming it would quietly edit a different span than the model
	 * asked for (dropping a deliberate trailing space, for instance). Body text is
	 * still trimmed: it goes through the markdown parser, where surrounding
	 * whitespace carries no meaning.
	 */
	keepWhitespace = false
): Extract<ToolValidation, { status: 'error' }> | { text: string } {
	if (typeof value !== 'string') {
		return { status: 'error', message: `${name} requires non-empty "${field}"` };
	}

	const text = keepWhitespace ? value : value.trim();

	if (!text.trim()) {
		return { status: 'error', message: `${name} requires non-empty "${field}"` };
	}

	if (text.length > MAX_TEXT_LENGTH) {
		return {
			status: 'error',
			message: `${name} "${field}" is too long (${text.length} characters, limit ${MAX_TEXT_LENGTH}). Write less in one call.`
		};
	}

	return { text };
}

function isValidationError(
	result: Extract<ToolValidation, { status: 'error' }> | { text: string }
): result is Extract<ToolValidation, { status: 'error' }> {
	return 'status' in result && result.status === 'error';
}

/**
 * Validates a raw tool call into a typed invocation. Errors are returned rather
 * than thrown so the agent loop can feed the message back to the model as a
 * tool result and let it retry with corrected arguments.
 */
export function validateToolCall(name: string, rawArguments: string): ToolValidation {
	if (!isAiToolName(name)) {
		return { status: 'error', message: `Unknown tool: ${name}` };
	}

	let parsed: unknown;

	try {
		parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
	} catch {
		return { status: 'error', message: `Arguments for ${name} are not valid JSON` };
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return { status: 'error', message: `Arguments for ${name} must be a JSON object` };
	}

	const args = parsed as Record<string, unknown>;
	const id = readOptionalString(args.id);

	if (!id.ok) {
		return { status: 'error', message: `${name} "id" must be a string` };
	}

	switch (name) {
		case 'list_documents':
			return { status: 'ok', invocation: { name, args: {} } };
		case 'read_document':
			return { status: 'ok', invocation: { name, args: { id: id.value } } };
		case 'insert_at_cursor':
		case 'replace_selection': {
			const text = readText(name, args.text);

			if (isValidationError(text)) {
				return text;
			}

			return { status: 'ok', invocation: { name, args: { text: text.text } } };
		}
		case 'replace_text': {
			const target = readText(name, args.target, 'target', true);
			const text = readText(name, args.text);

			if (isValidationError(target)) {
				return target;
			}

			if (isValidationError(text)) {
				return text;
			}

			return { status: 'ok', invocation: { name, args: { target: target.text, text: text.text } } };
		}
		case 'create_document': {
			const text = readText(name, args.text);

			if (isValidationError(text)) {
				return text;
			}

			const title = readOptionalString(args.title);

			if (!title.ok) {
				return { status: 'error', message: 'create_document "title" must be a string' };
			}

			return {
				status: 'ok',
				invocation: { name, args: { title: title.value ?? 'Untitled', text: text.text } }
			};
		}
		case 'update_document': {
			const title = readOptionalString(args.title);

			if (!title.ok) {
				return { status: 'error', message: 'update_document "title" must be a string' };
			}

			const hasText = args.text !== undefined && args.text !== null;
			const text = hasText ? readText(name, args.text) : undefined;

			if (text && isValidationError(text)) {
				return text;
			}

			if (!title.value && !text) {
				return {
					status: 'error',
					message: 'update_document requires at least one of "title" or "text"'
				};
			}

			const mode = readOptionalString(args.mode);

			if (!mode.ok || (mode.value && mode.value !== 'replace' && mode.value !== 'append')) {
				return { status: 'error', message: 'update_document "mode" must be replace or append' };
			}

			const resolvedMode: UpdateDocumentMode = mode.value === 'append' ? 'append' : 'replace';

			if (resolvedMode === 'append' && !text) {
				return { status: 'error', message: 'update_document with mode "append" requires "text"' };
			}

			return {
				status: 'ok',
				invocation: {
					name,
					args: {
						id: id.value,
						...(title.value ? { title: title.value } : {}),
						...(text ? { text: text.text } : {}),
						mode: resolvedMode
					}
				}
			};
		}
	}
}

/**
 * The text a mutating call would write, so the approval prompt can show what is
 * about to change rather than only which tool runs.
 */
export function toolCallPreview(invocation: AiToolInvocation): string {
	switch (invocation.name) {
		case 'insert_at_cursor':
		case 'replace_selection':
		case 'create_document':
			return invocation.args.text;
		case 'replace_text':
			return `Replace:\n${invocation.args.target}\n\nWith:\n${invocation.args.text}`;
		case 'update_document':
			return invocation.args.text ?? '';
		default:
			return '';
	}
}

/** Human-readable one-liner for the approval prompt and the step timeline. */
export function describeToolCall(invocation: AiToolInvocation): string {
	switch (invocation.name) {
		case 'list_documents':
			return 'List saved documents';
		case 'read_document':
			return invocation.args.id
				? `Read document ${invocation.args.id}`
				: 'Read the current document';
		case 'insert_at_cursor':
			return 'Insert text at the cursor';
		case 'replace_selection':
			return 'Replace the selected text';
		case 'replace_text':
			return 'Replace an exact text fragment';
		case 'create_document':
			return `Create a new document "${invocation.args.title}"`;
		case 'update_document': {
			const target = invocation.args.id ? `document ${invocation.args.id}` : 'the current document';
			const change = invocation.args.text
				? invocation.args.mode === 'append'
					? 'append to the body of'
					: 'replace the body of'
				: 'rename';

			return `Update ${target}: ${change}${invocation.args.title ? ` (title "${invocation.args.title}")` : ''}`;
		}
	}
}
