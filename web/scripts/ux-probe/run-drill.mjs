// Drill states on one card (Petrov: taught 3.Nxe5; d4 is an accepted alternative; Bc4 is the habit).
import { js } from './wk.mjs';
import { open, waitFor, waitStable, playMove, sleep } from './nav.mjs';
import { measureState } from './measure.mjs';

const CARD = 'draco_jaco|white|6820108232337383|f1c4';
const MAIN = 'f3e5', ALT = 'd2d4', WRONG = 'f1c4';
const only = process.argv[2]; // run one group: ask | correct | good | wrong | deck

const askReady = `document.querySelector('.note .phone strong')?.innerText === 'Your move'`;
const clickJs = (sel, text) =>
	js(`const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.innerText.trim() === ${JSON.stringify(text)}` : 'true'}); if (!el) return false; el.click(); return true;`);

async function startCard(card = CARD) {
	await open(card ? `/drill?card=${encodeURIComponent(card)}` : '/drill');
	await waitFor(`document.querySelector('cg-board')`, 40_000, 'board');
	// Skip the setup replay (a tap on the board does this in the app).
	await sleep(800);
	await js(`document.querySelector('.drill .board')?.click(); return true;`);
	await waitFor(askReady, 20_000, 'Your move');
}

async function answer(uci) {
	const mv = await playMove(uci);
	await waitFor(`document.querySelector('.bar.answered .status') && document.querySelector('.verdict')`, 40_000, 'result');
	console.log('stable', await waitStable(3000, 45_000));
	return mv;
}

const text = () =>
	js(`return { status: document.querySelector('.bar .status')?.innerText.replace(/\\s+/g, ' '), verdict: document.querySelector('.verdict')?.innerText.replace(/\\s+/g, ' '), note: document.querySelector('.note')?.innerText.replace(/\\s+/g, ' '), foot: document.querySelector('.foot')?.innerText.replace(/\\s+/g, ' '), chips: [...document.querySelectorAll('.chips .chip-line')].map((c) => c.innerText.replace(/\\s+/g, ' ')) };`);

if (!only || only === 'deck') {
	await startCard(null);
	await waitStable(2000);
	await measureState('drill-ask-deck', { note: 'Drill opened from the deck (first card by need)' });
}

if (!only || only === 'ask' || only === 'correct') {
	await startCard();
	await waitStable(2000);
	await measureState('drill-ask', { note: 'Your move (Petrov card)' });
	const mv = await answer(MAIN);
	console.log('move', JSON.stringify(mv));
	console.log(JSON.stringify(await text()));
	await measureState('drill-correct', { note: 'After the taught move 3.Nxe5 (green Correct)' });

	await clickJs('.menu summary');
	await sleep(400);
	await measureState('drill-menu', { note: '⋯ menu open (details/summary)' });
	await clickJs('.menu summary');
	await sleep(300);

	await clickJs('.foot .actions button', 'Why?');
	await waitFor(`document.querySelector('.sheet')`, 10_000, 'sheet');
	await sleep(600);
	await waitStable(2000);
	await measureState('drill-why', { note: 'Why sheet open (half height, under the board)' });
	await clickJs('.sheet .expand');
	await sleep(600);
	await measureState('drill-why-full', { note: 'Why sheet expanded' });
	await clickJs('.sheet-head button[aria-label="Close"]');
	await sleep(400);
}

if (!only || only === 'good') {
	await startCard();
	await answer(ALT);
	console.log(JSON.stringify(await text()));
	await measureState('drill-good', { note: 'After 3.d4, a sound alternative (blue Good move; taught move still hidden)' });
}

if (!only || only === 'wrong') {
	await startCard();
	await answer(WRONG);
	console.log(JSON.stringify(await text()));
	await measureState('drill-wrong', { note: 'After 3.Bc4, the habit (red Not quite)' });
	await clickJs('.foot .actions button', 'Show answer');
	await sleep(500);
	console.log('stable', await waitStable(2500, 30_000));
	console.log(JSON.stringify(await text()));
	await measureState('drill-shown', { note: 'After Show answer' });
}
