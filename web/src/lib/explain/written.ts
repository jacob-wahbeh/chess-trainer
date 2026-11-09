// Explanations written ahead of time (static/explanations.json, see scripts/explanations.ts), fetched once.
import type { Explanation } from './check';

type Written = Record<string, Explanation>;
let loading: Promise<Written> | undefined;

/** Keyed `${position key}|${habit}`; empty when the file is missing, or offline before it was ever cached. */
export function writtenExplanations(): Promise<Written> {
	loading ??= fetch('/explanations.json')
		.then((r): Promise<Written> | Written => (r.ok ? r.json() : {}))
		.catch((): Written => ({}));
	return loading;
}
