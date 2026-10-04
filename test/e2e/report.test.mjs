import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, startBridge, launch, openPage, ROOT } from './helpers.mjs';

let bridge, browser;
const QUICK = path.join(ROOT, 'replay', 'e2e-quick.json');

before(async () => {
  // Sesi mini (10 s): 20 karakter, 3 backspace, 1 Enter, 10 karakter; mind pos 0.5 setiap 200 ms.
  const events = [];
  for (let t = 0; t <= 10000; t += 200) events.push({ t, type: 'mind', pos: 0.5, hr: 70, q: 1 });
  for (let i = 0; i < 20; i++) events.push({ t: 1000 + i * 200, type: 'key', code: i % 6 === 5 ? 'Space' : 'KeyA' });
  for (const t of [5000, 5200, 5400]) events.push({ t, type: 'key', code: 'Backspace' });
  events.push({ t: 6000, type: 'key', code: 'Enter' });
  for (let i = 0; i < 10; i++) events.push({ t: 7000 + i * 300, type: 'key', code: 'KeyS' });
  events.sort((a, b) => a.t - b.t);
  fs.writeFileSync(QUICK, JSON.stringify({ meta: { name: 'e2e-quick', durationMs: 10000 }, events }));
  bridge = await startBridge(await freePort());
  browser = await launch();
});
after(async () => { fs.rmSync(QUICK, { force: true }); await browser?.close(); await bridge?.stop(); });

const url = (q = '') => `${bridge.base}/?debug=1${q}`;
const VP = { width: 960, height: 540 };
const state = (page) => page.evaluate(() => window.__typewave.state());

test('tombol R membuka kartu laporan, Esc menutup; tombol ekspor hanya muncul dengan ?controls=1', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: VP, waitHello: false });
  assert.equal(await page.locator('#export-wide').count(), 0);
  await page.keyboard.press('KeyR');
  assert.equal((await state(page)).reportVisible, true);
  assert.equal(await page.locator('#report').evaluate((el) => getComputedStyle(el).display), 'block');
  assert.equal(await page.locator('#hud').evaluate((el) => getComputedStyle(el).visibility), 'hidden', 'HUD tidak boleh menumpuk dengan kartu');
  await page.keyboard.press('Escape');
  assert.equal((await state(page)).reportVisible, false);
  assert.equal(await page.locator('#hud').evaluate((el) => getComputedStyle(el).visibility), 'visible');
  await page.close();
  const c = await openPage(browser, url('&ws=off&controls=1'), { viewport: VP, waitHello: false });
  assert.equal(await c.page.locator('#export-wide').count(), 1);
  assert.equal(await c.page.locator('#export-tall').count(), 1);
  assert.equal(await c.page.locator('#panel.on').count(), 1);
  await c.page.close();
});

test('ctl.report dari bridge (hotkey global) menampilkan kartu dan menutup sendiri setelah 9 detik', async () => {
  const { page } = await openPage(browser, url(), { viewport: VP });
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws gagal')); });
  ws.send(JSON.stringify({ t: 'ctl', report: true }));
  await page.waitForFunction(() => window.__typewave.state().reportVisible === true, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__typewave.state().reportVisible === false, null, { timeout: 12000 });
  ws.close();
  await page.close();
});

test('ctl.pause dari bridge: halaman menampilkan indikator dan mengabaikan key', async () => {
  const { page } = await openPage(browser, url(), { viewport: VP });
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`);
  await new Promise((res) => { ws.onopen = res; });
  ws.send(JSON.stringify({ t: 'ctl', pause: true }));
  await page.waitForFunction(() => window.__typewave.state().paused === true, null, { timeout: 5000 });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#hud-status').textContent(), 'no signal  paused');
  await page.evaluate(() => window.__typewave.press('KeyA'));
  assert.equal(await page.evaluate(() => window.__typewave.stats.keysReceived), 0);
  ws.send(JSON.stringify({ t: 'ctl', pause: false }));
  await page.waitForFunction(() => window.__typewave.state().paused === false, null, { timeout: 5000 });
  ws.close();
  await page.close();
});

test('ekspor PNG 1920x1080 dan 1080x1920 menghasilkan PNG valid berukuran persis', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: VP, waitHello: false });
  for (const [kind, w, h] of [['wide', 1920, 1080], ['tall', 1080, 1920]]) {
    const r = await page.evaluate((k) => window.__typewave.exportPng(k), kind);
    assert.deepEqual(r.signature, [137, 80, 78, 71, 13, 10, 26, 10], kind);
    assert.equal(r.type, 'image/png');
    assert.deepEqual([r.width, r.height], [w, h], kind);
    assert.ok(r.size > 2000, `${kind} ${r.size}`);
  }
  await page.close();
});

test('replay sesi mini: angka laporan cocok dengan yang diketahui (jalur replay -> bus -> metrics)', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&replay=e2e-quick'), { viewport: VP, waitHello: false });
  await page.waitForFunction(() => window.__typewave.stats.replayDone === true, null, { timeout: 20000 });
  const r = await page.evaluate(() => window.__typewave.report());
  assert.equal(r.backspaces, 3);
  assert.equal(r.chars, 30);
  assert.ok(r.flowSec >= 9 && r.flowSec <= 13, 'flowSec ' + r.flowSec);
  assert.ok(r.longestGapMs >= 900 && r.longestGapMs <= 4000, 'gap ' + r.longestGapMs);
  assert.ok(r.log.length >= 9);
  assert.ok(r.peakWpm > 20, 'peak ' + r.peakWpm);
  assert.deepEqual(errors, []);
  await page.close();
});

test('sample-session.json diputar tanpa bridge dan tanpa headset (?ws=off): mind dan key masuk', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&replay=sample-session'), { viewport: VP, waitHello: false });
  await page.waitForFunction(() => window.__typewave.stats.replayStarted === true, null, { timeout: 10000 });
  await page.waitForFunction(() => window.__typewave.stats.keysReceived >= 10, null, { timeout: 20000 }); // key pertama di t = 10 s
  const s = await state(page);
  assert.equal(s.noSignal, false);
  assert.ok(Math.abs(s.rawPos - 0.2) < 1e-9, 'pos ' + s.rawPos);
  assert.equal(await page.evaluate(() => window.__typewave.stats.wsConnected), false);
  assert.deepEqual(errors, []);
  await page.close();
});
