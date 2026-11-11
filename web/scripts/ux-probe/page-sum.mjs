import fs from 'node:fs';
for (const s of ['home','leaks','lines','lines-expanded','explore','settings']) {
  const d = JSON.parse(fs.readFileSync(`/tmp/ux-probe/data/${s}.json`, 'utf8'));
  if (!d.page) continue;
  const t = d.page.targets;
  const small = t.filter(x => x.small), tight = t.filter(x => x.tight);
  console.log(`\n### ${s} full page (doc coords): ${t.length} in-flow targets, ${small.length} <44px, ${tight.length} gap<8; fixed: ${d.page.fixed.join(', ')}`);
  for (const x of t) if (x.small || x.tight) console.log(`  ${x.label.padEnd(36)} y${String(x.y).padStart(7)} x${String(x.x).padStart(6)} ${x.fullW}x${x.fullH} near "${String(x.nearest).slice(0,20)}" gap ${x.nearestGap}${x.small?' SMALL':''}${x.tight?' TIGHT':''}`);
}
