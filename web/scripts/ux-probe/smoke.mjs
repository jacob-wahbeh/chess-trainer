import { js, click, snap, sleep } from './wk.mjs';
await sleep(1500);
const env = await js(`
  let frames = 0; const t0 = performance.now();
  await new Promise(r => { const f = () => { frames++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;top:var(--safe-t);height:var(--safe-b)'; document.body.appendChild(probe);
  const cs = getComputedStyle(probe); const safe = [cs.top, cs.height]; probe.remove();
  let idb = 'n/a';
  try { idb = await new Promise((res, rej) => { const r = indexedDB.open('probe-test', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put('ok', 'k'); tx.oncomplete = () => { const g = db.transaction('s').objectStore('s').get('k'); g.onsuccess = () => res(g.result); }; }; r.onerror = () => rej(r.error); }); } catch (e) { idb = 'ERR ' + e; }
  window.__downs = [];
  document.addEventListener('mousedown', e => window.__downs.push({ trusted: e.isTrusted, x: e.clientX, y: e.clientY, t: e.target.tagName }), true);
  return { vis: document.visibilityState, hidden: document.hidden, rafPerSec: frames, iw: innerWidth, ih: innerHeight, cw: document.documentElement.clientWidth, dpr: devicePixelRatio,
    standalone: navigator.standalone, dmStandalone: matchMedia('(display-mode: standalone)').matches, coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches,
    phone: matchMedia('(max-width: 899px)').matches, dark: matchMedia('(prefers-color-scheme: dark)').matches, safe, idb, touch: 'ontouchstart' in window, ua: navigator.userAgent.slice(0, 60),
    font: getComputedStyle(document.body).fontFamily.slice(0, 60), title: document.title, text: document.body.innerText.slice(0, 80) };
`);
console.log(JSON.stringify(env, null, 1));
console.log(await click(150, 400));
console.log(JSON.stringify(await js(`return window.__downs`)));
console.log(await snap('/tmp/ux-probe/shots/_smoke.png'));
