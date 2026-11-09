// Bookkeeping for written explanations (the /explain-cards Claude Code command):
//   todo  [user] [count]  writes data/<user>/explain-todo.json: the costliest exported cards that have no
//                         explanation yet (run export-cards.ts first)
//   merge [user] [file]   checks written explanations ({ "<card id>": { headline, why, principle, themes } },
//                         default data/<user>/explain-answers.json) and adds those that pass to
//                         static/explanations.json; prints what's wrong with the rest and exits 1 if any failed
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkExplanation, type ExportCard, type Explanation } from '../src/lib/explain/check';
import { PRINCIPLES } from '../src/lib/explain/principles';
import { root } from './harness';

const [command, user = 'draco_jaco', arg] = process.argv.slice(2);
const data = (name: string) => new URL(`data/${user}/${name}`, root);
const store = new URL('../static/explanations.json', import.meta.url);
const read = <T>(url: URL, fallback: T): T => (existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as T) : fallback);

if (!existsSync(data('cards.json'))) {
	console.error(`No ${data('cards.json').pathname}: run npm run cards:export first.`);
	process.exit(1);
}
const { cards, generated } = read<{ cards: ExportCard[]; generated: string }>(data('cards.json'), { cards: [], generated: '' });
const explanations = read<Record<string, Explanation>>(store, {});

if (command === 'todo') {
	const count = Number(arg ?? 20);
	const todo = cards
		.filter((c) => !explanations[c.id])
		.slice(0, count)
		.map(({ check: _check, ...card }) => card);
	writeFileSync(data('explain-todo.json'), JSON.stringify({ principles: PRINCIPLES, cards: todo }, null, '\t'));
	const done = cards.filter((c) => explanations[c.id]).length;
	console.log(`${done} of ${cards.length} cards explained (export from ${generated}).`);
	console.log(`${todo.length} to write -> ${data('explain-todo.json').pathname}`);
	console.log(`Answers go in ${data('explain-answers.json').pathname}, then: npm run explain:merge`);
} else if (command === 'merge') {
	const file = arg ? new URL(arg, `file://${process.cwd()}/`) : data('explain-answers.json');
	const answers = read<Record<string, unknown>>(file, {});
	const byId = new Map(cards.map((c) => [c.id, c]));
	let added = 0;
	let failed = 0;
	for (const [id, answer] of Object.entries(answers)) {
		const card = byId.get(id);
		const problems = card ? checkExplanation(card, answer) : ['no exported card has this id'];
		if (problems.length) {
			failed++;
			console.log(`✗ ${id}${card ? ` (${card.moves} ${card.habit.move})` : ''}\n  - ${problems.join('\n  - ')}`);
			continue;
		}
		const { headline, why, principle, principleId, themes, sources } = answer as Explanation;
		explanations[id] = { headline, why, principle, principleId, ...(themes?.length ? { themes } : {}), ...(sources?.length ? { sources } : {}) };
		added++;
	}
	const sorted = Object.fromEntries(Object.entries(explanations).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(store, JSON.stringify(sorted, null, '\t') + '\n');
	console.log(`added ${added}, rejected ${failed}; ${Object.keys(sorted).length} explanations in static/explanations.json`);
	if (failed) process.exit(1);
} else {
	console.error('usage: explanations.ts todo|merge [user] [count|file]');
	process.exit(1);
}
