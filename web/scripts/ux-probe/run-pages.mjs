import { js } from './wk.mjs';
import { open, waitFor, waitStable, sleep } from './nav.mjs';
import { measureState } from './measure.mjs';
const only = process.argv[2];
const want = (n) => !only || only === n;
if (want('home')) { await open('/'); await waitFor(`document.querySelector('.drill-cta')`); await waitStable(3000); await measureState('home', { full: true, note: 'Today tab' }); }
if (want('leaks')) { await open('/leaks'); await waitStable(3000, 40000); await measureState('leaks', { full: true, note: 'Mistakes tab' }); }
if (want('lines')) {
  await open('/lines'); await waitStable(3000, 40000); await measureState('lines', { full: true, note: 'Lines tab, collapsed' });
  await js(`document.querySelector('.fam-row')?.click(); return true;`); await sleep(600); await waitStable(1500);
  await measureState('lines-expanded', { full: true, note: 'Lines tab, first family expanded' });
}
if (want('explore')) { await open('/explore?c=white&m=e2e4,e7e5,g1f3,g8f6'); await waitFor(`document.querySelector('cg-board')`); await waitStable(3000, 40000); await measureState('explore', { full: true, note: 'Explore: 1.e4 e5 2.Nf3 Nf6 as white' }); }
if (want('settings')) { await open('/settings'); await waitStable(3000, 30000); await measureState('settings', { full: true, note: 'Settings tab' }); }
