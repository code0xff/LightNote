<script>
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '@/lib/components/ui/sonner';
	import '../app.pcss';
</script>

<ModeWatcher />
<Toaster />
<slot />
