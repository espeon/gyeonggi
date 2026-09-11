// compare two captured screenshot sets frame by frame: RMSE, changed-pixel share, and
// the bounding box of the changed pixels, so a diff can be attributed rather than
// just detected.
//
//   bun scripts/look-base.ts /tmp/before
//   bun scripts/look-base.ts /tmp/after
//   bun scripts/shotdiff.ts /tmp/before /tmp/after
//   bun scripts/shotdiff.ts /tmp/before /tmp/after --ignore=45,15,90,50
//   bun scripts/shotdiff.ts /tmp/before /tmp/after 9-grid.png 10-grid-next.png
//
// --ignore drops a rectangle from the comparison. the clock in ?mock freezes at the
// page-load minute, so two runs straddling a minute boundary differ there and nowhere
// else, which otherwise looks exactly like a regression.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const A = process.argv[2];
const B = process.argv[3];
const rest = process.argv.slice(4);
const ignoreArg = rest.find(a => a.startsWith('--ignore='));
const ignore = ignoreArg
  ? (ignoreArg.slice('--ignore='.length).split(',').map(Number) as [number, number, number, number])
  : null;
const only = rest.filter(a => !a.startsWith('--ignore='));
const names = [
  '1-initial.png',
  '2-one-step.png',
  '3-fast-spin.png',
  '4-back-two.png',
  '5-select.png',
  '6-no-daemon.png',
  '7-midflight-a.png',
  '8-midflight-b.png',
  '9-grid.png',
  '10-grid-next.png',
  '11-back-to-flow.png',
].filter(n => only.length === 0 || only.includes(n));

const b64 = (p: string) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of names) {
  const r = await page.evaluate(
    async ([a, b, box]) => {
      const load = (dataUrl: string) =>
        new Promise<HTMLImageElement>((ok, no) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => no(new Error('img load failed'));
          img.src = dataUrl;
        });
      const one = await load(a);
      const two = await load(b);
      const w = Math.min(one.width, two.width);
      const h = Math.min(one.height, two.height);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(one, 0, 0);
      const da = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(two, 0, 0);
      const db = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let n = 0;
      let changed = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < da.length; i += 4) {
        const px = (i / 4) % w;
        const py = Math.floor(i / 4 / w);
        if (box && px >= box[0] && py >= box[1] && px < box[2] && py < box[3]) continue;
        const dr = da[i] - db[i];
        const dg = da[i + 1] - db[i + 1];
        const db2 = da[i + 2] - db[i + 2];
        sum += dr * dr + dg * dg + db2 * db2;
        n += 3;
        if (Math.abs(dr) + Math.abs(dg) + Math.abs(db2) > 24) {
          changed++;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
      return {
        rmse: Math.sqrt(sum / n).toFixed(3),
        pct: ((100 * changed) / (w * h)).toFixed(2),
        bbox: changed === 0 ? 'none' : `x${x0}..${x1} y${y0}..${y1}`,
      };
    },
    [b64(`${A}/${name}`), b64(`${B}/${name}`), ignore],
  );
  console.log(`${name.padEnd(18)} rmse=${r.rmse}  changedPx=${r.pct}%  bbox=${r.bbox}`);
}
await browser.close();
