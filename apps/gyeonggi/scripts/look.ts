// drive the dev server in ?mock mode and capture the states that matter
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173/?mock=1';
const OUT = process.argv[2] ?? '/tmp/gyeonggi';

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

// empty state (no mock apps): visit with an empty fixture via hash? use plain page without mock and no daemon
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/6-no-daemon.png` });

await browser.close();
console.log('shots written to', OUT);
