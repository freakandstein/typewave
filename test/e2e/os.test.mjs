// Tes dengan event OS sungguhan. Opt-in: TYPEWAVE_OS_TESTS=1. Membutuhkan izin macOS
// (Input Monitoring untuk bridge, Accessibility untuk autotype) dan membuka jendela Chrome sungguhan.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort, startBridge, launch, openPage, PY, ROOT } from './helpers.mjs';

const ENABLED = process.env.TYPEWAVE_OS_TESTS === '1';
const skip = !ENABLED && 'set TYPEWAVE_OS_TESTS=1 setelah memberi izin macOS (lihat README)';
let bridge, browser;

before(async () => {
  if (!ENABLED) return;
  bridge = await startBridge(await freePort(), { listener: true });
  browser = await launch({ headless: false, channel: 'chrome', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
});
after(async () => { await browser?.close(); await bridge?.stop(); });

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(PY, ['-m', 'tools.autotype', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error('autotype gagal:\n' + out))));
});

async function ready(t) {
  const status = await (await fetch(`${bridge.base}/status`)).json();
  if (status.listener !== 'ok') { t.skip(`listener ${status.listener}: beri izin Input Monitoring ke aplikasi yang menjalankan tes ini`); return null; }
  const { page } = await openPage(browser, `${bridge.base}/?sim=1&debug=1`);
  await page.bringToFront();
  await page.waitForTimeout(500);
  if (!(await page.evaluate(() => document.hasFocus()))) { t.skip('jendela Chrome tidak fokus: ketikan OS bisa nyasar ke aplikasi lain'); await page.close(); return null; }
  await page.waitForFunction(() => window.__typewave.stats.hello && window.__typewave.stats.hello.keys === true);
  return page;
}

test('autotype 200 tombol: tidak ada yang hilang, tidak ada yang dobel (sim=1 + halaman fokus), urutan sama, p95 < 50 ms', { skip, timeout: 90000 }, async (t) => {
  const page = await ready(t);
  if (!page) return;
  const plan = JSON.parse(await run(['--count', '200', '--seed', '1', '--print-plan']));
  await run(['--count', '200', '--seed', '1', '--countdown', '1']);
  await page.waitForFunction(() => window.__typewave.stats.keysReceived >= 200, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const got = await page.evaluate(() => ({ n: window.__typewave.stats.keysReceived, seq: window.__typewave.stats.seq, p95: window.__typewave.p95() }));
  assert.equal(got.n, 200);
  assert.deepEqual(got.seq, plan);
  assert.ok(got.p95 < 50, 'p95 ' + got.p95);
  await page.close();
});

test('hotkey global ctrl+alt+p (pause) dan ctrl+alt+r (laporan) lewat event OS', { skip, timeout: 60000 }, async (t) => {
  const page = await ready(t);
  if (!page) return;
  await run(['--chord', 'ctrl+alt+KeyP', '--countdown', '1']);
  await page.waitForFunction(() => window.__typewave.state().paused === true, null, { timeout: 5000 });
  await run(['--chord', 'ctrl+alt+KeyP', '--countdown', '1']);
  await page.waitForFunction(() => window.__typewave.state().paused === false, null, { timeout: 5000 });
  await run(['--chord', 'ctrl+alt+KeyR', '--countdown', '1']);
  await page.waitForFunction(() => window.__typewave.state().reportVisible === true, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__typewave.stats.keysReceived), 0, 'chord hotkey tidak boleh menjadi key');
  await page.close();
});
