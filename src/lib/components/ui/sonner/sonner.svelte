<script lang="ts">
	import { Toaster as Sonner } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
</script>

<!--
	Configured here rather than at the call site: there is one Toaster for the
	whole app, and `toast(...)` reaches it from anywhere. Top right, clear of both
	side panels' controls and of the text column. `mode` is undefined until
	mode-watcher has read the preference, and `system` is the honest answer for
	that moment. `closeButton`, because a toast may carry something that has to
	stay until it is read (see the database notice in `editor.svelte`).
-->
<Sonner
	theme={$mode ?? 'system'}
	position="top-right"
	closeButton
	class="toaster group"
	toastOptions={{
		classes: {
			toast:
				'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
			description: 'group-[.toast]:text-muted-foreground',
			actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
			cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
		}
	}}
/>
