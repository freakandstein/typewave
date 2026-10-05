import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startBridge, launch } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

const WIDE = { width: 1280, height: 549 };

async function openDemo(context, url) {
  const page = await context.newPage();
  const errors = [];
  const sockets = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('websocket', (w) => sockets.push(w.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.__typewave);
  return { page, errors, sockets };
}

test('?demo=1: hidup sendiri tanpa bridge dan tanpa headset: mengetik sendiri, pos dan level gelombang mengembara, keterangan dan panel tampil, tanpa WebSocket dan tanpa error', async () => {
  const context = await browser.newContext({ viewport: WIDE });
  const { page, errors, sockets } = await openDemo(context, `${bridge.base}/?demo=1&debug=1`);
  await page.waitForFunction(() => { const s = window.__typewave.state(); return s.noSignal === false && s.beadsActive > 0; }, null, { timeout: 8000 });
  assert.equal(await page.locator('#panel.on').count(), 1);
  assert.equal(await page.locator('#sim-wander').isChecked(), true);
  const hint = page.locator('#demo-hint');
  assert.equal(await hint.isVisible(), true);
  assert.match(await hint.innerText(), /Demo without a headset/);
  assert.equal(await hint.locator('a').getAttribute('href'), 'https://github.com/freakandstein/typewave');
  await page.evaluate(() => {
    window.__mm = { pos: [1, 0], b: [[1, 0], [1, 0], [1, 0]] };
    setInterval(() => {
      const s = window.__typewave.state(); const m = window.__mm;
      m.pos[0] = Math.min(m.pos[0], s.pos); m.pos[1] = Math.max(m.pos[1], s.pos);
      s.brain.levels.forEach((v, i) => { m.b[i][0] = Math.min(m.b[i][0], v); m.b[i][1] = Math.max(m.b[i][1], v); });
    }, 100);
  });
  await page.waitForFunction(() => window.__mm.pos[1] - window.__mm.pos[0] > 0.08 && window.__mm.b.filter(([lo, hi]) => hi - lo > 0.08).length >= 2, null, { timeout: 20000 });
  assert.deepEqual(sockets, [], 'tanpa WebSocket');
  assert.deepEqual(errors, []);
  await context.close();
});

test('?demo=1: pengunjung bisa mengetik di keyboard-nya sendiri; tombol berhenti menghentikan ketikan otomatis', async () => {
  const context = await browser.newContext({ viewport: WIDE });
  const { page, errors } = await openDemo(context, `${bridge.base}/?demo=1&debug=1`);
  await page.waitForFunction(() => window.__typewave.state().beadsActive > 0, null, { timeout: 8000 });
  assert.equal(await page.locator('#sim-auto').innerText(), 'berhenti');
  await page.locator('#sim-auto').click();
  assert.equal(await page.locator('#sim-auto').innerText(), 'ketik otomatis');
  await page.waitForFunction(() => window.__typewave.state().beadsActive === 0, null, { timeout: 12000 });  // ketikan otomatis berhenti: bead terakhir selesai
  for (let i = 0; i < 6; i++) { await page.keyboard.press(['KeyH', 'KeyA', 'KeyL', 'KeyO', 'Space', 'KeyW'][i]); await page.waitForTimeout(70); }
  await page.waitForFunction(() => window.__typewave.state().beadsActive > 0, null, { timeout: 2000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('dibuka dari host selain loopback dan dari subfolder (seperti GitHub Pages): otomatis demo, semua berkas termuat lewat alamat relatif, tanpa error dan tanpa WebSocket', async () => {
  const context = await browser.newContext({ viewport: WIDE });
  const served = [];
  await context.route('http://demo.test/**', async (route) => {
    const u = new URL(route.request().url());
    if (!u.pathname.startsWith('/typewave/')) { served.push(`404 ${u.pathname}`); return route.fulfill({ status: 404, body: 'tidak ada' }); }
    const r = await fetch(`${bridge.base}/${u.pathname.slice('/typewave/'.length)}${u.search}`);
    served.push(`${r.status} ${u.pathname}`);
    return route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream' }, body: Buffer.from(await r.arrayBuffer()) });
  });
  const { page, errors, sockets } = await openDemo(context, 'http://demo.test/typewave/?debug=1&lang=id');  // tanpa ?demo=1: host bukan loopback
  await page.waitForFunction(() => window.__typewave.state().noSignal === false, null, { timeout: 10000 });
  assert.match(await page.locator('#demo-hint').innerText(), /Demo tanpa headset/);
  assert.ok(served.some((s) => s === '200 /typewave/assets/fonts/Anybody-VF.woff2'), `font termuat: ${served.join(', ')}`);
  assert.ok(served.some((s) => s === '200 /typewave/src/main.js'));
  assert.deepEqual(served.filter((s) => !s.startsWith('200')), [], 'semua berkas termuat dari subfolder');
  assert.deepEqual(sockets, [], 'tanpa WebSocket');
  assert.deepEqual(errors, []);
  await context.close();
});
