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
		X
	} from 'lucide-svelte';
	import { Button } from '@/lib/components/ui/button';
	import { Input } from '@/lib/components/ui/input';
	import { Label } from '@/lib/components/ui/label';
	import type { AiAction } from '$lib/ai/openai';
	import type { AgentStep } from '$lib/ai/agent';

	export let open = false;
	export let hasApiKey = false;
	export let apiKey = '';
	export let selection = '';
	export let prompt = '';
	export let result = '';
	export let error = '';
	export let busy = false;
	export let mode: 'ask' | 'agent' = 'ask';
	export let steps: AgentStep[] = [];
	export let agentText = '';
	export let autoApprove = false;
	export let pendingApproval: { description: string; preview?: string } | null = null;
	export let onOpen: () => void;
	export let onClose: () => void;
	export let onSaveKey: () => void;
	export let onAction: (action: AiAction) => void;
	export let onRunAgent: () => void;
	export let onApproval: (approved: boolean) => void;
	export let onCancel: () => void;
	export let onReplaceSelection: () => void;
	export let onInsertAtCursor: () => void;
	export let onClearSelection: () => void;
	export let onOpenSettings: () => void;

	function send() {
		if (busy || !prompt.trim()) {
			return;
		}

		if (mode === 'agent') {
			onRunAgent();
		} else {
			onAction('prompt');
		}
	}

	function handlePromptKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			send();
		}
	}

	function stepFailed(step: AgentStep) {
		return step.status !== 'done' || !step.result.ok;
	}
</script>

{#if !open}
	<div class="fixed bottom-4 right-4 z-30">
		<Button
			class="h-10 gap-2 rounded-full px-4 shadow-lg"
			aria-label="Open AI assistant"
			on:click={onOpen}
		>
			<Sparkles class="h-4 w-4" />
			<span class="text-sm font-medium">Ask AI</span>
		</Button>
	</div>
{:else}
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

		<div class="flex-1 overflow-y-auto p-3">
			{#if !hasApiKey}
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
			{:else}
				<div class="grid gap-3">
					<div class="flex rounded-md border border-border p-0.5" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={mode === 'ask'}
							class="flex-1 rounded px-2 py-1 text-xs font-medium transition-colors {mode === 'ask'
								? 'bg-secondary text-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
							on:click={() => (mode = 'ask')}
						>
							Ask
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={mode === 'agent'}
							class="flex-1 rounded px-2 py-1 text-xs font-medium transition-colors {mode ===
							'agent'
								? 'bg-secondary text-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
							on:click={() => (mode = 'agent')}
						>
							Agent
						</button>
					</div>

					{#if mode === 'agent'}
						<p class="text-xs text-muted-foreground">
							The agent can read your documents and, with your approval, create or edit them.
						</p>
					{/if}

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
								class="max-h-24 overflow-y-auto rounded-md border border-border bg-secondary/50 p-2 text-xs text-muted-foreground"
							>
								{selection}
							</div>
							{#if mode === 'ask'}
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
							{/if}
						</div>
					{:else if mode === 'ask'}
						<div class="flex flex-wrap gap-2">
							<Button
								variant="secondary"
								class="h-8 px-3"
								disabled={busy}
								on:click={() => onAction('continue')}>Continue writing</Button
							>
						</div>
					{/if}

					<div class="grid gap-2">
						<textarea
							id="ai-panel-prompt"
							rows="3"
							placeholder={mode === 'agent'
								? 'Ask the agent to draft, rewrite, or reorganize documents...'
								: selection
									? 'How should the selection be changed?'
									: 'Describe what to write...'}
							class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							bind:value={prompt}
							on:keydown={handlePromptKeydown}
						></textarea>
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
							<Button class="h-8 px-4" disabled={busy || !prompt.trim()} on:click={send}>
								{mode === 'agent' ? 'Run' : 'Send'}
							</Button>
						</div>
						{#if mode === 'agent'}
							<label class="flex items-center gap-2 text-xs text-muted-foreground">
								<input
									type="checkbox"
									class="h-3.5 w-3.5 rounded border-input"
									bind:checked={autoApprove}
								/>
								Approve changes automatically for this session
							</label>
							{#if autoApprove}
								<span class="flex items-start gap-1.5 text-xs text-destructive">
									<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
									Edits will be applied without asking. Check the step list to see what changed.
								</span>
							{/if}
						{/if}
					</div>

					{#if steps.length > 0}
						<div class="grid gap-1.5">
							<span class="text-xs font-medium text-muted-foreground">Steps</span>
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
											<span class={stepFailed(step) ? 'text-muted-foreground' : ''}
												>{step.description}</span
											>
											{#if !step.result.ok}
												<span class="block text-destructive">{step.result.error}</span>
											{/if}
										</span>
									</li>
								{/each}
							</ol>
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
								{pendingApproval
									? 'Waiting for approval...'
									: mode === 'agent'
										? 'Working...'
										: 'Generating...'}
							</span>
							<Button variant="secondary" class="h-8 px-3" on:click={onCancel}>Cancel</Button>
						</div>
					{/if}

					{#if error}
						<div class="text-sm text-destructive">{error}</div>
					{/if}

					{#if agentText}
						<div class="grid gap-2">
							<span class="text-xs font-medium text-muted-foreground">Agent</span>
							<div class="whitespace-pre-wrap rounded-md border border-border p-2 text-sm">
								{agentText}
							</div>
						</div>
					{/if}

					{#if result}
						<div class="grid gap-2">
							<span class="text-xs font-medium text-muted-foreground">Result</span>
							<div
								class="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-2 text-sm"
							>
								{result}
							</div>
							<div class="flex flex-wrap justify-end gap-2">
								{#if selection}
									<Button variant="outline" class="h-8 px-3" on:click={onReplaceSelection}
										>Replace selection</Button
									>
								{/if}
								<Button class="h-8 px-3" on:click={onInsertAtCursor}>Insert at cursor</Button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</aside>
{/if}
