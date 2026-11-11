// Data preparation in the WebKit harness: the setup link saves draco_jaco + a 3-month period and starts the
// Chess.com import; the app then analyses in the page and creates cards. Polls the app's own state module.
import fs from 'node:fs';
import { js, load, sleep } from './wk.mjs';

const BASE = 'http://localhost:5174';
const MAX_MS = 25 * 60_000;
const LOG = '/tmp/ux-probe/prep.log';
const log = (s) => {
	const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`;
	console.log(line);
	fs.appendFileSync(LOG, line + '\n');
};

if (!process.argv.includes('--resume')) {
	log('load: ' + JSON.stringify(await load(`${BASE}/?user=draco_jaco&period=3&reach=5`)));
}
const t0 = Date.now();
let seen = false;
while (Date.now() - t0 < MAX_MS) {
	await sleep(15_000);
	let st;
	try {
		st = await js(`
			const s = await import('/src/lib/state.svelte.ts');
			return JSON.parse(JSON.stringify({ same: s.app.ready, user: s.settings.username, period: s.settings.periodMonths, reach: s.settings.minReach,
				syncing: s.app.syncing, progress: s.app.progress, summary: s.app.summary && { games: s.app.summary.games, stored: s.app.summary.stored },
				err: s.app.error, running: s.analysis.running, ap: s.analysis.progress, drill: s.drill, path: location.pathname }));
		`);
	} catch (e) {
		log('poll failed: ' + String(e).slice(0, 200));
		continue;
	}
	if (st.running) seen = true;
	const ev = st.ap?.evals;
	log(
		`t=${Math.round((Date.now() - t0) / 1000)}s same=${st.same} ${st.user}/${st.period}mo/reach${st.reach} path=${st.path} ` +
			`sync=${st.syncing} ${st.progress ? `${st.progress.done}/${st.progress.total} ${st.progress.month} g=${st.progress.games}` : ''} ` +
			`summary=${st.summary ? `${st.summary.games}/${st.summary.stored}` : '-'} analysis=${st.running} ` +
			`evals=${ev ? `${ev.done}/${ev.total} cloud=${ev.cloud} local=${ev.local}` : '-'} cards=${st.drill.total} err=${st.err || '-'} aerr=${st.ap?.error || '-'}`
	);
	// Done once cards exist and nothing is running (the analysis can start and finish between two polls, so don't insist on seeing it run).
	if ((seen || Date.now() - t0 > 30_000) && !st.running && !st.syncing && st.drill.total > 0) {
		log('analysis finished');
		break;
	}
}
log('prep loop done');
