import fs from 'node:fs';
const order = ['drill-ask','drill-correct','drill-good','drill-wrong','drill-shown','drill-why','drill-why-full','drill-menu','drill-ask-deck','home','leaks','lines','lines-expanded','explore','settings'];
const kind = (s, t) => {
  const L = t.label;
  if (L === 'board') return 'board';
  if (t.cls.includes('mv')) return `move "${L}"`;
  if (t.cls.includes('chip-line')) return `line chip "${L}"`;
  return L;
};
const screens = [];
for (const s of order) {
  const d = JSON.parse(fs.readFileSync(`/tmp/ux-probe/data/${s}.json`, 'utf8'));
  const targets = d.targets.map((t) => {
    let label = kind(s, t).replace(/\s+/g, ' ');
    if (label.length > 40) label = label.slice(0, 38) + '…';
    if (t.clipped) label += ` (clipped by scroller; full ${Math.round(t.fullW)}x${Math.round(t.fullH)})`;
    if (t.disabled) label += ' (disabled)';
    if (t.hit !== null && t.hit < 1) label += ` (hit ${Math.round(t.hit * 100)}%)`;
    return { label, x: t.x, y: t.y, w: t.w, h: t.h, nearest: String(t.nearest).replace(/\s+/g, ' ').slice(0, 30), nearestGap: t.nearestGap };
  });
  screens.push({ name: s, screenshot: `/tmp/ux-probe/shots/${s}.png`, fitsWithoutScroll: d.fits, scrollHeight: d.scrollHeight, targets });
}
fs.writeFileSync('/tmp/ux-probe/screens.json', JSON.stringify(screens));
console.log(JSON.stringify(screens).length, 'chars');
for (const s of screens) console.log(s.name, s.targets.length);
