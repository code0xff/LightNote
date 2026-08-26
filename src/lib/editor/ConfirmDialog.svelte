<script lang="ts">
	import { Button } from '@/lib/components/ui/button';
	import * as Dialog from '@/lib/components/ui/dialog';

	/**
	 * The question being asked. Null while closed, so there is no open flag that
	 * can disagree with the content. `cancelLabel: null` leaves the dialog with
	 * one button — a notice to acknowledge rather than a decision to make.
	 */
	export let request: {
		title: string;
		description: string;
		confirmLabel: string;
		cancelLabel: string | null;
		destructive: boolean;
	} | null = null;
	export let onConfirm: () => void;
	export let onCancel: () => void;

	function handleOpenChange(open: boolean) {
		if (!open) {
			// Escape and the overlay mean "no". Answering here rather than only on
			// the Cancel button is what keeps the caller from waiting forever.
			onCancel();
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
			<Dialog.Footer class="gap-2 sm:gap-2">
				{#if request.cancelLabel}
					<Button class="w-full" variant="outline" on:click={onCancel}>
						{request.cancelLabel}
					</Button>
				{/if}
				<Button
					class="w-full"
					variant={request.destructive ? 'destructive' : 'default'}
					on:click={onConfirm}
				>
					{request.confirmLabel}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
