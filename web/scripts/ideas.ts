// Opening-idea explanations, one opening family at a time across every player (docs/opening-ideas-pipeline.md).
//   prep  <family> [names] data/ideas/<family>/input.json (names: the opening families it groups, "Pirc Defense" "Modern
//                          Defense"; default the family itself): the family's cards from every player (run export-cards.ts
//                          and alternatives.ts first), with their club alternatives and current explanation, grouped
//                          into writer batches of whole variations
//   check <family> <file>  checks written explanations ({ "<card id>": Explanation }) with the common moves; also
//                          opens every source URL. Prints problems and advice; exits 1 if any card fails
//   merge <family> <file>  the same, then adds the cards that pass to static/explanations.json
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkExplanation, linkWarnings, sourceLink, type AlternativeLine, type ExportCard, type Explanation } from '../src/lib/explain/check';
import { PRINCIPLES } from '../src/lib/explain/principles';
import { root } from './harness';

/** Cards per writer: whole variations are kept together, and a variation bigger than this gets its own writer. */
const BATCH = 12;
const FIELDS = ['headline', 'why', 'principle', 'principleId', 'themes', 'sources', 'ideas', 'habit', 'taught', 'alternatives'] as const;

const [command, family, ...rest] = process.argv.slice(2);
const file = rest[0];
if (!command || !family) {
	console.error('usage: ideas.ts prep|check|merge <family> [file]');
	process.exit(1);
}
const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dir = new URL(`data/ideas/${slug}/`, root);
const store = new URL('../static/explanations.json', import.meta.url);
const read = <T>(url: URL, fallback: T): T => (existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as T) : fallback);
/** The opening families this group covers: given to prep, then read back from its input.json. */
const names: string[] = command === 'prep' ? (rest.length ? rest : [family]) : (read<{ families?: string[] }>(new URL('input.json', dir), {}).families ?? [family]);
const inFamily = (opening?: string) => names.some((n) => (opening ?? '').split(':')[0].toLowerCase().startsWith(n.toLowerCase()));

// Every player's cards and alternatives; a card (position + habit) shared by players is one card.
const users = readdirSync(new URL('data/', root)).filter((u) => existsSync(new URL(`data/${u}/cards.json`, root)));
const cards = new Map<string, { card: ExportCard; players: string[]; alternatives: (AlternativeLine & Record<string, unknown>)[] }>();
/** Cards alternatives.ts has looked at (some have no other common moves). */
const analysed = new Set<string>();
for (const user of users) {
	const own = read<{ cards: ExportCard[] }>(new URL(`data/${user}/cards.json`, root), { cards: [] }).cards;
	const alts = new Map(read<{ id: string; alternatives: AlternativeLine[] }[]>(new URL(`data/${user}/alternatives.json`, root), []).map((a) => [a.id, a.alternatives]));
	for (const id of alts.keys()) analysed.add(id);
	for (const card of own.filter((c) => inFamily(c.opening))) {
		const known = cards.get(card.id);
		if (known) known.players.push(user);
		else cards.set(card.id, { card, players: [user], alternatives: (alts.get(card.id) ?? []) as (AlternativeLine & Record<string, unknown>)[] });
		if (known && !known.alternatives.length) known.alternatives = (alts.get(card.id) ?? []) as (AlternativeLine & Record<string, unknown>)[];
	}
}
const explanations = read<Record<string, Explanation>>(store, {});

if (command === 'prep') {
	mkdirSync(dir, { recursive: true });
	const missing = [...cards.keys()].filter((id) => !analysed.has(id));
	// Variations, biggest first, packed into writer batches without splitting a variation unless it alone is too big.
	const byVariation = new Map<string, string[]>();
	for (const { card } of cards.values()) byVariation.set(card.opening ?? '?', [...(byVariation.get(card.opening ?? '?') ?? []), card.id]);
	const batches: { name: string; ids: string[] }[] = [];
	for (const [name, ids] of [...byVariation].sort((a, b) => b[1].length - a[1].length)) {
		for (let i = 0; i < ids.length; i += BATCH) {
			const chunk = ids.slice(i, i + BATCH);
			const open = batches.find((b) => b.ids.length + chunk.length <= BATCH);
			if (open && chunk.length < BATCH) (open.name += `; ${name}`), open.ids.push(...chunk);
			else batches.push({ name, ids: chunk });
		}
	}
	const input = {
		family,
		families: names,
		principles: PRINCIPLES,
		variations: Object.fromEntries(byVariation),
		batches,
		cards: [...cards.values()].map(({ card: { check: _check, ...card }, players, alternatives }) => ({
			card,
			players,
			alternatives: alternatives.map(({ lineUcis: _l, ...a }) => a),
			current: explanations[card.id] ?? null
		}))
	};
	writeFileSync(new URL('input.json', dir), JSON.stringify(input, null, '\t'));
	console.log(`${cards.size} cards in ${byVariation.size} variations, ${batches.length} writer batches -> ${new URL('input.json', dir).pathname}`);
	for (const [i, b] of batches.entries()) console.log(`  batch ${i + 1}: ${b.ids.length} cards · ${b.name}`);
	if (missing.length) console.log(`no club alternatives yet for ${missing.length} cards: run alternatives.ts for their players`);
} else if (command === 'check' || command === 'merge') {
	if (!file) throw new Error('give the file with the written explanations');
	const answers = read<Record<string, unknown>>(new URL(file, `file://${process.cwd()}/`), {});
	const urls = new Map<string, Promise<string | null>>();
	const open = (url: string) => {
		if (!urls.has(url))
			urls.set(
				url,
				fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 (chess-trainer source check)' } })
					.then((r) => (r.ok || r.status === 403 || r.status === 429 ? null : `HTTP ${r.status}`))
					.catch((e) => String(e.cause?.code ?? e.name ?? e))
			);
		return urls.get(url)!;
	};
	let passed = 0;
	let failed = 0;
	for (const [id, answer] of Object.entries(answers)) {
		const entry = cards.get(id);
		const problems = entry ? checkExplanation(entry.card, answer, entry.alternatives) : ['not a card of this family'];
		const sources = ((answer as Explanation).sources ?? []).map(sourceLink).filter((s) => s.url);
		for (const s of sources) {
			const bad = await open(s.url!);
			if (bad) problems.push(`source ${s.url} doesn't open (${bad})`);
		}
		const advice = linkWarnings(answer);
		if (problems.length) {
			failed++;
			console.log(`✗ ${id}${entry ? ` (${entry.card.moves} ${entry.card.habit.move})` : ''}\n  - ${problems.join('\n  - ')}`);
		} else {
			passed++;
			if (command === 'merge') {
				const a = answer as Record<string, unknown>;
				explanations[id] = Object.fromEntries(FIELDS.filter((f) => a[f] !== undefined).map((f) => [f, a[f]])) as unknown as Explanation;
			}
		}
		if (advice.length) console.log(`  advice for ${id}:\n  · ${advice.join('\n  · ')}`);
	}
	console.log(`passed ${passed}, failed ${failed}`);
	if (command === 'merge') {
		const sorted = Object.fromEntries(Object.entries(explanations).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(store, JSON.stringify(sorted, null, '\t') + '\n');
		console.log(`${Object.keys(sorted).length} explanations in static/explanations.json`);
	}
	process.exit(failed ? 1 : 0);
} else {
	console.error('usage: ideas.ts prep|check|merge <family> [file]');
	process.exit(1);
}
