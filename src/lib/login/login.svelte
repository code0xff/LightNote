<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@/lib/components/ui/button';
	import * as Card from '@/lib/components/ui/card';
	import { Input } from '@/lib/components/ui/input';
	import { Toaster } from '@/lib/components/ui/sonner';

	let ws: string;
	let id: string;
</script>

<div class="flex justify-center p-2 md:h-screen">
	<Card.Root class="w-full border-none md:m-auto md:w-[480px]">
		<Card.Header>
			<Card.Title>Note</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-col">
				<Input id="websocket" placeholder="Please insert websocket" bind:value={ws} />
				<Input class="mt-1" id="id" placeholder="Please insert collaboration id" bind:value={id} />
			</div>
		</Card.Content>
		<Card.Footer class="flex flex-col">
			<Button class="w-full" on:click={() => goto(`/collaboration/${id}/ws/${ws}`)}
				>Collaboration</Button
			>
			<Button class="mt-1 w-full" variant="secondary" on:click={() => goto('/standalone')}
				>Standalone</Button
			>
		</Card.Footer>
	</Card.Root>
	<Toaster />
</div>

<style>
</style>
