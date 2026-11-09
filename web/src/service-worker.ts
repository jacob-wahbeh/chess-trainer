/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Offline support and instant launches: the app shell, engine and opening names are cached per deploy.
// Chess.com and Lichess requests always go to the network.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `openings-${version}`;
/** '/' is the single-page shell (adapter-static's fallback), served for every route. */
const ASSETS = [...build, ...files, '/'];
const ASSET_SET = new Set(ASSETS);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (request.mode === 'navigate') {
				// Cached shell first for an instant launch; the network refreshes it for next time.
				const cached = await cache.match('/');
				const fresh = fetch(request)
					.then((res) => {
						if (res.ok) void cache.put('/', res.clone());
						return res;
					})
					.catch(() => undefined);
				return cached ?? (await fresh) ?? Response.error();
			}
			const cached = await cache.match(request);
			if (cached) return cached;
			const res = await fetch(request);
			if (res.ok && ASSET_SET.has(url.pathname)) void cache.put(request, res.clone());
			return res;
		})()
	);
});
