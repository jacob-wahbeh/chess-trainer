import fs from 'node:fs';
const order = ['home','drill-ask','drill-ask-deck','drill-correct','drill-good','drill-wrong','drill-shown','drill-why','drill-why-full','drill-menu','leaks','lines','lines-expanded','explore','settings'];
for (const s of order) {
  const d = JSON.parse(fs.readFileSync(`/tmp/ux-probe/data/${s}.json`, 'utf8'));
  console.log(`\n=== ${s}: scrollHeight ${d.scrollHeight} / ${d.vh} fits=${d.fits} on-screen=${d.targets.length} covered=${d.covered.length}${d.page ? ` page=${d.page.targets.length}` : ''}`);
  for (const t of d.targets) console.log(`  ${(t.label + (t.clipped ? ` [clip ${t.fullW}x${t.fullH}]` : '')).padEnd(44)} x${String(t.x).padStart(6)} y${String(t.y).padStart(7)} ${String(t.w).padStart(5)}x${String(t.h).padEnd(5)} near "${String(t.nearest).slice(0,22)}" gap ${t.nearestGap}${t.small ? ' SMALL' : ''}${t.tight ? ' TIGHT' : ''}${t.hit !== null && t.hit < 1 ? ` hit${t.hit}` : ''}${t.disabled ? ' disabled' : ''}`);
}
