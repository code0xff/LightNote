<script lang="ts">
	import Editor from '@/lib/editor/editor.svelte';

	export let data: { ws: string; id: string };
</script>

<main>
	<Editor ws={data.ws} id={data.id} />
</main>
