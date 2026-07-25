<script lang="ts">
	import { slide } from 'svelte/transition';
	import { ChevronDown, Loader2, Settings2, Sparkles, X } from 'lucide-svelte';
	import { Button } from '@/lib/components/ui/button';
	import { Input } from '@/lib/components/ui/input';
	import { Label } from '@/lib/components/ui/label';
	import type { AiAction } from '$lib/ai/openai';

	export let open = false;
	export let hasApiKey = false;
	export let apiKey = '';
	export let selection = '';
	export let prompt = '';
	export let result = '';
	export let error = '';
	export let busy = false;
	export let onOpen: () => void;
	export let onClose: () => void;
	export let onSaveKey: () => void;
	export let onAction: (action: AiAction) => void;
	export let onCancel: () => void;
	export let onReplaceSelection: () => void;
	export let onInsertAtCursor: () => void;
	export let onClearSelection: () => void;
	export let onOpenSettings: () => void;

	function handlePromptKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			if (!busy && prompt.trim()) {
				onAction('prompt');
			}
		}
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
	<div class="fixed bottom-0 left-0 z-30 w-full lg:left-72 lg:w-[calc(100%-18rem)]">
		<div class="mx-auto w-full max-w-[720px] px-3 pb-3">
			<div
				transition:slide={{ duration: 150 }}
				class="rounded-t-xl border border-b-0 border-border bg-background shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.25)]"
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
							aria-label="Collapse AI assistant"
							on:click={onClose}
						>
							<ChevronDown class="h-4 w-4" />
						</Button>
					</div>
				</div>

				<div class="max-h-[60vh] overflow-y-auto p-3">
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
								<Button class="h-10 px-4" disabled={!apiKey.trim()} on:click={onSaveKey}>
									Save
								</Button>
							</div>
						</div>
					{:else}
						<div class="grid gap-3">
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

							<div class="grid gap-2">
								<textarea
									id="ai-panel-prompt"
									rows="2"
									placeholder={selection
										? 'How should the selection be changed?'
										: 'Describe what to write...'}
									class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
									bind:value={prompt}
									on:keydown={handlePromptKeydown}
								></textarea>
								<div class="flex items-center justify-between">
									<span class="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
									<Button
										class="h-8 px-4"
										disabled={busy || !prompt.trim()}
										on:click={() => onAction('prompt')}
									>
										Send
									</Button>
								</div>
							</div>

							{#if busy}
								<div class="flex items-center justify-between text-sm text-muted-foreground">
									<span class="flex items-center gap-2">
										<Loader2 class="h-4 w-4 animate-spin" /> Generating...
									</span>
									<Button variant="secondary" class="h-8 px-3" on:click={onCancel}>Cancel</Button>
								</div>
							{/if}

							{#if error}
								<div class="text-sm text-destructive">{error}</div>
							{/if}

							{#if result}
								<div class="grid gap-2">
									<span class="text-xs font-medium text-muted-foreground">Result</span>
									<div
										class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-2 text-sm"
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
			</div>
		</div>
	</div>
{/if}
