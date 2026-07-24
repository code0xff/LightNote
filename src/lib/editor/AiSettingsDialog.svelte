<script lang="ts">
	import { Button } from '@/lib/components/ui/button';
	import * as Dialog from '@/lib/components/ui/dialog';
	import { Label } from '@/lib/components/ui/label';
	import { Input } from '@/lib/components/ui/input';
	import { resolveModelOptions } from '$lib/ai/openai';

	export let open = false;
	export let apiKey = '';
	export let model = '';
	export let onSave: () => void;
</script>

<Dialog.Root bind:open closeOnOutsideClick={false}>
	<Dialog.Content class="sm:max-w-[425px]">
		<Dialog.Header>
			<Dialog.Title>AI settings</Dialog.Title>
			<Dialog.Description>
				Enter your OpenAI API key. It is stored only in this browser and sent directly to OpenAI.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="openai-key" class="text-left">API key</Label>
				<Input
					id="openai-key"
					type="password"
					placeholder="sk-..."
					class="col-span-3"
					bind:value={apiKey}
					on:keydown={(e) => {
						if (e.code === 'Enter') {
							e.preventDefault();
							onSave();
						}
					}}
				/>
			</div>
			<div class="grid grid-cols-4 items-center gap-4">
				<Label for="openai-model" class="text-left">Model</Label>
				<select
					id="openai-model"
					class="col-span-3 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					bind:value={model}
				>
					{#each resolveModelOptions(model) as modelOption}
						<option value={modelOption}>{modelOption}</option>
					{/each}
				</select>
			</div>
		</div>
		<Dialog.Footer>
			<Button class="w-full" variant="outline" on:click={onSave}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
