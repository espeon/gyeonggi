// compare two screenshot sets frame by frame; prints RMSE per frame
import { chromium } from 'playwright';

const A = '/tmp/gyeonggi-base-shots';
const B = '/tmp/gyeonggi-new';
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
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of names) {
  const fs = await import('node:fs');
  const b64 = (p: string) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
  const r = await page.evaluate(async ([a, b]) => {
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
    for (let i = 0; i < da.length; i += 4) {
      const dr = da[i] - db[i];
      const dg = da[i + 1] - db[i + 1];
      const db2 = da[i + 2] - db[i + 2];
      sum += dr * dr + dg * dg + db2 * db2;
      n += 3;
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db2) > 24) changed++;
    }
    const rmse = Math.sqrt(sum / n);
    const pct = (100 * changed) / (w * h);
    return { rmse: rmse.toFixed(3), pct: pct.toFixed(2) };
  }, [b64(`${A}/${name}`), b64(`${B}/${name}`)]);
  console.log(`${name.padEnd(18)} rmse=${r.rmse}  changedPx=${r.pct}%`);
}
await browser.close();