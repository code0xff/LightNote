<script lang="ts">
	import { Button } from '@/lib/components/ui/button';
	import * as Dialog from '@/lib/components/ui/dialog';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';

	/**
	 * What the dialog is asking for. Null while closed, so the caller has one
	 * piece of state rather than an open flag that can disagree with the content.
	 */
	export let request: {
		title: string;
		description: string;
		label: string;
		placeholder: string;
		submitLabel: string;
	} | null = null;
	export let value = '';
	export let error = '';
	export let onSubmit: () => void;
	export let onClose: () => void;

	function handleOpenChange(open: boolean) {
		if (!open) {
			onClose();
		}
	}
</script>

<Dialog.Root open={request !== null} onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[425px]">
		{#if request}
			<Dialog.Header>
				<Dialog.Title>{request.title}</Dialog.Title>
				<Dialog.Description>{request.description}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-2 py-4">
				<div class="grid grid-cols-4 items-center gap-4">
					<Label for="prompt-dialog-input" class="text-left">{request.label}</Label>
					<Input
						id="prompt-dialog-input"
						placeholder={request.placeholder}
						class="col-span-3"
						autocomplete="off"
						bind:value
						on:keydown={(e) => {
							if (e.code === 'Enter') {
								e.preventDefault();
								onSubmit();
							}
						}}
					/>
				</div>
				{#if error}
					<!-- Under the box that produced it, sharing its column. A rejected
					     value keeps the dialog open with the text still in it; the native
					     prompt closed on submit and the alert that followed had nothing
					     left to correct. This is why it is not a toast. -->
					<div class="grid grid-cols-4 gap-4">
						<p class="col-span-3 col-start-2 text-sm text-destructive">{error}</p>
					</div>
				{/if}
			</div>
			<Dialog.Footer>
				<Button class="w-full" variant="outline" on:click={onSubmit}>{request.submitLabel}</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
