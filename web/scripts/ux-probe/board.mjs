import { js } from './wk.mjs';
import { open, waitFor } from './nav.mjs';
await open('/drill?card=' + encodeURIComponent('draco_jaco|white|6820108232337383|f1c4'));
await waitFor(`document.querySelector('cg-board')`);
console.log(JSON.stringify(await js(`
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left*100)/100, Math.round(b.top*100)/100, Math.round(b.width*100)/100, Math.round(b.height*100)/100]; };
  return { dpr: devicePixelRatio, wrapper: r('.drill .board'), cgWrap: r('.cg-wrap'), container: r('cg-container'), board: r('cg-board'), containerStyle: document.querySelector('cg-container').getAttribute('style'), evalbar: r('.evalbar'), bar: r('.bar'), main: getComputedStyle(document.querySelector('main')).padding };
`)));
