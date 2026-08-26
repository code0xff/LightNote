import type { AiAction } from './openai';

export type AiRequestCheck =
	| { status: 'needs-api-key'; message: string }
	| { status: 'invalid'; message: string }
	| { status: 'ready' };

const SELECTION_ACTIONS: AiAction[] = ['rewrite', 'summarize', 'proofread'];

const MISSING_KEY: AiRequestCheck = {
	status: 'needs-api-key',
	message: 'Add your OpenAI API key in AI settings first.'
};

/**
 * Validates whether an AI action can run given the current panel state,
 * returning a discriminated result the UI maps to behavior (open settings,
 * show an inline error, or proceed).
 */
export function checkAiRequest(input: {
	action: AiAction;
	hasApiKey: boolean;
	selection: string;
}): AiRequestCheck {
	if (!input.hasApiKey) {
		return MISSING_KEY;
	}

	if (SELECTION_ACTIONS.includes(input.action) && !input.selection.trim()) {
		return { status: 'invalid', message: 'Select some text first.' };
	}

	return { status: 'ready' };
}

/**
 * The same gate for a typed instruction. It is a separate function rather than a
 * sixth action: an agent run has no selection requirement, and every action it
 * would have shared the list with reads the selection instead of the textarea.
 */
export function checkAgentRequest(input: {
	hasApiKey: boolean;
	instruction: string;
}): AiRequestCheck {
	if (!input.hasApiKey) {
		return MISSING_KEY;
	}

	if (!input.instruction.trim()) {
		return { status: 'invalid', message: 'Enter a prompt.' };
	}

	return { status: 'ready' };
}
