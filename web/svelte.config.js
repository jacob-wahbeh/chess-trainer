import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// Single-page app: every route falls back to the client-rendered shell.
		adapter: adapter({ fallback: 'index.html' })
	}
};
