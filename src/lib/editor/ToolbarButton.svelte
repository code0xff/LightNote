<script lang="ts">
	import type { ComponentType } from 'svelte';
	import { Button } from '@/lib/components/ui/button';

	export let icon: ComponentType;
	export let label: string;
	export let active = false;
	export let disabled = false;
	let className = 'h-8 px-2';
	export { className as class };
</script>

<Button
	on:click
	{disabled}
	variant={active ? 'default' : 'secondary'}
	class={className}
	aria-label={label}
>
	<svelte:component this={icon} class="h-4 w-4" />
</Button>
