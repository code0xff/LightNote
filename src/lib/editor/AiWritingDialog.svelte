<script lang="ts">
	import { Loader2 } from 'lucide-svelte';
	import { Button } from '@/lib/components/ui/button';
	import * as Dialog from '@/lib/components/ui/dialog';
	import { Label } from '@/lib/components/ui/label';
	import type { AiAction } from '$lib/ai/openai';

	export let open = false;
	export let selection = '';
	export let prompt = '';
	export let result = '';
	export let error = '';
	export let busy = false;
	export let onAction: (action: AiAction) => void;
	export let onCancel: () => void;
	export let onReplaceSelection: () => void;
	export let onInsertAtCursor: () => void;
</script>

<Dialog.Root bind:open closeOnOutsideClick={false}>
	<Dialog.Content class="sm:max-w-[520px]">
		<Dialog.Header>
			<Dialog.Title>AI writing</Dialog.Title>
			<Dialog.Description>
				{selection
					? 'Transform the selected text or write a custom instruction.'
					: 'Continue writing from the cursor or describe what to generate.'}
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-2">
			{#if selection}
				<div
					class="max-h-24 overflow-y-auto rounded-md border border-border bg-secondary/50 p-2 text-xs text-muted-foreground"
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
				<Label for="ai-prompt">Prompt</Label>
				<textarea
					id="ai-prompt"
					rows="3"
					placeholder={selection
						? 'Optional: how should the selection be changed?'
						: 'Describe what to write...'}
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					bind:value={prompt}
				></textarea>
				<Button
					variant="secondary"
					class="h-8 w-full px-3"
					disabled={busy}
					on:click={() => onAction('prompt')}>Generate from prompt</Button
				>
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
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
