import type { AiAction } from './openai';

export type AiRequestCheck =
	| { status: 'needs-api-key'; message: string }
	| { status: 'invalid'; message: string }
	| { status: 'ready' };

const SELECTION_ACTIONS: AiAction[] = ['rewrite', 'summarize', 'proofread'];

/**
 * Validates whether an AI action can run given the current dialog state,
 * returning a discriminated result the UI maps to behavior (open settings,
 * show an inline error, or proceed).
 */
export function checkAiRequest(input: {
	action: AiAction;
	hasApiKey: boolean;
	selection: string;
	prompt: string;
}): AiRequestCheck {
	if (!input.hasApiKey) {
		return { status: 'needs-api-key', message: 'Add your OpenAI API key in AI settings first.' };
	}

	if (SELECTION_ACTIONS.includes(input.action) && !input.selection.trim()) {
		return { status: 'invalid', message: 'Select some text first.' };
	}

	if (input.action === 'prompt' && !input.prompt.trim()) {
		return { status: 'invalid', message: 'Enter a prompt.' };
	}

	return { status: 'ready' };
}
