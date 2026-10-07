import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startBridge, startEeg, launch, openPage } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

// Apa yang tampak di HUD: teks status, apakah titik sensor tampil, dan level tiap titik (urutan TP9, AF7, AF8, TP10).
const readHud = (page) => page.evaluate(() => ({
  status: document.getElementById('hud-status').textContent,
  on: document.getElementById('hud-contact').classList.contains('on'),
  dots: [...document.querySelectorAll('#hud-contact .dot')].map((d) => [...d.classList].slice(1).join(' ')),
}));
const until = (page, pred, timeout = 8000) => page.waitForFunction(pred, null, { timeout, polling: 100 });
const hudIs = (page, want, timeout) => page.waitForFunction((w) => {
  const hud = {
    status: document.getElementById('hud-status').textContent,
    on: document.getElementById('hud-contact').classList.contains('on'),
    dots: [...document.querySelectorAll('#hud-contact .dot')].map((d) => [...d.classList].slice(1).join(' ')),
  };
  return Object.entries(w).every(([k, v]) => JSON.stringify(hud[k]) === JSON.stringify(v));
}, want, { timeout: timeout ?? 8000, polling: 100 });

// Menirukan sumber EEG: pesan headset diulang tiap 200 ms (detak), dan mind (opsional) supaya halaman punya sinyal.
const beat = (page, msg) => page.evaluate((m) => {
  clearInterval(window.__hb);
  const send = () => window.__typewave.emit('headset', m);
  send();
  window.__hb = setInterval(send, 200);
}, msg);
const silence = (page) => page.evaluate(() => clearInterval(window.__hb));
const mind = (page, on) => page.evaluate((go) => {
  clearInterval(window.__mind);
  if (go) {
    const send = () => window.__typewave.setMind({ pos: 0.5, theta: 0.5, alpha: 0.5, beta: 0.5, q: 1 });
    send();
    window.__mind = setInterval(send, 200);
  }
}, on);

const GOOD = ['tp9 good', 'af7 good', 'af8 good', 'tp10 good'];

test('HUD: tiap keadaan headset punya teks sendiri, titik sensor mengikuti kontak dan hilang saat putus', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`);
  await hudIs(page, { status: 'tanpa sinyal', on: false });

  await beat(page, { state: 'connected', contact: [1, 0.5, 0.1, 0.9] });
  await hudIs(page, { status: 'menyiapkan sinyal', on: true, dots: ['tp9 good', 'af7 fair', 'af8 poor', 'tp10 good'] });
  await page.waitForTimeout(800); // warna berubah halus (500 ms)
  const paint = await page.evaluate(() => [...document.querySelectorAll('#hud-contact .dot')].map((d) => { const c = getComputedStyle(d); return [c.backgroundColor, c.borderTopColor]; }));
  const good = ['rgb(122, 223, 160)', 'rgb(122, 223, 160)'];
  const fair = ['rgb(242, 178, 78)', 'rgb(242, 178, 78)'];
  const poor = ['rgba(0, 0, 0, 0)', 'rgb(255, 94, 114)']; // cincin: bentuk ikut membedakan, bukan hanya warna
  assert.deepEqual(paint, [good, fair, poor, good]);

  await beat(page, { state: 'connected', contact: [0, 0, 0, 0] });
  await hudIs(page, { status: 'cek sensor', on: true, dots: ['tp9 poor', 'af7 poor', 'af8 poor', 'tp10 poor'] });

  await beat(page, { state: 'connected', contact: [1, 1, 1, 1] });
  await mind(page, true);
  await hudIs(page, { status: '', on: true, dots: GOOD });

  await beat(page, { state: 'reconnecting', attempt: 2 });
  await hudIs(page, { status: 'menyambung ulang, percobaan 2', on: false }); // tampil segera walau mind terakhir belum basi
  await beat(page, { state: 'connecting' });
  await hudIs(page, { status: 'menyambung ke headset', on: false });

  await beat(page, { state: 'connected', contact: [1, 1, 1, 1] });
  await hudIs(page, { status: '', on: true, dots: GOOD });
  await silence(page);
  await hudIs(page, { status: 'sumber EEG terputus', on: false }, 8000); // detak berhenti > 3 detik

  await beat(page, { state: 'connected', contact: [1, 1, 1, 1] });
  await hudIs(page, { status: '', on: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test('?contact=0 menyembunyikan titik sensor tetapi teks status tetap tampil; label en', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&contact=0`);
  await beat(page, { state: 'connected', contact: [1, 1, 1, 1] });
  await hudIs(page, { status: 'warming up' });
  assert.equal((await readHud(page)).on, false);
  await beat(page, { state: 'reconnecting', attempt: 1 });
  await hudIs(page, { status: 'reconnecting, attempt 1' });
  assert.deepEqual(errors, []);
  await page.close();
});

test('titik sensor tidak menabrak HR, tetap di dalam bingkai, di layout wide dan tall; HR tidak bergeser saat titik muncul', async () => {
  for (const [layout, viewport] of [['wide', { width: 1280, height: 549 }], ['tall', { width: 540, height: 960 }]]) {
    const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&layout=${layout}`, { viewport });
    await mind(page, true);
    await page.evaluate(() => window.__typewave.emit('mind', { pos: 0.5, hr: 72, q: 1 }));
    await page.evaluate(() => { window.__mind2 = setInterval(() => window.__typewave.emit('mind', { pos: 0.5, hr: 72, q: 1 }), 200); });
    await until(page, () => document.getElementById('hud-hr').textContent !== '');
    const rects = () => page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const st = document.getElementById('stage').getBoundingClientRect();
      return { hr: r('hud-hr'), contact: r('hud-contact'), stage: { x: st.x, y: st.y, w: st.width, h: st.height } };
    });
    const before = await rects();
    await beat(page, { state: 'connected', contact: [1, 0.5, 0.1, 0.9] });
    await hudIs(page, { on: true });
    const after = await rects();
    assert.deepEqual([after.hr.x, after.hr.y], [before.hr.x, before.hr.y], `${layout}: HR tidak boleh bergeser`);
    const c = after.contact;
    const disjoint = (a, b) => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
    assert.ok(disjoint(c, after.hr), `${layout}: titik sensor menabrak HR ${JSON.stringify(after)}`);
    const s = after.stage;
    assert.ok(c.x >= s.x && c.y >= s.y && c.x + c.w <= s.x + s.w && c.y + c.h <= s.y + s.h, `${layout}: di luar bingkai`);
    assert.ok(c.w > 8 && c.h > 8, `${layout}: terlalu kecil ${c.w}x${c.h}`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('API debug aman dipanggil sebelum frame pertama: status headset sudah terhitung (unknown), tanpa error', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 549 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => setTimeout(() => raf(cb), 150); // frame pertama baru jalan 150 ms kemudian
    const iv = setInterval(() => {
      if (!window.__typewave) return;
      clearInterval(iv);
      try { window.__early = { ok: true, headset: window.__typewave.state().headset }; } catch (e) { window.__early = { ok: false, error: String(e) }; }
    }, 0);
  });
  await page.goto(`${bridge.base}/?debug=1`);
  await page.waitForFunction(() => window.__early);
  const early = await page.evaluate(() => window.__early);
  assert.equal(early.ok, true, early.error);
  assert.deepEqual(early.headset, { state: 'unknown', attempt: 0, contact: null });
  assert.deepEqual(errors, []);
  await page.close();
});

test('pesan headset dari sumber lain lewat bridge sampai ke HUD (pesan ber-teks galat dibuang di bridge)', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`);
  const sender = await browser.newPage();
  await sender.goto(`${bridge.base}/status`);
  await sender.evaluate((url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    window.__send = (o) => ws.send(JSON.stringify(o));
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('ws'));
  }), `ws://127.0.0.1:${bridge.port}/ws`);
  await sender.evaluate(() => { window.__beat = setInterval(() => window.__send({ t: 'headset', state: 'connected', contact: [0.2, 1, 1, 0.4], error: 'AA:BB:CC:DD' }), 200); });
  await hudIs(page, { status: 'menyiapkan sinyal', on: true, dots: ['tp9 poor', 'af7 good', 'af8 good', 'tp10 fair'] });
  assert.equal(JSON.stringify(await page.evaluate(() => window.__typewave.state().headset)).includes('AA:BB'), false);
  await sender.evaluate(() => { clearInterval(window.__beat); window.__send({ t: 'headset', state: 'reconnecting', attempt: 3 }); });
  await hudIs(page, { status: 'menyambung ulang, percobaan 3', on: false });
  assert.deepEqual(errors, []);
  await sender.close();
  await page.close();
});

test('bridge mati: HUD menulis "bridge terputus", dan pulih sendiri saat bridge hidup lagi', async () => {
  const port = await freePort();
  const own = await startBridge(port);
  let again;
  try {
    const { page, errors } = await openPage(browser, `${own.base}/?debug=1&lang=id`);
    await hudIs(page, { status: 'tanpa sinyal' });
    await own.stop();
    await hudIs(page, { status: 'bridge terputus' }, 8000);
    again = await startBridge(port);
    await hudIs(page, { status: 'tanpa sinyal' }, 15000); // sambung ulang bawaan halaman (1, 2, 5 detik)
    assert.deepEqual(errors.filter((e) => !/WebSocket|ERR_CONNECTION|Failed to load resource/i.test(e)), []);
    await page.close();
  } finally {
    await again?.stop();
    await own.stop();
  }
});

test('bridge hidup lagi sementara sumber EEG terus berdetak: HUD tidak berkedip "sumber EEG terputus" (detak yang hilang saat bridge mati bukan tanda sumbernya mati)', async () => {
  const port = await freePort();
  let own = await startBridge(port);
  let sender;
  try {
    const { page, errors } = await openPage(browser, `${own.base}/?debug=1&lang=id`);
    // sumber EEG tiruan: halaman terpisah yang menyambung ulang sendiri dan berdetak 5 Hz
    sender = await browser.newPage();
    await sender.goto(`${own.base}/status`);
    await sender.evaluate((url) => {
      let ws;
      const open = () => { ws = new WebSocket(url); };
      open();
      setInterval(() => { if (ws.readyState === 3) open(); }, 100);
      setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'headset', state: 'connected', contact: [1, 1, 1, 1] })); }, 200);
    }, `ws://127.0.0.1:${port}/ws`);
    await page.evaluate(() => { window.__seen = new Set(); setInterval(() => window.__seen.add(document.getElementById('hud-status').textContent), 30); });
    await hudIs(page, { on: true, dots: GOOD }, 10000);
    await own.stop();
    await hudIs(page, { status: 'bridge terputus' }, 8000);
    await new Promise((r) => setTimeout(r, 4000)); // lebih lama dari 3 detik: detak terakhir sudah "basi" saat halaman tersambung lagi
    own = await startBridge(port);
    await hudIs(page, { on: true, dots: GOOD }, 25000); // halaman tersambung lagi (sambung ulang bawaan 1, 2, 5 detik) dan detak mengalir
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => [...window.__seen]);
    assert.ok(seen.includes('bridge terputus'), JSON.stringify(seen));
    assert.equal(seen.includes('sumber EEG terputus'), false, `berkedip: ${JSON.stringify(seen)}`);
    assert.deepEqual(errors.filter((e) => !/WebSocket|ERR_CONNECTION|Failed to load resource/i.test(e)), []);
    await page.close();
  } finally {
    await sender?.close();
    await own.stop();
  }
});

test('rantai penuh: sumber EEG palsu dengan sensor AF7 rusak -> titik AF7 merah, lainnya hijau; streamer dibunuh -> "menyambung ulang" lalu pulih', async () => {
  const eeg = await startEeg(bridge.port, { warmup: 1, extra: ['--fake-degrade', 'AF7:flat@0'] });
  try {
    const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`);
    await hudIs(page, { on: true, dots: ['tp9 good', 'af7 poor', 'af8 good', 'tp10 good'] }, 45000);
    await hudIs(page, { status: '' }, 45000); // tiga sensor lain cukup: mind mengalir, tidak ada teks
    const pid1 = eeg.streamerPid();
    assert.ok(pid1, 'pid streamer tercatat');
    process.kill(pid1, 'SIGKILL'); // headset terlepas mendadak
    await hudIs(page, { status: 'menyambung ulang, percobaan 1', on: false }, 20000);
    await hudIs(page, { on: true, dots: ['tp9 good', 'af7 poor', 'af8 good', 'tp10 good'] }, 45000);
    await hudIs(page, { status: '' }, 45000);
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await eeg.stop();
  }
});
