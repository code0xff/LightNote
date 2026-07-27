import type { JSONContent } from '@tiptap/core';
import type { LightNoteDocument } from '$lib/documents/store';
import type { AgentToolResult } from './agent';
import { blocksToHtml, markdownToDocument, parseMarkdownBlocks } from './markdown';
import type { AiToolInvocation } from './tools';

const DOCUMENT_TEXT_LIMIT = 4000;

/** Nodes whose children are inline and must be joined without a separator. */
const INLINE_CONTAINERS = new Set(['paragraph', 'heading', 'codeBlock', 'text']);

export type DocumentToolStore = {
	listDocuments: () => Promise<LightNoteDocument[]>;
	getDocument: (id: string) => Promise<LightNoteDocument | null>;
	createDocument: (input: {
		title: string;
		content: JSONContent;
		contentFormat: 'tiptap-json';
	}) => Promise<LightNoteDocument>;
	updateDocument: (
		id: string,
		input: {
			title?: string;
			content?: string | JSONContent;
			contentFormat?: LightNoteDocument['contentFormat'];
		}
	) => Promise<LightNoteDocument>;
};

/**
 * The editor operations the tools need. Content arrives as parsed Tiptap nodes,
 * so this module owns the markdown parsing while the caller only runs editor
 * commands.
 */
export type EditorBridge = {
	getText: () => string;
	hasSelection: () => boolean;
	insertAtCursor: (nodes: JSONContent[]) => void;
	replaceSelection: (nodes: JSONContent[]) => void;
	setContent: (nodes: JSONContent[]) => void;
	appendContent: (nodes: JSONContent[]) => void;
	setTitle: (title: string) => void;
};

export type DocumentToolDeps = {
	store: DocumentToolStore;
	editor: EditorBridge;
	getCurrentDocumentId: () => string | null;
	getCurrentDocumentTitle: () => string;
	isSharingMode?: boolean;
	/** Called after a store write so the document list can be refreshed. */
	onStoreChanged?: (document: LightNoteDocument) => Promise<void> | void;
	/** Called after `create_document` so the new document can be opened. */
	openDocument?: (document: LightNoteDocument) => Promise<void> | void;
	textLimit?: number;
};

/** Parses tool text (a small markdown subset) into Tiptap block nodes. */
export function toContentNodes(text: string): JSONContent[] {
	return parseMarkdownBlocks(text);
}

export function toDocumentContent(text: string): JSONContent {
	return markdownToDocument(text);
}

function nodeToPlainText(node: JSONContent): string {
	if (node.type === 'text') {
		return typeof node.text === 'string' ? node.text : '';
	}

	if (node.type === 'hardBreak') {
		return '\n';
	}

	const children = (node.content ?? []).map(nodeToPlainText);

	return children.join(INLINE_CONTAINERS.has(node.type ?? '') ? '' : '\n');
}

function htmlToPlainText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|h[1-6]|li|blockquote|pre|div|tr)>/gi, '\n\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Flattens stored content (HTML string or Tiptap JSON) into plain text. */
export function documentToPlainText(content: string | JSONContent): string {
	if (typeof content === 'string') {
		return htmlToPlainText(content);
	}

	return (content.content ?? [])
		.map((node) => nodeToPlainText(node).trim())
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Appends text to stored content, staying in the format the document already
 * uses so a legacy HTML document is not silently converted.
 */
export function appendToContent(
	document: LightNoteDocument,
	text: string
): { content: string | JSONContent; contentFormat: LightNoteDocument['contentFormat'] } {
	if (typeof document.content === 'string') {
		return {
			content: `${document.content}${blocksToHtml(toContentNodes(text))}`,
			contentFormat: 'html'
		};
	}

	const existing = document.content;

	return {
		content: { ...existing, content: [...(existing.content ?? []), ...toContentNodes(text)] },
		contentFormat: 'tiptap-json'
	};
}

function capText(text: string, limit: number) {
	return text.length > limit
		? { text: text.slice(0, limit), truncated: true }
		: { text, truncated: false };
}

/**
 * Builds the `executeTool` implementation the agent loop calls. Edits to the
 * open document go through the editor bridge so they land in Tiptap history and
 * stay undoable; only other documents are written straight to the store.
 */
export function createDocumentToolExecutor(deps: DocumentToolDeps) {
	const textLimit = deps.textLimit ?? DOCUMENT_TEXT_LIMIT;

	return async function executeTool(invocation: AiToolInvocation): Promise<AgentToolResult> {
		switch (invocation.name) {
			case 'list_documents': {
				const documents = await deps.store.listDocuments();
				const currentId = deps.getCurrentDocumentId();

				return {
					ok: true,
					data: {
						documents: documents.map((document) => ({
							id: document.id,
							title: document.title,
							updatedAt: new Date(document.updatedAt).toISOString(),
							current: document.id === currentId
						}))
					}
				};
			}
			case 'read_document': {
				const currentId = deps.getCurrentDocumentId();
				const { id } = invocation.args;

				// The open document is read from the editor because saves are
				// debounced, so the store copy can lag behind what the user sees.
				if (!id || id === currentId) {
					return {
						ok: true,
						data: {
							id: currentId,
							title: deps.getCurrentDocumentTitle(),
							current: true,
							...capText(deps.editor.getText(), textLimit)
						}
					};
				}

				const document = await deps.store.getDocument(id);

				if (!document) {
					return { ok: false, error: `Document not found: ${id}` };
				}

				return {
					ok: true,
					data: {
						id: document.id,
						title: document.title,
						current: false,
						...capText(documentToPlainText(document.content), textLimit)
					}
				};
			}
			case 'insert_at_cursor': {
				deps.editor.insertAtCursor(toContentNodes(invocation.args.text));

				return { ok: true, data: { inserted: invocation.args.text.length } };
			}
			case 'replace_selection': {
				if (!deps.editor.hasSelection()) {
					return { ok: false, error: 'There is no selected text to replace.' };
				}

				deps.editor.replaceSelection(toContentNodes(invocation.args.text));

				return { ok: true, data: { replaced: invocation.args.text.length } };
			}
			case 'create_document': {
				if (deps.isSharingMode) {
					return {
						ok: false,
						error: 'Creating documents is not available while collaborating on a shared document.'
					};
				}

				const { title, text } = invocation.args;
				const document = await deps.store.createDocument({
					title,
					content: toDocumentContent(text),
					contentFormat: 'tiptap-json'
				});

				await deps.onStoreChanged?.(document);
				await deps.openDocument?.(document);

				return { ok: true, data: { id: document.id, title: document.title, opened: true } };
			}
			case 'update_document': {
				const { id, title, text, mode } = invocation.args;
				const currentId = deps.getCurrentDocumentId();

				if (!id || (currentId && id === currentId)) {
					if (text) {
						if (mode === 'append') {
							deps.editor.appendContent(toContentNodes(text));
						} else {
							deps.editor.setContent(toContentNodes(text));
						}
					}

					if (title) {
						deps.editor.setTitle(title);
					}

					return { ok: true, data: { id: currentId, current: true, mode } };
				}

				if (deps.isSharingMode) {
					return {
						ok: false,
						error: 'Updating stored documents is not available while collaborating.'
					};
				}

				const document = await deps.store.getDocument(id);

				if (!document) {
					return { ok: false, error: `Document not found: ${id}` };
				}

				const contentPatch = text
					? mode === 'append'
						? appendToContent(document, text)
						: { content: toDocumentContent(text), contentFormat: 'tiptap-json' as const }
					: {};

				const updated = await deps.store.updateDocument(id, {
					...contentPatch,
					...(title ? { title } : {})
				});

				await deps.onStoreChanged?.(updated);

				return { ok: true, data: { id: updated.id, title: updated.title, mode } };
			}
		}
	};
}
