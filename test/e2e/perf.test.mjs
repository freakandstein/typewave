// Tes performa. Opt-in: TYPEWAVE_PERF=1 (fps; membuka jendela Chrome sungguhan ±70 detik)
// dan TYPEWAVE_SOAK=1 (10 menit, headless).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startBridge, launch, openPage } from './helpers.mjs';

const PERF = process.env.TYPEWAVE_PERF === '1';
const SOAK = process.env.TYPEWAVE_SOAK === '1';
let bridge;
before(async () => { if (PERF || SOAK) bridge = await startBridge(await freePort()); });
after(async () => { await bridge?.stop(); });

const FLAGS = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
const drive = (page, perSec = 8) => page.evaluate((rate) => {
  const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'Space', 'KeyE'];
  window.__drive = setInterval(() => window.__typewave.press(codes[Math.floor(Math.random() * codes.length)]), 1000 / rate);
}, perSec);

test('60 fps di Chrome (headed) 1920x1080: fps rata-rata >= 58 dan waktu gambar p95 <= 8 ms selama 60 detik dengan 8 tombol/detik',
  { skip: !PERF && 'set TYPEWAVE_PERF=1 (membuka jendela Chrome ±70 detik)', timeout: 150000 }, async (t) => {
    const browser = await launch({ headless: false, channel: 'chrome', args: FLAGS });
    try {
      const { page } = await openPage(browser, `${bridge.base}/?sim=1&debug=1&ws=off&ratio=16:9`, { viewport: { width: 1920, height: 1080 }, waitHello: false });
      await page.bringToFront();
      if ((await page.evaluate(() => document.visibilityState)) !== 'visible') { t.skip('jendela tidak terlihat'); return; }
      await page.locator('#sim-wander').check();
      await drive(page);
      await page.waitForTimeout(3000);
      const samples = [];
      for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); samples.push(await page.evaluate(() => window.__typewave.perf())); }
      const fps = samples.map((s) => s.fpsAvg);
      const p95 = samples.map((s) => s.drawP95);
      const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
      console.log(`fps min ${Math.min(...fps).toFixed(1)} rata-rata ${avg.toFixed(1)} | waktu gambar p95 maks ${Math.max(...p95).toFixed(2)} ms`);
      assert.ok(avg >= 58, 'fps rata-rata ' + fps.map((f) => f.toFixed(1)));
      assert.ok(Math.max(...p95) <= 8, 'waktu gambar p95 ' + p95.map((f) => f.toFixed(2)));
    } finally { await browser.close(); }
  });

test('soak 10 menit (headless, 8 tombol/detik): heap stabil, pertumbuhan < 5 MB setelah GC',
  { skip: !SOAK && 'set TYPEWAVE_SOAK=1 (10 menit)', timeout: 15 * 60 * 1000 }, async () => {
    const browser = await launch();
    try {
      const { page } = await openPage(browser, `${bridge.base}/?sim=1&debug=1&ws=off&ratio=16:9`, { viewport: { width: 1280, height: 720 }, waitHello: false });
      await page.locator('#sim-wander').check();
      await drive(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.enable');
      const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize; };
      await page.waitForTimeout(2 * 60 * 1000);
      const base = await heap();
      const series = [base];
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(60 * 1000); series.push(await heap()); }
      const growth = series.at(-1) - base;
      console.log('heap (MB):', series.map((b) => (b / 1e6).toFixed(1)).join(' '));
      assert.ok(growth < 5 * 1024 * 1024, `pertumbuhan heap ${(growth / 1e6).toFixed(2)} MB`);
      assert.ok((await page.evaluate(() => window.__typewave.stats.seq.length)) <= 5000);
    } finally { await browser.close(); }
  });
