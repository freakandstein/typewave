import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startBridge, startEeg, launch, openPage } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

const live = () => window.__typewave.state().noSignal === false;
const dead = () => window.__typewave.state().noSignal === true;

test('sumber EEG mandiri (streamer Muse palsu) -> bridge -> halaman: mind mengalir dan level gelombang bergerak', async () => {
  const eeg = await startEeg(bridge.port);
  try {
    const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1`);
    await page.waitForFunction(live, null, { timeout: 45000, polling: 250 });
    await page.evaluate(() => {
      window.__mm = [[1, 0], [1, 0], [1, 0]];
      setInterval(() => {
        const l = window.__typewave.state().brain.levels;
        for (let i = 0; i < 3; i++) { window.__mm[i][0] = Math.min(window.__mm[i][0], l[i]); window.__mm[i][1] = Math.max(window.__mm[i][1], l[i]); }
      }, 100);
    });
    // profil mixed menggerakkan theta, alpha, beta pelan-pelan: level tidak boleh macet di netral 0,5
    await page.waitForFunction(() => window.__mm.some(([lo, hi]) => hi - lo > 0.15), null, { timeout: 40000, polling: 250 });
    const got = await page.evaluate(() => ({ pos: window.__typewave.state().pos, levels: window.__typewave.state().brain.levels, mm: window.__mm }));
    assert.ok(got.pos >= 0 && got.pos <= 1, 'pos ' + got.pos);
    for (const v of got.levels) assert.ok(v >= 0 && v <= 1, 'level ' + v);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await eeg.stop();
  }
});

test('headset putus (streamer dibunuh) lalu tersambung kembali: halaman jatuh ke no signal dan pulih sendiri', async () => {
  const eeg = await startEeg(bridge.port);
  try {
    const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1`);
    await page.waitForFunction(live, null, { timeout: 45000, polling: 250 });
    const pid1 = eeg.streamerPid();
    assert.ok(pid1, 'pid streamer tercatat');
    process.kill(pid1, 'SIGKILL');  // proses Bluetooth mati mendadak seperti headset terlepas
    await page.waitForFunction(dead, null, { timeout: 15000, polling: 250 });
    await page.waitForFunction(live, null, { timeout: 45000, polling: 250 });
    const pid2 = eeg.streamerPid();
    assert.ok(pid2 && pid2 !== pid1, 'streamer baru menggantikan yang mati');
    assert.match(eeg.logs(), /koneksi headset putus/);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await eeg.stop();
  }
});
