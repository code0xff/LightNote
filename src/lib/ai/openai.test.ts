import { describe, expect, it, vi } from 'vitest';
import {
	buildMessages,
	createChatCompletion,
	DEFAULT_OPENAI_MODEL,
	generateText,
	OPENAI_ENDPOINT,
	OPENAI_MODEL_OPTIONS,
	OPENAI_SETTINGS_KEY,
	parseAssistantMessage,
	parseCompletion,
	readOpenAiSettings,
	requestChatMessage,
	resolveModelOptions,
	stripWrapping,
	toEditorHtml,
	truncateContext,
	truncateSelection,
	writeOpenAiSettings
} from './openai';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map<string, string>(Object.entries(initial));

	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => values.set(key, value))
	} as unknown as Storage;
}

describe('openai settings', () => {
	it('returns defaults when nothing is stored', () => {
		expect(readOpenAiSettings(memoryStorage())).toEqual({
			apiKey: '',
			model: DEFAULT_OPENAI_MODEL
		});
	});

	it('reads stored settings and falls back to the default model', () => {
		const storage = memoryStorage({
			[OPENAI_SETTINGS_KEY]: JSON.stringify({ apiKey: 'sk-test', model: '' })
		});

		expect(readOpenAiSettings(storage)).toEqual({
			apiKey: 'sk-test',
			model: DEFAULT_OPENAI_MODEL
		});
	});

	it('ignores malformed stored settings', () => {
		const storage = memoryStorage({ [OPENAI_SETTINGS_KEY]: '{bad json' });

		expect(readOpenAiSettings(storage)).toEqual({ apiKey: '', model: DEFAULT_OPENAI_MODEL });
	});

	it('trims and persists settings', () => {
		const storage = memoryStorage();

		const saved = writeOpenAiSettings({ apiKey: '  sk-key  ', model: '  gpt-5.6-terra ' }, storage);

		expect(saved).toEqual({ apiKey: 'sk-key', model: 'gpt-5.6-terra' });
		expect(storage.setItem).toHaveBeenCalledWith(
			OPENAI_SETTINGS_KEY,
			JSON.stringify({ apiKey: 'sk-key', model: 'gpt-5.6-terra' })
		);
	});

	it('keeps built-in options as-is but prepends an unknown current model', () => {
		expect(resolveModelOptions(DEFAULT_OPENAI_MODEL)).toEqual([...OPENAI_MODEL_OPTIONS]);
		expect(resolveModelOptions('gpt-6-future')).toEqual(['gpt-6-future', ...OPENAI_MODEL_OPTIONS]);
		expect(resolveModelOptions('')).toEqual([...OPENAI_MODEL_OPTIONS]);
	});
});

describe('prompt building', () => {
	it('builds rewrite messages with an optional instruction', () => {
		const [system, user] = buildMessages('rewrite', {
			selection: 'the text',
			instruction: 'make it formal'
		});

		expect(system.role).toBe('system');
		expect(system.content).toContain('make it formal');
		expect(user).toEqual({ role: 'user', content: 'the text' });
	});

	it('uses trimmed context for continue', () => {
		const [, user] = buildMessages('continue', { context: '  earlier text  ' });

		expect(user).toEqual({ role: 'user', content: 'earlier text' });
	});

	it('applies a prompt to the selection when one is present', () => {
		const [system, user] = buildMessages('prompt', {
			selection: 'draft body',
			instruction: 'translate to Korean'
		});

		expect(system.content).toContain("Apply the user's instruction");
		expect(user.content).toContain('translate to Korean');
		expect(user.content).toContain('draft body');
	});

	it('generates from an instruction and context when no selection exists', () => {
		const [, user] = buildMessages('prompt', {
			instruction: 'write an intro',
			context: 'previous paragraph'
		});

		expect(user.content).toContain('write an intro');
		expect(user.content).toContain('previous paragraph');
	});
});

describe('output handling', () => {
	it('strips code fences and surrounding quotes', () => {
		expect(stripWrapping('```\nhello\n```')).toBe('hello');
		expect(stripWrapping('```text\nhello world\n```')).toBe('hello world');
		// Single-line fences have no language tag: keep the whole inner body.
		expect(stripWrapping('```hello```')).toBe('hello');
		expect(stripWrapping('```hello world```')).toBe('hello world');
		expect(stripWrapping('```{"a":1}```')).toBe('{"a":1}');
		// Do not merge multiple fenced blocks into one wrapper.
		expect(stripWrapping('```a``` and ```b```')).toBe('```a``` and ```b```');
		expect(stripWrapping('"quoted"')).toBe('quoted');
		expect(stripWrapping('“smart”')).toBe('smart');
	});

	it('caps an over-long selection from the start', () => {
		const long = 'HEAD' + 'a'.repeat(20);

		expect(truncateSelection(long, 4)).toBe('HEAD');
		expect(truncateSelection('  short  ', 100)).toBe('short');
	});

	it('parses completion content', () => {
		const text = parseCompletion({ choices: [{ message: { content: '  result  ' } }] });

		expect(text).toBe('result');
	});

	it('throws on empty completion content', () => {
		expect(() => parseCompletion({ choices: [{ message: { content: '' } }] })).toThrow(
			'empty response'
		);
		expect(() => parseCompletion({})).toThrow('empty response');
	});

	it('converts plain text into escaped paragraphs', () => {
		expect(toEditorHtml('first\n\nsecond')).toBe('<p>first</p><p>second</p>');
		expect(toEditorHtml('line<one>\nline&two')).toBe('<p>line&lt;one&gt;<br>line&amp;two</p>');
		expect(toEditorHtml('   ')).toBe('<p></p>');
	});

	it('keeps only the tail of an over-long context', () => {
		const long = 'a'.repeat(20) + 'TAIL';

		expect(truncateContext(long, 4)).toBe('TAIL');
		expect(truncateContext('  short  ', 100)).toBe('short');
	});
});

describe('createChatCompletion', () => {
	it('rejects when no API key is set', async () => {
		await expect(
			createChatCompletion({ apiKey: '   ', model: 'gpt-5.6-luna', messages: [] })
		).rejects.toThrow('API key is not set');
	});

	it('sends an authorized request and returns the content', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({ choices: [{ message: { content: 'generated' } }] })
		})) as unknown as typeof fetch;

		const result = await createChatCompletion({
			apiKey: 'sk-key',
			model: 'gpt-5.6-luna',
			messages: [{ role: 'user', content: 'hi' }],
			fetchImpl
		});

		expect(result).toBe('generated');

		const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe(OPENAI_ENDPOINT);
		expect((init as RequestInit).method).toBe('POST');
		expect((init as RequestInit).headers).toMatchObject({
			Authorization: 'Bearer sk-key'
		});
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			model: 'gpt-5.6-luna',
			messages: [{ role: 'user', content: 'hi' }]
		});
	});

	it('surfaces the API error message on failure', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: false,
			status: 401,
			json: async () => ({ error: { message: 'Invalid key' } })
		})) as unknown as typeof fetch;

		await expect(
			createChatCompletion({
				apiKey: 'sk-key',
				model: 'gpt-5.6-luna',
				messages: [],
				fetchImpl
			})
		).rejects.toThrow('OpenAI request failed (401): Invalid key');
	});
});

describe('requestChatMessage', () => {
	it('returns tool calls even when the content is null', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: { name: 'list_documents', arguments: '{}' }
								}
							]
						}
					}
				]
			})
		})) as unknown as typeof fetch;

		const message = await requestChatMessage({
			apiKey: 'sk-key',
			model: 'gpt-5.6-luna',
			messages: [{ role: 'user', content: 'what do I have?' }],
			tools: [
				{
					type: 'function',
					function: { name: 'list_documents', description: 'list', parameters: { type: 'object' } }
				}
			],
			fetchImpl
		});

		expect(message).toEqual({
			role: 'assistant',
			// A null content becomes an empty string so the message can be echoed
			// back into the follow-up request unchanged.
			content: '',
			tool_calls: [
				{ id: 'call_1', type: 'function', function: { name: 'list_documents', arguments: '{}' } }
			]
		});

		const body = JSON.parse(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
		);
		expect(body.tools).toHaveLength(1);
	});

	it('disables reasoning when sending tools, and retries without it if rejected', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
			bodies.push(JSON.parse(init.body as string));

			if (bodies.length === 1) {
				return {
					ok: false,
					status: 400,
					json: async () => ({
						error: { message: 'Unrecognized request argument supplied: reasoning_effort' }
					})
				};
			}

			return { ok: true, json: async () => ({ choices: [{ message: { content: 'done' } }] }) };
		}) as unknown as typeof fetch;

		const tools = [
			{
				type: 'function' as const,
				function: { name: 'list_documents', description: 'list', parameters: { type: 'object' } }
			}
		];

		const message = await requestChatMessage({
			apiKey: 'sk-key',
			model: 'gpt-5.6-luna',
			messages: [],
			tools,
			fetchImpl
		});

		expect(message.content).toBe('done');
		// First attempt disables reasoning, as the API requires for function tools.
		expect(bodies[0].reasoning_effort).toBe('none');
		expect(bodies[1]).not.toHaveProperty('reasoning_effort');
		expect(bodies[1].tools).toHaveLength(1);
	});

	it('does not retry a 400 unrelated to reasoning_effort', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: false,
			status: 400,
			json: async () => ({ error: { message: 'Invalid schema for function' } })
		})) as unknown as typeof fetch;

		await expect(
			requestChatMessage({
				apiKey: 'sk-key',
				model: 'gpt-5.6-luna',
				messages: [],
				tools: [
					{
						type: 'function',
						function: {
							name: 'list_documents',
							description: 'list',
							parameters: { type: 'object' }
						}
					}
				],
				fetchImpl
			})
		).rejects.toThrow('Invalid schema for function');

		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('omits the tools field when no tools are passed', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({ choices: [{ message: { content: 'plain' } }] })
		})) as unknown as typeof fetch;

		await requestChatMessage({
			apiKey: 'sk-key',
			model: 'gpt-5.6-luna',
			messages: [],
			tools: [],
			fetchImpl
		});

		const body = JSON.parse(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
		);
		expect(body).toEqual({ model: 'gpt-5.6-luna', messages: [] });
	});

	it('drops tool calls with non-string arguments instead of defaulting them', () => {
		// Defaulting to "{}" would turn a malformed call into a valid request (e.g.
		// read_document on the current document); dropping it keeps the echoed
		// assistant message free of a tool_call that needs a paired result.
		expect(
			parseAssistantMessage({
				choices: [
					{
						message: {
							content: 'hi',
							tool_calls: [
								{
									id: 'c1',
									type: 'function',
									function: { name: 'read_document', arguments: { id: 1 } }
								}
							]
						}
					}
				]
			})
		).toEqual({ role: 'assistant', content: 'hi' });
	});

	it('keeps only the first of duplicate tool call ids', () => {
		const message = parseAssistantMessage({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'dup',
								type: 'function',
								function: { name: 'list_documents', arguments: '{}' }
							},
							{
								id: 'dup',
								type: 'function',
								function: { name: 'read_document', arguments: '{"id":"d1"}' }
							}
						]
					}
				}
			]
		});

		expect(message.tool_calls).toHaveLength(1);
		expect(message.tool_calls?.[0].function.name).toBe('list_documents');
	});

	it('drops malformed tool calls and rejects a fully empty message', () => {
		expect(
			parseAssistantMessage({
				choices: [{ message: { content: 'hi', tool_calls: [{ function: { name: 'x' } }] } }]
			})
		).toEqual({ role: 'assistant', content: 'hi' });

		expect(() =>
			parseAssistantMessage({ choices: [{ message: { content: null, tool_calls: [] } }] })
		).toThrow('empty response');
	});

	it('still throws from createChatCompletion when only tool calls come back', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: { name: 'list_documents', arguments: '{}' }
								}
							]
						}
					}
				]
			})
		})) as unknown as typeof fetch;

		await expect(
			createChatCompletion({ apiKey: 'sk-key', model: 'gpt-5.6-luna', messages: [], fetchImpl })
		).rejects.toThrow('empty response');
	});
});

describe('generateText', () => {
	it('builds messages from the action and calls the API', async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			json: async () => ({ choices: [{ message: { content: 'summary' } }] })
		})) as unknown as typeof fetch;

		const result = await generateText({
			action: 'summarize',
			settings: { apiKey: 'sk-key', model: 'gpt-5.6-terra' },
			selection: 'a long passage',
			fetchImpl
		});

		expect(result).toBe('summary');

		const body = JSON.parse(
			(fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
		);
		expect(body.model).toBe('gpt-5.6-terra');
		expect(body.messages[0].content).toContain('Summarize');
		expect(body.messages[1].content).toBe('a long passage');
	});
});
