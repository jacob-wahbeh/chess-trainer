import { js } from './wk.mjs';
import fs from 'node:fs';
const out = await js(`
  const s = await import('/src/lib/state.svelte.ts');
  const { data } = await import('/src/lib/worker/client.ts');
  const deck = await data().deck('need');
  const list = [];
  for (const id of deck.ids) {
    const d = await data().cardDetail(id);
    if (!d) continue;
    list.push({ id, color: d.card.color, main: d.main && d.main.uci, why: d.main && d.main.why, answers: d.answers.map(a => a.uci + ':' + (a.why || '') + (a.share ? ':' + Math.round(a.share * 100) + '%' : '')), wrong: d.card.wrong, wrongCount: d.wrongCount, plies: d.card.path.length, opening: d.opening, reached: d.reached, streak: d.card.streak });
  }
  return { same: s.app.ready, drill: JSON.parse(JSON.stringify(s.drill)), n: list.length, list };
`);
fs.writeFileSync('/tmp/ux-probe/cards.json', JSON.stringify(out, null, 1));
console.log('same', out.same, 'drill', JSON.stringify(out.drill), 'n', out.n);
for (const c of out.list) console.log(c.id.slice(-28).padEnd(30), c.color.padEnd(6), 'main', String(c.main).padEnd(6), String(c.why).padEnd(9), 'ans', c.answers.join(' ').padEnd(44), 'wrong', c.wrong, c.wrongCount + 'x', c.plies + 'pl', (c.opening || '').slice(0, 34));
