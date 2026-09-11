// drive the dev server in ?mock mode and capture the states that matter
//
//   bun scripts/look.ts [outDir] [port]        port defaults to vite's 5173
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? '/tmp/gyeonggi';
const PORT = process.argv[3] ?? '5173';
const BASE = `http://localhost:${PORT}/?mock=1`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
await page.goto(BASE);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/1-initial.png` });

// one detent clockwise
await page.mouse.wheel(106, 0);
await page.screenshot({ path: `${OUT}/7-midflight-a.png` });
await page.screenshot({ path: `${OUT}/8-midflight-b.png` });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/2-one-step.png` });

// a fast spin: five quick detents
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(106, 0);
  await page.waitForTimeout(30);
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/3-fast-spin.png` });

// back counter-clockwise twice
await page.mouse.wheel(-106, 0);
await page.waitForTimeout(60);
await page.mouse.wheel(-106, 0);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/4-back-two.png` });

// dial press on the selected cover
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/5-select.png` });

// grid mode: mode button toggles, wheel walks the snake, escape returns
await page.keyboard.press('m');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/9-grid.png` });
await page.mouse.wheel(106, 0);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/10-grid-next.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/11-back-to-flow.png` });

// empty state: the same server without ?mock, so there are no fixtures and nothing to connect to
await page.goto(`http://localhost:${PORT}/`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/6-no-daemon.png` });

await browser.close();
console.log('shots written to', OUT);
