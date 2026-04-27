import type { Editor } from '@tiptap/core';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { htmlStyle } from './constants';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const HTML_FILE_EXTENSIONS = ['.html', '.htm'];

export type ShareMetadata = {
	endpoint: string;
	workspace: string;
};

function isSupportedUrl(value: string, protocols: string[]) {
	try {
		const url = new URL(value);
		return protocols.includes(url.protocol);
	} catch {
		return false;
	}
}

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

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function download(editor: Editor, preferredName?: string) {
	const searchParams = new URLSearchParams(location.search);
	const defaultName = getDefaultDownloadName(
		preferredName ?? searchParams.get('workspace'),
		localStorage.getItem('edited')
	);
	const promptedName = window.prompt('Please insert file name', defaultName);

	if (promptedName === null) {
		return;
	}

	let fileName: string;
	try {
		fileName = normalizeDownloadName(promptedName);
	} catch (error) {
		window.alert(error instanceof Error ? error.message : 'Invalid file name');
		return;
	}

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

export async function upload(editor: Editor, files: FileList | undefined) {
	try {
		const document = await readUploadedDocument(files);

		localStorage.setItem('edited', normalizeDownloadName(document.sourceFileName));
		editor.commands.setContent(document.content);
	} catch (error) {
		window.alert(error instanceof Error ? error.message : 'Failed to upload file');
		console.error(error);
	}
}

export function setLink(editor: Editor) {
	const previousUrl = editor.getAttributes('link').href;
	const url = window.prompt('Please insert link url', previousUrl);

	if (url === null) {
		return;
	}
	if (url.trim().length === 0) {
		editor.chain().focus().extendMarkRange('link').unsetLink().run();
		return;
	}
	if (!isSupportedUrl(url, ['http:', 'https:', 'mailto:', 'tel:'])) {
		window.alert('Please insert a valid URL');
		return;
	}
	editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_self' }).run();
}

export function clearContent(editor: Editor) {
	editor.commands.clearContent();
	editor.commands.focus();
}

export function addImage(editor: Editor) {
	const url = window.prompt('Please insert image url');
	if (!url || url.trim().length === 0) {
		return;
	}
	if (!isSupportedUrl(url, ['http:', 'https:', 'data:'])) {
		window.alert('Please insert a valid image URL');
		return;
	}
	editor.chain().focus().setImage({ src: url }).run();
}

export function startSharing(endpoint: string, workspace: string) {
	try {
		const metadata = validateShareMetadata(endpoint, workspace);
		location.replace(buildShareUrl(location.origin, location.pathname, metadata));
	} catch (error) {
		window.alert(error instanceof Error ? error.message : 'Failed to start sharing');
		console.error(error);
	}
}

export function endSharing(provider: HocuspocusProvider | undefined) {
	if (provider) {
		window.alert('Disconnecting...');
		localStorage.removeItem('connected');
		location.replace(`${location.origin}${location.pathname}`);
	}
}

export function addYoutube(editor: Editor) {
	const url = window.prompt('Please insert youtube url');
	if (!url || url.trim().length === 0) {
		return;
	}
	if (!isSupportedUrl(url, ['http:', 'https:'])) {
		window.alert('Please insert a valid YouTube URL');
		return;
	}
	editor.commands.setYoutubeVideo({
		src: url,
		width: 640,
		height: 480
	});
}
