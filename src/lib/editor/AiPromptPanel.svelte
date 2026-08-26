<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		AlertTriangle,
		Ban,
		Check,
		Loader2,
		PanelRightClose,
		Settings2,
		Sparkles,
		Trash2,
		X
	} from 'lucide-svelte';
	import { Button } from '@/lib/components/ui/button';
	import { Input } from '@/lib/components/ui/input';
	import { Label } from '@/lib/components/ui/label';
	import type { AiAction } from '$lib/ai/openai';
	import type { AgentStep, AgentStepStatus } from '$lib/ai/agent';
	import type { AiHistoryEntry } from '$lib/ai/historyStore';

	export let open = false;
	export let hasApiKey = false;
	export let apiKey = '';
	export let selection = '';
	export let prompt = '';
	export let error = '';
	export let busy = false;
	export let steps: AgentStep[] = [];
	export let agentText = '';
	export let autoApprove = false;
	export let allowDocumentWideEdits = false;
	/**
	 * The permission the resumable run carries. `allowDocumentWideEdits` is a
	 * per-request opt-in that resets, so without this the panel would show an
	 * unchecked box while Continue resumes a run that still holds the permission.
	 */
	export let continueDocumentWideEdits = false;
	export let pendingApproval: { description: string; preview?: string } | null = null;
	export let history: AiHistoryEntry[] = [];
	/** Set when the last run stopped early and can be resumed. */
	export let continueReason: 'max-steps' | 'stalled' | null = null;
	/**
	 * Instruction of the run in flight. The textarea is cleared on send, so the
	 * live entry cannot read it from `prompt`.
	 */
	export let runPrompt = '';
	/** Set while a one-shot action is running, so the live entry can name it. */
	export let runAction: AiAction | null = null;
	export let onClose: () => void;
	export let onSaveKey: () => void;
	export let onAction: (action: AiAction) => void;
	export let onRunAgent: () => void;
	export let onApproval: (approved: boolean) => void;
	export let onCancel: () => void;
	export let onReplaceSelection: (text: string, selection: string) => void;
	export let onInsertAtCursor: (text: string) => void;
	export let onClearSelection: () => void;
	export let onOpenSettings: () => void;
	export let onDeleteHistoryEntry: (id: string) => void;
	export let onClearHistory: () => void;
	export let onContinue: () => void;

	/** What an entry that is not a one-shot action is called in the timeline. */
	const AGENT_LABEL = 'AI';

	const ACTION_LABELS: Record<AiAction, string> = {
		rewrite: 'Rewrite',
		summarize: 'Summarize',
		proofread: 'Proofread',
		continue: 'Continue writing'
	};

	/** Keeps the newest entry in view as history grows. */
	let historyEnd: HTMLElement | undefined;

	$: if (historyEnd && (history.length || busy || steps.length)) {
		historyEnd.scrollIntoView({ block: 'end' });
	}

	$: hasLiveRun = busy || steps.length > 0 || Boolean(agentText);

	$: canContinue = continueReason !== null;

	function send() {
		if (busy || !prompt.trim()) {
			return;
		}

		onRunAgent();
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			send();
		}
	}

	function isFailedStatus(status: AgentStepStatus, ok: boolean) {
		return status !== 'done' || !ok;
	}

	function stepFailed(step: AgentStep) {
		return isFailedStatus(step.status, step.result.ok);
	}

	function entryBadge(entry: AiHistoryEntry) {
		return entry.action ? ACTION_LABELS[entry.action] : AGENT_LABEL;
	}

	function formatTime(value: number) {
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(value);
	}
</script>

<!-- Opening is the toolbar's job, on the bar's right edge, mirroring the
     document list's toggle on the left. A floating pill here would be a second
     entry point in a third shape, covering the text it writes into. -->
{#if open}
	<aside
		transition:fly={{ x: 400, duration: 180 }}
		class="ai-panel fixed bottom-0 right-0 top-16 z-30 flex w-full flex-col border-l border-border bg-background shadow-[-8px_0_30px_-12px_rgba(0,0,0,0.25)] sm:w-[var(--ai-panel-width)]"
		aria-label="AI assistant"
	>
		<div class="flex items-center justify-between border-b border-border px-3 py-2">
			<div class="flex items-center gap-2 text-sm font-medium">
				<Sparkles class="h-4 w-4" />
				AI assistant
			</div>
			<div class="flex items-center gap-1">
				{#if history.length > 0}
					<Button
						variant="ghost"
						class="h-7 w-7 px-0"
						aria-label="Clear AI history for this document"
						on:click={onClearHistory}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				{/if}
				<Button
					variant="ghost"
					class="h-7 w-7 px-0"
					aria-label="AI settings"
					on:click={onOpenSettings}
				>
					<Settings2 class="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					class="h-7 w-7 px-0"
					aria-label="Close AI assistant"
					on:click={onClose}
				>
					<PanelRightClose class="h-4 w-4" />
				</Button>
			</div>
		</div>

		{#if !hasApiKey}
			<div class="flex-1 overflow-y-auto p-3">
				<div class="grid gap-2">
					<Label for="ai-panel-key">OpenAI API key</Label>
					<p class="text-xs text-muted-foreground">
						Stored only in this browser and sent directly to OpenAI.
					</p>
					<div class="flex gap-2">
						<Input
							id="ai-panel-key"
							type="password"
							placeholder="sk-..."
							class="flex-1"
							bind:value={apiKey}
							on:keydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									onSaveKey();
								}
							}}
						/>
						<Button class="h-10 px-4" disabled={!apiKey.trim()} on:click={onSaveKey}>Save</Button>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex min-h-0 flex-1 flex-col">
				<!-- History for the open document, oldest first -->
				<div class="min-h-0 flex-1 overflow-y-auto p-3">
					{#if history.length === 0 && !hasLiveRun}
						<p class="py-6 text-center text-xs text-muted-foreground">
							No AI history for this document yet.
						</p>
					{/if}

					<div class="grid gap-3">
						{#each history as entry (entry.id)}
							<article class="grid gap-1.5 border-b border-border pb-3">
								<div class="flex items-center justify-between gap-2">
									<span class="flex items-center gap-1.5 text-xs">
										<span class="rounded bg-secondary px-1.5 py-0.5 font-medium">
											{entryBadge(entry)}
										</span>
										<span class="text-muted-foreground">{formatTime(entry.createdAt)}</span>
									</span>
									<button
										type="button"
										class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
										aria-label="Delete this history entry"
										on:click={() => onDeleteHistoryEntry(entry.id)}
									>
										<X class="h-3.5 w-3.5" />
									</button>
								</div>

								<!-- Most action entries carry no instruction, and the badge above
								     already names them; repeating it here read as a stutter. -->
								{#if entry.prompt.trim()}
									<p class="whitespace-pre-wrap text-sm">{entry.prompt}</p>
								{/if}

								{#if entry.selection}
									<div
										class="max-h-16 overflow-y-auto rounded-md border border-border bg-secondary/50 p-2 text-xs text-muted-foreground"
									>
										{entry.selection}
									</div>
								{/if}

								{#if entry.steps && entry.steps.length > 0}
									<ol class="grid gap-1">
										{#each entry.steps as step, index (`${entry.id}-${index}`)}
											<li class="flex items-start gap-2 text-xs">
												{#if step.status === 'denied'}
													<Ban class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												{:else if isFailedStatus(step.status, !step.error)}
													<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
												{:else}
													<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
												{/if}
												<span class="min-w-0">
													<span class={step.error ? 'text-muted-foreground' : ''}>
														{step.description}
													</span>
													{#if step.error}
														<span class="block text-destructive">{step.error}</span>
													{/if}
												</span>
											</li>
										{/each}
									</ol>
								{/if}

								{#if entry.response}
									<div
										class="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-2 text-sm"
									>
										{entry.response}
									</div>
									{#if entry.action}
										<div class="flex flex-wrap justify-end gap-2">
											{#if entry.selection && entry.selection === selection}
												<Button
													variant="outline"
													class="h-7 px-3"
													on:click={() => onReplaceSelection(entry.response, entry.selection ?? '')}
												>
													Replace selection
												</Button>
											{/if}
											<Button class="h-7 px-3" on:click={() => onInsertAtCursor(entry.response)}>
												Insert at cursor
											</Button>
										</div>
									{/if}
								{/if}

								{#if entry.error}
									<span class="text-xs text-destructive">{entry.error}</span>
								{/if}
							</article>
						{/each}

						{#if hasLiveRun}
							<article class="grid gap-1.5">
								<span class="flex items-center gap-1.5 text-xs">
									<span class="rounded bg-secondary px-1.5 py-0.5 font-medium">
										{runAction ? ACTION_LABELS[runAction] : AGENT_LABEL}
									</span>
									<span class="text-muted-foreground">now</span>
								</span>

								{#if runPrompt.trim()}
									<p class="whitespace-pre-wrap text-sm">{runPrompt}</p>
								{/if}

								{#if steps.length > 0}
									<ol class="grid gap-1">
										{#each steps as step, index (`${step.callId}-${index}`)}
											<li class="flex items-start gap-2 text-xs">
												{#if step.status === 'denied'}
													<Ban class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												{:else if stepFailed(step)}
													<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
												{:else}
													<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
												{/if}
												<span class="min-w-0">
													<span class={stepFailed(step) ? 'text-muted-foreground' : ''}>
														{step.description}
													</span>
													{#if !step.result.ok}
														<span class="block text-destructive">{step.result.error}</span>
													{/if}
												</span>
											</li>
										{/each}
									</ol>
								{/if}

								{#if agentText}
									<div class="whitespace-pre-wrap rounded-md border border-border p-2 text-sm">
										{agentText}
									</div>
								{/if}
							</article>
						{/if}
					</div>

					<div bind:this={historyEnd}></div>
				</div>

				<!-- Composer. There is no mode to pick first: the buttons are shortcuts
				     for what the selection makes obvious, and anything else is typed. -->
				<div class="grid gap-3 border-t border-border p-3">
					<p class="text-xs text-muted-foreground">
						{selection
							? 'Changes are written straight into the document — undo with ⌘Z.'
							: 'Describe what to write or change. Edits go straight into the document — undo with ⌘Z. Creating or rewriting a whole document asks first.'}
					</p>

					{#if selection}
						<div class="grid gap-2">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium text-muted-foreground">Selected text</span>
								<button
									type="button"
									class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
									aria-label="Clear selection"
									on:click={onClearSelection}
								>
									<X class="h-3.5 w-3.5" />
								</button>
							</div>
							<div
								class="max-h-20 overflow-y-auto rounded-md border border-border bg-secondary/50 p-2 text-xs text-muted-foreground"
							>
								{selection}
							</div>
							<div class="flex flex-wrap gap-2">
								<Button
									variant="secondary"
									class="h-8 px-3"
									disabled={busy}
									on:click={() => onAction('rewrite')}>Rewrite</Button
								>
								<Button
									variant="secondary"
									class="h-8 px-3"
									disabled={busy}
									on:click={() => onAction('summarize')}>Summarize</Button
								>
								<Button
									variant="secondary"
									class="h-8 px-3"
									disabled={busy}
									on:click={() => onAction('proofread')}>Proofread</Button
								>
							</div>
						</div>
					{:else}
						<div class="flex flex-wrap gap-2">
							<Button
								variant="secondary"
								class="h-8 px-3"
								disabled={busy}
								on:click={() => onAction('continue')}>Continue writing</Button
							>
						</div>
					{/if}

					{#if pendingApproval}
						<div class="grid gap-2 rounded-md border border-primary bg-secondary/50 p-2">
							<span class="text-xs font-medium">Approve this change?</span>
							<span class="text-xs text-muted-foreground">{pendingApproval.description}</span>
							{#if pendingApproval.preview}
								<div
									class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-xs"
								>
									{pendingApproval.preview}
								</div>
							{/if}
							<div class="flex justify-end gap-2">
								<Button variant="outline" class="h-7 px-3" on:click={() => onApproval(false)}
									>Reject</Button
								>
								<Button class="h-7 px-3" on:click={() => onApproval(true)}>Approve</Button>
							</div>
						</div>
					{/if}

					{#if busy}
						<div class="flex items-center justify-between gap-2 text-sm text-muted-foreground">
							<span class="flex items-center gap-2">
								<Loader2 class="h-4 w-4 animate-spin" />
								{pendingApproval ? 'Waiting for approval...' : 'Working...'}
							</span>
							<Button variant="secondary" class="h-8 px-3" on:click={onCancel}>Cancel</Button>
						</div>
					{/if}

					{#if error}
						<div class="text-sm text-destructive">{error}</div>
					{/if}

					{#if canContinue && !busy}
						<div
							class="flex items-center justify-between gap-2 rounded-md border border-border p-2"
						>
							<span class="text-xs text-muted-foreground">
								{continueReason === 'stalled'
									? 'Stopped: the agent kept repeating itself.'
									: 'Stopped at the step limit.'}
							</span>
							<Button variant="secondary" class="h-7 px-3" on:click={onContinue}>Continue</Button>
						</div>
					{/if}

					<div class="grid gap-2">
						<textarea
							id="ai-panel-prompt"
							rows="3"
							placeholder={selection
								? 'How should the selection be changed?'
								: 'Draft, rewrite, or reorganize...'}
							class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							bind:value={prompt}
							on:keydown={handlePromptKeydown}
						></textarea>
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
							<Button class="h-8 px-4" disabled={busy || !prompt.trim()} on:click={send}>
								Send
							</Button>
						</div>
						<label class="flex items-center gap-2 text-xs text-muted-foreground">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 rounded border-input"
								bind:checked={autoApprove}
							/>
							Create and rewrite documents without asking, for this session
						</label>
						{#if !selection}
							<label class="flex items-center gap-2 text-xs text-muted-foreground">
								<input
									type="checkbox"
									class="h-3.5 w-3.5 rounded border-input"
									bind:checked={allowDocumentWideEdits}
								/>
								Allow full-document replacements for this request
							</label>
						{/if}
						{#if canContinue && continueDocumentWideEdits}
							<span class="text-xs text-muted-foreground">
								The stopped run was allowed full-document replacements; Continue resumes it with
								that permission.
							</span>
						{/if}
						{#if autoApprove}
							<span class="flex items-start gap-1.5 text-xs text-destructive">
								<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
								Whole documents will be created and replaced without asking. Check the step list to see
								what changed.
							</span>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</aside>
{/if}
