import type { Editor } from '@tiptap/core';
import type { Selection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { escapeHtml, isSupportedUrl } from '$lib/utils';
import { htmlStyle } from './constants';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const HTML_FILE_EXTENSIONS = ['.html', '.htm'];

export type ShareMetadata = {
	endpoint: string;
	workspace: string;
};

export type SharedDocumentReference = ShareMetadata & {
	updatedAt: number;
};

export const SHARED_DOCUMENTS_KEY = 'sharedDocuments';

const STARTUP_NOTICE_KEY = 'notice';

/**
 * Hands a message to the page that is about to replace this one. A failed share
 * ends in `location.replace`, which would take a toast with it — the message
 * only means anything on the other side of that reload. `sessionStorage`, so it
 * cannot outlive the tab and greet the user again tomorrow.
 */
export function stashStartupNotice(storage: Storage, message: string) {
	storage.setItem(STARTUP_NOTICE_KEY, message);
}

/** Reads the handed-over message and clears it, so it is shown exactly once. */
export function takeStartupNotice(storage: Storage): string {
	const message = storage.getItem(STARTUP_NOTICE_KEY) ?? '';

	storage.removeItem(STARTUP_NOTICE_KEY);

	return message;
}
const MAX_SHARED_DOCUMENTS = 25;

export function validateShareMetadata(endpoint: string, workspace: string): ShareMetadata {
	const metadata = {
		endpoint: endpoint.trim(),
		workspace: workspace.trim()
	};

	if (!metadata.endpoint || !isSupportedUrl(metadata.endpoint, ['ws:', 'wss:'])) {
		throw new Error('Invalid endpoint. endpoint should start with ws:// or wss://');
	}
	if (!metadata.workspace) {
		throw new Error('Invalid workspace');
	}

	return metadata;
}

export function buildShareUrl(origin: string, pathname: string, metadata: ShareMetadata) {
	const url = new URL(pathname, origin);

	url.searchParams.set('endpoint', metadata.endpoint);
	url.searchParams.set('workspace', metadata.workspace);

	return url.toString();
}

/**
 * Reconnection is the provider's job, not ours. It backs off and keeps trying
 * for as long as the tab is open (`maxAttempts: 0`): a session that dropped is
 * one whose content lives in this page, so giving up on it costs the user work.
 * The delay is capped so a long outage does not turn into a long wait after the
 * relay comes back.
 */
export const SHARE_SOCKET_OPTIONS = {
	maxAttempts: 0,
	initialDelay: 0,
	delay: 1000,
	factor: 1.6,
	maxDelay: 10000,
	jitter: true
};

/**
 * How long the *first* connection may take before the address is judged wrong.
 * Only the first: once a session has connected, a drop is treated as an outage
 * to wait out, never as a reason to leave.
 */
export const SHARE_CONNECT_TIMEOUT_MS = 8000;

export type ShareStatus = 'connecting' | 'connected' | 'reconnecting';

export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
	connecting: 'Connecting…',
	connected: 'Connected',
	reconnecting: 'Reconnecting…'
};

/**
 * `hasConnected` is the whole distinction: an unreachable address and a dropped
 * session look identical to the socket, but one means "this link is probably
 * wrong" and the other means "your work is here, hold on".
 */
export function nextShareStatus(connected: boolean, hasConnected: boolean): ShareStatus {
	if (connected) {
		return 'connected';
	}

	return hasConnected ? 'reconnecting' : 'connecting';
}

/**
 * Title for a local copy taken out of a shared session. Shared documents have no
 * local row, so a copy is the only way work in one survives the relay.
 */
export function sharedCopyTitle(workspace: string): string {
	const name = workspace.trim();

	return name ? `${name} (shared copy)` : 'Untitled (shared copy)';
}

function isSameShare(left: ShareMetadata, right: ShareMetadata) {
	return left.endpoint === right.endpoint && left.workspace === right.workspace;
}

export function readSharedMetadata(storage: Storage): ShareMetadata | null {
	const shared = storage.getItem('shared');

	if (!shared) {
		return null;
	}

	try {
		const value = JSON.parse(shared) as Partial<ShareMetadata>;

		if (typeof value.endpoint !== 'string' || typeof value.workspace !== 'string') {
			return null;
		}

		return validateShareMetadata(value.endpoint, value.workspace);
	} catch {
		return null;
	}
}

export function readSharedDocumentHistory(storage: Storage = localStorage) {
	const sharedDocuments = storage.getItem(SHARED_DOCUMENTS_KEY);

	if (!sharedDocuments) {
		return [];
	}

	try {
		const values = JSON.parse(sharedDocuments) as Partial<SharedDocumentReference>[];

		if (!Array.isArray(values)) {
			return [];
		}

		return values
			.flatMap((value) => {
				if (
					typeof value.endpoint !== 'string' ||
					typeof value.workspace !== 'string' ||
					typeof value.updatedAt !== 'number'
				) {
					return [];
				}

				try {
					return [
						{
							...validateShareMetadata(value.endpoint, value.workspace),
							updatedAt: value.updatedAt
						}
					];
				} catch {
					return [];
				}
			})
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, MAX_SHARED_DOCUMENTS);
	} catch {
		return [];
	}
}

export function upsertSharedDocumentHistory(
	metadata: ShareMetadata,
	storage: Storage = localStorage,
	now = Date.now()
) {
	const normalizedMetadata = validateShareMetadata(metadata.endpoint, metadata.workspace);
	const nextDocuments = [
		{ ...normalizedMetadata, updatedAt: now },
		...readSharedDocumentHistory(storage).filter(
			(document) => !isSameShare(document, normalizedMetadata)
		)
	].slice(0, MAX_SHARED_DOCUMENTS);

	storage.setItem(SHARED_DOCUMENTS_KEY, JSON.stringify(nextDocuments));

	return nextDocuments;
}

export function removeSharedDocumentHistory(
	metadata: ShareMetadata,
	storage: Storage = localStorage
) {
	const normalizedMetadata = validateShareMetadata(metadata.endpoint, metadata.workspace);
	const nextDocuments = readSharedDocumentHistory(storage).filter(
		(document) => !isSameShare(document, normalizedMetadata)
	);

	storage.setItem(SHARED_DOCUMENTS_KEY, JSON.stringify(nextDocuments));

	return nextDocuments;
}

/** The browser tab title: the document name, or just the app name. */
export function formatPageTitle(name?: string) {
	const normalizedName = name?.trim();

	return normalizedName ? `LightNote - ${normalizedName}` : 'LightNote';
}

export function getDefaultDownloadName(
	workspace: string | null,
	edited: string | null,
	now = Date.now()
) {
	const preferredName = [workspace, edited].find((value) => value?.trim());

	return normalizeDownloadName(preferredName || `light_note_${now}`);
}

export function normalizeDownloadName(fileName: string) {
	const safeName = fileName
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/\s+/g, ' ');

	if (!safeName) {
		throw new Error('Invalid file name');
	}

	return HTML_FILE_EXTENSIONS.some((extension) => safeName.toLowerCase().endsWith(extension))
		? safeName
		: `${safeName}.html`;
}

export function createExportHtml(content: string, title = 'LightNote') {
	return `<!doctype html>
<html lang="en">
${htmlStyle.replace('<head>', `<head>\n  <title>${escapeHtml(title)}</title>`)}
<body>
${content}
</body>
</html>
`;
}

export function extractEditorContent(fileContent: string) {
	const bodyMatch = fileContent.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);

	return bodyMatch ? bodyMatch[1].trim() : fileContent;
}

export function validateUploadFile(file: File | undefined) {
	if (!file) {
		throw new Error('No file selected');
	}

	const lowerName = file.name.toLowerCase();
	const isHtmlName = HTML_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
	const isHtmlType = file.type === 'text/html' || file.type === 'application/xhtml+xml';

	if (!isHtmlName && !isHtmlType) {
		throw new Error('Please upload an HTML file');
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new Error('The selected file is too large');
	}

	return file;
}

export async function readUploadedDocument(files: FileList | undefined) {
	const file = validateUploadFile(files?.[0]);
	const content = extractEditorContent(await file.text());
	const title = normalizeDownloadName(file.name).replace(/\.html?$/i, '');

	return {
		title,
		content,
		contentFormat: 'html' as const,
		sourceFileName: file.name
	};
}

/** The name the download dialog opens on. */
export function suggestedDownloadName(preferredName?: string) {
	const searchParams = new URLSearchParams(location.search);

	return getDefaultDownloadName(
		preferredName ?? searchParams.get('workspace'),
		localStorage.getItem('edited')
	);
}

/**
 * Writes the file. The name arrives already normalized: collecting it and
 * rejecting a bad one belong to the dialog, which can show the reason next to
 * the box the user has to fix.
 */
export function download(editor: Editor, fileName: string) {
	localStorage.setItem('edited', fileName);

	const blob = new Blob([createExportHtml(editor.getHTML(), fileName.replace(/\.html?$/i, ''))], {
		type: 'text/html;charset=utf-8'
	});
	const url = window.URL.createObjectURL(blob);
	const element = document.createElement('a');

	element.setAttribute('href', url);
	element.setAttribute('download', fileName);
	element.click();
	window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
}

export type UrlInsertKind = 'link' | 'image' | 'youtube';

export type UrlInsertSpec = {
	title: string;
	description: string;
	label: string;
	placeholder: string;
	submitLabel: string;
	/** Everything else is rejected, so a `javascript:` URL never reaches Tiptap. */
	protocols: string[];
	invalidMessage: string;
};

/**
 * What the URL dialog says and accepts for each kind. These used to be
 * `window.prompt` strings: a native prompt cannot be styled, cannot show the
 * error next to the box it belongs to, and on submit either applied the change
 * or replaced itself with an `alert` that threw the typed URL away.
 */
export const URL_INSERTS: Record<UrlInsertKind, UrlInsertSpec> = {
	link: {
		title: 'Link',
		description: 'Paste the address to link to. Leaving the box empty removes the link.',
		label: 'URL',
		placeholder: 'https://example.com',
		submitLabel: 'Apply',
		protocols: ['http:', 'https:', 'mailto:', 'tel:'],
		invalidMessage: 'Enter a full http, https, mailto, or tel address.'
	},
	image: {
		title: 'Image',
		description: 'Paste the address of the image to insert.',
		label: 'Image URL',
		placeholder: 'https://example.com/image.png',
		submitLabel: 'Insert',
		protocols: ['http:', 'https:', 'data:'],
		invalidMessage: 'Enter a full http, https, or data address.'
	},
	youtube: {
		title: 'YouTube video',
		description: 'Paste the address of the video to embed.',
		label: 'Video URL',
		placeholder: 'https://www.youtube.com/watch?v=...',
		submitLabel: 'Insert',
		protocols: ['http:', 'https:'],
		invalidMessage: 'Enter a full http or https address.'
	}
};

export type UrlInsertCheck =
	/** Only a link can be submitted empty, and doing so removes it. */
	{ status: 'clear' } | { status: 'invalid'; message: string } | { status: 'ok'; url: string };

export function checkUrlInsert(kind: UrlInsertKind, value: string): UrlInsertCheck {
	const url = value.trim();

	if (!url) {
		return kind === 'link' ? { status: 'clear' } : { status: 'invalid', message: 'Enter a URL.' };
	}

	if (!isSupportedUrl(url, URL_INSERTS[kind].protocols)) {
		return { status: 'invalid', message: URL_INSERTS[kind].invalidMessage };
	}

	return { status: 'ok', url };
}

/**
 * Applies a checked URL. Kept apart from `checkUrlInsert` so the dialog can
 * report an invalid address without closing — the typed URL stays on screen to
 * be corrected instead of being lost with the prompt that collected it.
 */
export function applyUrlInsert(editor: Editor, kind: UrlInsertKind, url: string) {
	if (kind === 'image') {
		editor.chain().focus().setImage({ src: url }).run();
		return;
	}

	if (kind === 'youtube') {
		editor.commands.setYoutubeVideo({ src: url, width: 640, height: 480 });
		return;
	}

	if (!url) {
		editor.chain().focus().extendMarkRange('link').unsetLink().run();
		return;
	}

	editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_self' }).run();
}

/** The address the link dialog opens with, so editing a link is not retyping it. */
export function currentLinkUrl(editor: Editor): string {
	const href = editor.getAttributes('link').href;

	return typeof href === 'string' ? href : '';
}

export function clearContent(editor: Editor) {
	editor.commands.clearContent();
	editor.commands.focus();
}

/** Throws on invalid metadata so the caller can report it where it was typed. */
export function startSharing(endpoint: string, workspace: string) {
	const metadata = validateShareMetadata(endpoint, workspace);

	location.replace(buildShareUrl(location.origin, location.pathname, metadata));
}

export function endSharing(provider: HocuspocusProvider | undefined) {
	if (provider) {
		// The old `alert('Disconnecting...')` only mattered because it blocked: the
		// reload below is the feedback, and a toast would be gone before it is read.
		location.replace(`${location.origin}${location.pathname}`);
	}
}

/**
 * A cell selection can never be treated as one text range: its `from`/`to` span
 * the table structure between the selected cells, so writing over it would
 * delete rows and cells. Counting `ranges` is not enough to spot one — a
 * single-cell selection has exactly one range, just like a text selection.
 */
export function isCellSelection(selection: Selection) {
	return selection instanceof CellSelection;
}

/** Table inserted by the toolbar: a header row plus two body rows. */
export const DEFAULT_TABLE_SIZE = { rows: 3, cols: 3, withHeaderRow: true } as const;

export function insertTable(editor: Editor) {
	editor
		.chain()
		.focus()
		.insertTable({ ...DEFAULT_TABLE_SIZE })
		.run();
}

/**
 * From `lg` up the document list is docked beside the text; below that it
 * slides over it. Shared with the CSS breakpoint the shell and nav offsets use.
 */
export const DOCKED_SIDEBAR_QUERY = '(min-width: 1024px)';

const SIDEBAR_STORAGE_KEY = 'sidebar';

/**
 * Collapsing the document list is remembered, but only while it is docked:
 * below `lg` it covers the note instead of sitting beside it, and restoring it
 * open would hide the document the user came back to read.
 */
export function readSidebarOpen(storage: Storage, docked: boolean): boolean {
	if (!docked) {
		return false;
	}

	return storage.getItem(SIDEBAR_STORAGE_KEY) !== 'closed';
}

/** Records only the docked state, for the reason in `readSidebarOpen`. */
export function writeSidebarOpen(storage: Storage, docked: boolean, open: boolean): void {
	if (!docked) {
		return;
	}

	storage.setItem(SIDEBAR_STORAGE_KEY, open ? 'open' : 'closed');
}
