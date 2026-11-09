import { base } from '$app/paths';
import * as Comlink from 'comlink';
import type { DataApi } from './data.worker';

let remote: Comlink.Remote<DataApi> | undefined;

/** The data worker, started on first use. */
export function data(): Comlink.Remote<DataApi> {
	if (!remote) {
		remote = Comlink.wrap<DataApi>(new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' }));
		// Sent first, so the worker fetches its files from the right place.
		void remote.setBase(base);
	}
	return remote;
}

export const proxy = Comlink.proxy;
