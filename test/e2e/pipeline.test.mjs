import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort, startBridge, launch, runInject, openPage, PY, ROOT } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

const CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space', 'Backspace', 'Enter', 'ShiftLeft', 'ArrowLeft'];

test('500 key lewat bridge sampai ke halaman: tidak ada yang hilang, urutan sama, p95 < 50 ms', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1`);
  await runInject(bridge.port, ['--count', '500', '--rate', '200', '--seed', '1', '--codes', CODES.join(',')]);
  await page.waitForFunction(() => window.__typewave.stats.keysReceived >= 500, null, { timeout: 10000 });
  const got = await page.evaluate(() => ({ n: window.__typewave.stats.keysReceived, seq: window.__typewave.stats.seq, p95: window.__typewave.p95() }));
  assert.equal(got.n, 500);
  assert.deepEqual(got.seq, Array.from({ length: 500 }, (_, i) => CODES[i % CODES.length]));
  assert.ok(got.p95 < 50, 'p95 ' + got.p95);
  assert.deepEqual(errors, []);
  await page.close();
});

test('dua halaman (OBS + monitor) menerima aliran yang sama; menutup satu tidak mengganggu yang lain', async () => {
  const a = await openPage(browser, `${bridge.base}/?debug=1`);
  const b = await openPage(browser, `${bridge.base}/?debug=1`);
  const base = await b.page.evaluate(() => window.__typewave.stats.keysReceived);
  await runInject(bridge.port, ['--count', '30', '--rate', '200', '--seed', '3']);
  await a.page.waitForFunction((n) => window.__typewave.stats.keysReceived >= n + 30, base, { timeout: 10000 });
  await b.page.waitForFunction((n) => window.__typewave.stats.keysReceived >= n + 30, base, { timeout: 10000 });
  await a.page.close();
  await runInject(bridge.port, ['--count', '20', '--rate', '200', '--seed', '4']);
  await b.page.waitForFunction((n) => window.__typewave.stats.keysReceived >= n + 50, base, { timeout: 10000 });
  await b.page.close();
});

test('?ws=off: halaman berjalan tanpa bridge dan tanpa error konsol', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&ws=off`, { waitHello: false });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__typewave.stats.wsConnected), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('pause tidak basi: setelah bridge di-restart halaman mengikuti status bridge baru dan tetap menerima key', async () => {
  const port = await freePort();
  let b = await startBridge(port);
  try {
    const { page } = await openPage(browser, `${b.base}/?debug=1`);
    await page.waitForFunction(() => window.__typewave.stats.wsConnected === true);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws gagal')); });
    ws.send(JSON.stringify({ t: 'ctl', pause: true }));
    await page.waitForFunction(() => window.__typewave.state().paused === true, null, { timeout: 5000 });
    ws.close();
    await b.stop();
    await page.waitForFunction(() => window.__typewave.stats.wsConnected === false, null, { timeout: 10000 });
    b = await startBridge(port);
    await page.waitForFunction(() => window.__typewave.stats.wsConnected === true && window.__typewave.state().paused === false, null, { timeout: 15000 });
    const base = await page.evaluate(() => window.__typewave.stats.keysReceived);
    await runInject(port, ['--count', '10', '--rate', '200', '--seed', '7']);
    await page.waitForFunction((n) => window.__typewave.stats.keysReceived >= n + 10, base, { timeout: 10000 });
    await page.close();
  } finally {
    await b.stop();
  }
});

test('reconnect otomatis setelah bridge di-restart dan hello dikirim ulang', async () => {
  const port = await freePort();
  let b = await startBridge(port);
  try {
    const { page } = await openPage(browser, `${b.base}/?debug=1`);
    await page.waitForFunction(() => window.__typewave.stats.wsConnected === true);
    const helloBefore = await page.evaluate(() => window.__typewave.stats.helloCount);
    await b.stop();
    await page.waitForFunction(() => window.__typewave.stats.wsConnected === false, null, { timeout: 10000 });
    b = await startBridge(port);
    await page.waitForFunction((n) => window.__typewave.stats.wsConnected === true && window.__typewave.stats.helloCount > n, helloBefore, { timeout: 15000 });
    const base = await page.evaluate(() => window.__typewave.stats.keysReceived);
    await runInject(port, ['--count', '20', '--rate', '200', '--seed', '2']);
    await page.waitForFunction((n) => window.__typewave.stats.keysReceived >= n + 20, base, { timeout: 10000 });
    await page.close();
  } finally {
    await b.stop();
  }
});

test('jalur lengkap server EEG palsu -> adapter -> bridge -> halaman: level theta, alpha, beta sampai ke otak', async () => {
  const eegPort = await freePort();
  const procs = [];
  const run = (args) => { const p = spawn(PY, args, { cwd: ROOT, stdio: 'ignore' }); procs.push(p); return p; };
  try {
    run(['-m', 'tools.fake_eeg_server', '--port', String(eegPort), '--wander']);
    await new Promise((r) => setTimeout(r, 1500));
    run(['-m', 'adapters.eeg_socketio', '--eeg', `http://127.0.0.1:${eegPort}`, '--bridge', `ws://127.0.0.1:${bridge.port}/ws`]);
    const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1`);
    // wander bergerak ke tegang dalam beberapa detik: beta naik, theta turun (lihat wander_state)
    await page.waitForFunction(() => {
      const b = window.__typewave.state().brain;
      return b && b.levels[2] > 0.6 && b.levels[0] < 0.4;
    }, null, { timeout: 25000 });
    const lv = await page.evaluate(() => window.__typewave.state().brain.levels);
    assert.ok(lv[2] > 0.6 && lv[0] < 0.4, `level dari server EEG palsu: theta ${lv[0]} alpha ${lv[1]} beta ${lv[2]}`);
    assert.ok(lv[2] > lv[0], 'tegang: beta di atas theta');
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    for (const p of procs) p.kill();
  }
});
