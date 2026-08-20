<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';
	import * as Popover from '@/lib/components/ui/popover';
	import { buttonVariants } from '@/lib/components/ui/button';
	import { activeMenuItem, type ToolbarItem, type ToolbarMenu } from './toolbar';

	export let menu: ToolbarMenu;

	let open = false;

	// The trigger shows the active choice where there is one, so a menu that
	// hides mutually exclusive options (block style, alignment) still says which
	// one is on without being opened.
	$: current = menu.reflectActive ? activeMenuItem(menu.items) : undefined;
	$: triggerIcon = current?.icon ?? menu.icon;
	$: caption = menu.caption === undefined ? undefined : current?.label ?? menu.caption;

	function run(item: ToolbarItem) {
		open = false;
		item.onClick();
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={buttonVariants({
			variant: 'secondary',
			className: 'h-8 gap-1 px-2'
		})}
		aria-label={menu.label}
	>
		<svelte:component this={triggerIcon} class="h-4 w-4" />
		{#if caption}
			<span class="max-w-24 truncate text-xs font-normal">{caption}</span>
		{/if}
		<ChevronDown class="h-3 w-3 opacity-60" />
	</Popover.Trigger>
	<Popover.Content align="start" class="w-56 p-1">
		<div class="grid gap-0.5">
			{#each menu.items as item (item.key)}
				<button
					type="button"
					class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-50 {item.active
						? 'bg-secondary font-medium'
						: 'hover:bg-secondary'}"
					disabled={item.disabled}
					aria-label={item.label}
					on:click={() => run(item)}
				>
					<svelte:component this={item.icon} class="h-4 w-4 shrink-0" />
					<span class="truncate">{item.label}</span>
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
