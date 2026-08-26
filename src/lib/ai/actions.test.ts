import { describe, expect, it } from 'vitest';
import { checkAgentRequest, checkAiRequest } from './actions';

describe('checkAiRequest', () => {
	const base = { hasApiKey: true, selection: '' };

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

	it('allows continue without a selection', () => {
		expect(checkAiRequest({ ...base, action: 'continue' })).toEqual({ status: 'ready' });
	});

	it('treats a whitespace-only selection as empty', () => {
		expect(checkAiRequest({ ...base, action: 'rewrite', selection: '   ' })).toEqual({
			status: 'invalid',
			message: 'Select some text first.'
		});
	});
});

describe('checkAgentRequest', () => {
	it('requires an API key first', () => {
		expect(checkAgentRequest({ hasApiKey: false, instruction: 'do it' })).toEqual({
			status: 'needs-api-key',
			message: expect.stringContaining('API key')
		});
	});

	it('requires an instruction, ignoring whitespace', () => {
		expect(checkAgentRequest({ hasApiKey: true, instruction: '  ' })).toEqual({
			status: 'invalid',
			message: 'Enter a prompt.'
		});
		expect(checkAgentRequest({ hasApiKey: true, instruction: 'do it' })).toEqual({
			status: 'ready'
		});
	});
});
