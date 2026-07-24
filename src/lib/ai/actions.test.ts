import { describe, expect, it } from 'vitest';
import { checkAiRequest } from './actions';

describe('checkAiRequest', () => {
	const base = { hasApiKey: true, selection: '', prompt: '' };

	it('requires an API key first', () => {
		expect(checkAiRequest({ ...base, action: 'continue', hasApiKey: false })).toEqual({
			status: 'needs-api-key',
			message: expect.stringContaining('API key')
		});
	});

	it('requires a selection for selection-based actions', () => {
		for (const action of ['rewrite', 'summarize', 'proofread'] as const) {
			expect(checkAiRequest({ ...base, action })).toEqual({
				status: 'invalid',
				message: 'Select some text first.'
			});
			expect(checkAiRequest({ ...base, action, selection: 'text' })).toEqual({ status: 'ready' });
		}
	});

	it('requires a prompt for the prompt action', () => {
		expect(checkAiRequest({ ...base, action: 'prompt' })).toEqual({
			status: 'invalid',
			message: 'Enter a prompt.'
		});
		expect(checkAiRequest({ ...base, action: 'prompt', prompt: 'do it' })).toEqual({
			status: 'ready'
		});
	});

	it('allows continue without selection or prompt', () => {
		expect(checkAiRequest({ ...base, action: 'continue' })).toEqual({ status: 'ready' });
	});

	it('treats whitespace-only selection and prompt as empty', () => {
		expect(checkAiRequest({ ...base, action: 'rewrite', selection: '   ' })).toEqual({
			status: 'invalid',
			message: 'Select some text first.'
		});
		expect(checkAiRequest({ ...base, action: 'prompt', prompt: '  ' })).toEqual({
			status: 'invalid',
			message: 'Enter a prompt.'
		});
	});
});
