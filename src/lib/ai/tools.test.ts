import { describe, expect, it } from 'vitest';
import {
	AI_TOOLS,
	AI_TOOL_NAMES,
	describeToolCall,
	isAiToolName,
	explainUnavailableTool,
	isDocumentWideReplacement,
	isMutatingTool,
	isToolAvailable,
	listAvailableTools,
	parseToolCalls,
	requiresApproval,
	toolCallPreview,
	validateToolCall
} from './tools';
import type { AssistantMessage } from './openai';

function assistantMessage(
	toolCalls: Array<{ id: string; name: string; args: string }>
): AssistantMessage {
	return {
		role: 'assistant',
		content: '',
		tool_calls: toolCalls.map((call) => ({
			id: call.id,
			type: 'function' as const,
			function: { name: call.name, arguments: call.args }
		}))
	};
}

describe('tool declarations', () => {
	it('declares exactly the known tool names', () => {
		expect(AI_TOOLS.map((tool) => tool.function.name)).toEqual([...AI_TOOL_NAMES]);
	});

	it('marks writes as mutating and reads as not', () => {
		expect(isMutatingTool('create_document')).toBe(true);
		expect(isMutatingTool('update_document')).toBe(true);
		expect(isMutatingTool('insert_at_cursor')).toBe(true);
		expect(isMutatingTool('replace_selection')).toBe(true);
		expect(isMutatingTool('replace_text')).toBe(true);
		expect(isMutatingTool('list_documents')).toBe(false);
		expect(isMutatingTool('read_document')).toBe(false);
	});

	it('asks for approval on store writes only', () => {
		// The editor writes are undoable and land in front of the user, so they are
		// applied directly; a document created or rewritten wholesale is not.
		expect(requiresApproval('create_document')).toBe(true);
		expect(requiresApproval('update_document')).toBe(true);
		expect(requiresApproval('insert_at_cursor')).toBe(false);
		expect(requiresApproval('replace_selection')).toBe(false);
		expect(requiresApproval('replace_text')).toBe(false);
		expect(requiresApproval('list_documents')).toBe(false);
	});

	it('hides store writes in sharing mode but keeps editor writes', () => {
		expect(isToolAvailable('create_document', { isSharingMode: true })).toBe(false);
		expect(isToolAvailable('update_document', { isSharingMode: true })).toBe(false);
		expect(isToolAvailable('insert_at_cursor', { isSharingMode: true })).toBe(true);
		expect(isToolAvailable('create_document')).toBe(true);

		expect(listAvailableTools({ isSharingMode: true }).map((tool) => tool.function.name)).toEqual([
			'list_documents',
			'replace_text',
			'read_document',
			'insert_at_cursor',
			'replace_selection'
		]);
		expect(listAvailableTools()).toHaveLength(AI_TOOL_NAMES.length);
	});

	it('limits a selection-scoped agent to replacing its selection', () => {
		expect(isToolAvailable('replace_selection', { selectionOnly: true })).toBe(true);
		expect(isToolAvailable('update_document', { selectionOnly: true })).toBe(false);
		expect(isToolAvailable('insert_at_cursor', { selectionOnly: true })).toBe(false);
		expect(listAvailableTools({ selectionOnly: true }).map((tool) => tool.function.name)).toEqual([
			'list_documents',
			'read_document',
			'replace_selection'
		]);
	});

	it('gates a body rewrite per call, keeping renames and appends available', () => {
		// `update_document` also renames and appends, so withholding the whole tool
		// would take those away from every run that did not tick the opt-in.
		expect(isToolAvailable('update_document', { allowDocumentWideEdits: false })).toBe(true);
		expect(
			isDocumentWideReplacement({
				name: 'update_document',
				args: { text: 'body', mode: 'replace' }
			})
		).toBe(true);
		expect(
			isDocumentWideReplacement({ name: 'update_document', args: { text: 'more', mode: 'append' } })
		).toBe(false);
		expect(
			isDocumentWideReplacement({
				name: 'update_document',
				args: { title: 'Renamed', mode: 'replace' }
			})
		).toBe(false);
		expect(
			isDocumentWideReplacement({ name: 'replace_text', args: { target: 'a', text: 'b' } })
		).toBe(false);
	});

	it('explains which restriction withheld a tool', () => {
		// The model acts on this reason, so each restriction must name itself: a
		// selection-scoped refusal reported as a sharing restriction sends the model
		// off explaining collaboration instead of editing the selection.
		expect(explainUnavailableTool('update_document', { isSharingMode: true })).toContain(
			'shared document'
		);
		expect(explainUnavailableTool('insert_at_cursor', { selectionOnly: true })).toContain(
			'may only replace the selected text'
		);
		expect(
			explainUnavailableTool('create_document', { selectionOnly: true, isSharingMode: true })
		).toContain('shared document');
	});

	it('recognizes tool names', () => {
		expect(isAiToolName('read_document')).toBe(true);
		expect(isAiToolName('delete_everything')).toBe(false);
	});
});

describe('parseToolCalls', () => {
	it('flattens wire tool calls', () => {
		expect(
			parseToolCalls(assistantMessage([{ id: 'c1', name: 'list_documents', args: '{}' }]))
		).toEqual([{ id: 'c1', name: 'list_documents', rawArguments: '{}' }]);
	});

	it('returns nothing for a plain text message', () => {
		expect(parseToolCalls({ role: 'assistant', content: 'done' })).toEqual([]);
	});
});

describe('validateToolCall', () => {
	it('rejects unknown tools and malformed arguments', () => {
		expect(validateToolCall('drop_table', '{}')).toEqual({
			status: 'error',
			message: 'Unknown tool: drop_table'
		});
		expect(validateToolCall('read_document', '{nope')).toEqual({
			status: 'error',
			message: 'Arguments for read_document are not valid JSON'
		});
		expect(validateToolCall('read_document', '[]')).toEqual({
			status: 'error',
			message: 'Arguments for read_document must be a JSON object'
		});
	});

	it('accepts empty arguments for no-argument tools', () => {
		expect(validateToolCall('list_documents', '')).toEqual({
			status: 'ok',
			invocation: { name: 'list_documents', args: {} }
		});
	});

	it('treats a blank document id as absent', () => {
		expect(validateToolCall('read_document', '{"id":"   "}')).toEqual({
			status: 'ok',
			invocation: { name: 'read_document', args: { id: undefined } }
		});
		expect(validateToolCall('read_document', '{"id":" doc-1 "}')).toEqual({
			status: 'ok',
			invocation: { name: 'read_document', args: { id: 'doc-1' } }
		});
	});

	it('requires text for editor writes', () => {
		expect(validateToolCall('insert_at_cursor', '{"text":"  "}')).toEqual({
			status: 'error',
			message: 'insert_at_cursor requires non-empty "text"'
		});
		expect(validateToolCall('replace_selection', '{"text":" hello "}')).toEqual({
			status: 'ok',
			invocation: { name: 'replace_selection', args: { text: 'hello' } }
		});
	});

	it('requires an exact original fragment for replace_text', () => {
		expect(validateToolCall('replace_text', '{"target":"before","text":"after"}')).toEqual({
			status: 'ok',
			invocation: { name: 'replace_text', args: { target: 'before', text: 'after' } }
		});
		expect(validateToolCall('replace_text', '{"target":"  ","text":"after"}')).toEqual({
			status: 'error',
			message: 'replace_text requires non-empty "target"'
		});
	});

	it('keeps the replace_text target verbatim but trims the replacement body', () => {
		// The target is matched against the document character for character, so
		// trimming it would replace a different span than the model asked for.
		expect(validateToolCall('replace_text', '{"target":"old ","text":" new "}')).toEqual({
			status: 'ok',
			invocation: { name: 'replace_text', args: { target: 'old ', text: 'new' } }
		});
	});

	it('defaults a missing create_document title to Untitled', () => {
		expect(validateToolCall('create_document', '{"text":"body"}')).toEqual({
			status: 'ok',
			invocation: { name: 'create_document', args: { title: 'Untitled', text: 'body' } }
		});
		expect(validateToolCall('create_document', '{"title":"Notes"}')).toEqual({
			status: 'error',
			message: 'create_document requires non-empty "text"'
		});
	});

	it('validates update_document fields and defaults the mode', () => {
		expect(validateToolCall('update_document', '{}')).toEqual({
			status: 'error',
			message: 'update_document requires at least one of "title" or "text"'
		});
		expect(validateToolCall('update_document', '{"text":"body","mode":"prepend"}')).toEqual({
			status: 'error',
			message: 'update_document "mode" must be replace or append'
		});
		expect(validateToolCall('update_document', '{"title":"Renamed","mode":"append"}')).toEqual({
			status: 'error',
			message: 'update_document with mode "append" requires "text"'
		});
		expect(validateToolCall('update_document', '{"title":"Renamed"}')).toEqual({
			status: 'ok',
			invocation: {
				name: 'update_document',
				args: { id: undefined, title: 'Renamed', mode: 'replace' }
			}
		});
		expect(
			validateToolCall('update_document', '{"id":"d1","text":"more","mode":"append"}')
		).toEqual({
			status: 'ok',
			invocation: {
				name: 'update_document',
				args: { id: 'd1', text: 'more', mode: 'append' }
			}
		});
	});
});

describe('validateToolCall type strictness', () => {
	it('rejects a wrong-typed id instead of treating it as the current document', () => {
		expect(validateToolCall('read_document', '{"id":7}')).toEqual({
			status: 'error',
			message: 'read_document "id" must be a string'
		});
		expect(validateToolCall('update_document', '{"id":{},"text":"body"}')).toEqual({
			status: 'error',
			message: 'update_document "id" must be a string'
		});
	});

	it('rejects a wrong-typed title instead of falling back to Untitled', () => {
		expect(validateToolCall('create_document', '{"title":5,"text":"body"}')).toEqual({
			status: 'error',
			message: 'create_document "title" must be a string'
		});
		expect(validateToolCall('update_document', '{"title":[],"text":"body"}')).toEqual({
			status: 'error',
			message: 'update_document "title" must be a string'
		});
	});

	it('rejects a wrong-typed mode instead of falling back to replace', () => {
		expect(validateToolCall('update_document', '{"text":"body","mode":3}')).toEqual({
			status: 'error',
			message: 'update_document "mode" must be replace or append'
		});
	});

	it('rejects wrong-typed and over-long text', () => {
		expect(validateToolCall('insert_at_cursor', '{"text":42}')).toEqual({
			status: 'error',
			message: 'insert_at_cursor requires non-empty "text"'
		});

		const long = JSON.stringify({ text: 'a'.repeat(20_001) });
		const result = validateToolCall('create_document', long);

		expect(result.status).toBe('error');
		expect(result.status === 'error' && result.message).toContain('too long');

		// The limit itself still passes.
		expect(
			validateToolCall('create_document', JSON.stringify({ text: 'a'.repeat(20_000) })).status
		).toBe('ok');
	});
});

describe('toolCallPreview', () => {
	it('returns the text a mutating call would write', () => {
		expect(toolCallPreview({ name: 'insert_at_cursor', args: { text: 'added' } })).toBe('added');
		expect(toolCallPreview({ name: 'create_document', args: { title: 'a', text: '# Plan' } })).toBe(
			'# Plan'
		);
		expect(
			toolCallPreview({ name: 'update_document', args: { text: 'body', mode: 'append' } })
		).toBe('body');
		expect(
			toolCallPreview({ name: 'replace_text', args: { target: 'before', text: 'after' } })
		).toBe('Replace:\nbefore\n\nWith:\nafter');
	});

	it('is empty for reads and title-only updates', () => {
		expect(toolCallPreview({ name: 'list_documents', args: {} })).toBe('');
		expect(toolCallPreview({ name: 'read_document', args: { id: 'd1' } })).toBe('');
		expect(
			toolCallPreview({ name: 'update_document', args: { title: 'Renamed', mode: 'replace' } })
		).toBe('');
	});
});

describe('describeToolCall', () => {
	it('summarizes each invocation for the approval prompt', () => {
		expect(describeToolCall({ name: 'list_documents', args: {} })).toBe('List saved documents');
		expect(describeToolCall({ name: 'read_document', args: {} })).toBe('Read the current document');
		expect(describeToolCall({ name: 'read_document', args: { id: 'd1' } })).toContain('d1');
		expect(describeToolCall({ name: 'create_document', args: { title: 'Plan', text: 'x' } })).toBe(
			'Create a new document "Plan"'
		);
		expect(describeToolCall({ name: 'update_document', args: { text: 'x', mode: 'append' } })).toBe(
			'Update the current document: append to the body of'
		);
		expect(
			describeToolCall({
				name: 'update_document',
				args: { id: 'd1', title: 'New', mode: 'replace' }
			})
		).toBe('Update document d1: rename (title "New")');
	});
});
