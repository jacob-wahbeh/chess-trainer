import * as Comlink from 'comlink';
import type { DataApi } from './data.worker';

let remote: Comlink.Remote<DataApi> | undefined;

/** The data worker, started on first use. */
export function data(): Comlink.Remote<DataApi> {
	return (remote ??= Comlink.wrap<DataApi>(
		new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' })
	));
}

export const proxy = Comlink.proxy;
