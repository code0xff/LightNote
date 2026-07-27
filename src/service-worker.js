import { build, files, prerendered, version } from '$service-worker';
import { precacheAndRoute } from 'workbox-precaching';

const precache_list = [...build, ...files, ...prerendered].map((s) => ({
	url: s,
	revision: version
}));

precacheAndRoute(precache_list);

/**
 * Take over as soon as a new build is precached, instead of waiting for every tab
 * to close. The IndexedDB schema is versioned with the app: once one tab has
 * upgraded the database, a tab still served the previous build from cache cannot
 * open it (see `DB_OUTDATED_MESSAGE` in `documents/store.ts`). Claiming
 * immediately means reloading that tab is enough to recover, instead of reloading
 * back into the same stale build.
 *
 * Trade-off: activation drops the previous build's precached chunks, so a tab
 * left open on it can fail a dynamic import. Both such imports are on the
 * sharing path (`editor.svelte` loads `@hocuspocus/provider` and `./sharing`),
 * and they run inside a try/catch that alerts and then reloads — so that tab
 * lands on the new build instead of staying broken. Normal editing needs no
 * further chunks. Without claiming, the opposite failure is worse and more
 * likely: a tab whose database was already upgraded by another tab keeps being
 * served the old build on every reload, so it cannot recover at all until every
 * tab is closed.
 */
self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});
