import { open, waitFor, waitStable } from './nav.mjs';
import { measureState } from './measure.mjs';
await open('/');
await waitFor(`document.querySelector('.drill-cta')`, 30000);
console.log('stable', await waitStable(3000, 40000));
const r = await measureState('home', { full: true });
for (const t of r.targets) console.log(JSON.stringify([t.label, t.x, t.y, t.w, t.h, t.nearest, t.nearestGap, t.hit]));
console.log('page targets', r.page?.targets.length, 'marks', JSON.stringify(r.marks));
