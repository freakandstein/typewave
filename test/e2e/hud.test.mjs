import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { freePort, startBridge, launch, openPage } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

const IDS = ['hud-state', 'hud-wpm', 'hud-small', 'hud-status'];

test('teks HUD tidak membesar dan mengecil: sumbu huruf, ukuran, dan lebar teks yang sama tetap sama di kondisi tenang, netral, dan tegang', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`, { viewport: { width: 1280, height: 549 } });
  // Lebar diukur dengan teks yang persis sama di tiap kondisi (kata state dan angka berganti sendiri), jadi hanya sumbu huruf yang bisa mengubahnya.
  const probe = () => page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const span = document.createElement('span');
      span.textContent = 'netral 0123456789 wpm';
      span.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      el.appendChild(span);
      out[id] = { fv: cs.fontVariationSettings, size: cs.fontSize, width: Math.round(span.getBoundingClientRect().width * 10) / 10 };
      span.remove();
    }
    return out;
  }, IDS);
  const seen = [];
  for (const pos of [0.02, 0.5, 0.98]) {
    await page.evaluate((p) => {
      clearInterval(window.__m);
      const send = () => window.__typewave.setMind({ pos: p, hr: 72, q: 1 });
      send();
      window.__m = setInterval(send, 200);
    }, pos);
    await page.waitForTimeout(2500); // pos dihaluskan pegas: tunggu sampai menetap
    seen.push(await probe());
  }
  const want = `"wdth" ${CONFIG.type.hudWdth}, "wght" ${CONFIG.type.hudWght}`;
  for (const id of IDS) {
    for (const s of seen) assert.equal(s[id].fv, want, `${id}: sumbu huruf harus tetap`);
    assert.equal(new Set(seen.map((s) => s[id].size)).size, 1, `${id}: ukuran huruf berubah ${JSON.stringify(seen.map((s) => s[id].size))}`);
    assert.equal(new Set(seen.map((s) => s[id].width)).size, 1, `${id}: lebar teks yang sama berubah ${JSON.stringify(seen.map((s) => s[id].width))}`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

const rectOf = (page, id) => page.evaluate((i) => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, id);
const feed = (page, hr) => page.evaluate((h) => {
  clearInterval(window.__m); clearInterval(window.__h);
  const mind = () => window.__typewave.setMind({ pos: 0.5, hr: h, q: 1 });
  const beat = () => window.__typewave.emit('headset', { state: 'connected', contact: [1, 1, 1, 1] });
  mind(); beat();
  window.__m = setInterval(mind, 200); window.__h = setInterval(beat, 200);
}, hr);

test('detak jantung punya ikon hati: sejajar dan menempel di kiri angka, tampil hanya saat HR ada, dan diam (tidak berdenyut)', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`, { viewport: { width: 1280, height: 549 } });
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('hud-heart')).display), 'none', 'tanpa HR tidak ada ikon');
  await feed(page, 72);
  await page.waitForFunction(() => document.getElementById('hud-hr').textContent !== '');
  const heart = await rectOf(page, 'hud-heart');
  const hr = await rectOf(page, 'hud-hr');
  assert.ok(heart.w > 10 && heart.h > 10, `ikon terlalu kecil: ${heart.w}x${heart.h}`);
  assert.ok(heart.x + heart.w <= hr.x + 0.5, 'ikon di kiri angka');
  assert.ok(hr.x - (heart.x + heart.w) < 16, `ikon terlalu jauh dari angka: ${hr.x - (heart.x + heart.w)}px`);
  assert.ok(Math.abs(heart.y + heart.h / 2 - (hr.y + hr.h / 2)) <= 6, 'sejajar vertikal dengan angka');
  // diam: posisi, ukuran, dan transform sama di setiap sampel selama 2 detik, tanpa animasi
  const samples = [];
  for (let i = 0; i < 6; i++) {
    samples.push(await page.evaluate(() => {
      const h = document.getElementById('hud-heart');
      const cs = getComputedStyle(h);
      const svg = getComputedStyle(h.querySelector('svg'));
      const b = h.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, tf: cs.transform, anim: cs.animationName, svgAnim: svg.animationName, svgTf: svg.transform };
    }));
    await page.waitForTimeout(350);
  }
  assert.equal(new Set(samples.map((s) => JSON.stringify(s))).size, 1, `ikon bergerak: ${JSON.stringify(samples)}`);
  assert.deepEqual([samples[0].tf, samples[0].anim, samples[0].svgAnim, samples[0].svgTf], ['none', 'none', 'none', 'none']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('blok HR di bawah wpm: rata kiri sekolom dengan kata kondisi, satu baris pendek tanpa timer, dan status panjang dibungkus di bawahnya', async () => {
  const W = 1280;
  const k = W / 1920;
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`, { viewport: { width: W, height: 549 } });
  await feed(page, 72);
  await page.waitForFunction(() => document.getElementById('hud-hr').textContent !== '');
  assert.equal(await page.evaluate(() => document.getElementById('hud-timer')), null, 'timer sesi tidak ada di HUD');
  const small = await rectOf(page, 'hud-small');
  const hr = await rectOf(page, 'hud-hr');
  const state = await rectOf(page, 'hud-state');
  const wpm = await rectOf(page, 'hud-wpm');
  assert.ok(Math.abs(small.x - state.x) <= 1 && Math.abs(wpm.x - state.x) <= 1, `blok HR sekolom dengan kata kondisi dan wpm: ${small.x}, ${wpm.x}, ${state.x}`);
  assert.ok(small.y >= wpm.y + wpm.h - 1, `blok HR di bawah wpm: ${small.y} vs ${wpm.y + wpm.h}`);
  const heart = await rectOf(page, 'hud-heart');
  assert.ok(heart.x + heart.w <= hr.x + 1 && Math.abs(small.x - heart.x) <= 1, 'ikon hati di kiri, lalu angka HR');
  assert.ok(small.h <= 1.3 * 28 * k + 2, `blok harus satu baris setinggi teks HR: tinggi ${small.h}px`);
  assert.equal(await page.evaluate(() => document.getElementById('hud-contact')), null, 'indikator sensor tidak ada di HUD (ada di otak)');
  assert.ok(small.w < 0.11 * W, `blok terlalu lebar: ${small.w}px dari ${W}px (baris lama sekitar ${Math.round(193)}px)`);
  // status panjang tidak boleh melebar: dibungkus jadi dua baris
  await page.evaluate(() => { clearInterval(window.__m); clearInterval(window.__h); const beat = () => window.__typewave.emit('headset', { state: 'reconnecting', attempt: 2 }); beat(); window.__h = setInterval(beat, 200); });
  await page.waitForFunction(() => document.getElementById('hud-status').textContent.startsWith('menyambung ulang'));
  const status = await rectOf(page, 'hud-status');
  assert.ok(status.w <= 245 * k + 1, `status terlalu lebar: ${status.w}px`); // sekitar 240 px pada skala 1: lebih sempit daripada kata kondisi terlebar (neutral, sekitar 374 px)
  assert.ok(Math.abs(status.x - state.x) <= 1, 'status rata kiri sekolom');
  assert.ok(status.h > 1.8 * 28 * k, `status panjang harus dibungkus jadi beberapa baris: tinggi ${status.h}px`);
  const small2 = await rectOf(page, 'hud-small');
  assert.ok(status.y >= small2.y + small2.h - 1, `status menimpa blok HR: status.y ${status.y}, blok bawah ${small2.y + small2.h}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('angka di HUD berlebar tetap (tabular): detak jantung dan wpm tidak bergoyang melebar-menyempit saat angkanya berganti', async () => {
  const { page, errors } = await openPage(browser, `${bridge.base}/?debug=1&lang=id`, { viewport: { width: 1280, height: 549 } });
  // lebar tiap angka 0..9 dalam konteks HUD: semuanya harus sama
  const digits = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    return [...'0123456789'].map((d) => {
      const s = document.createElement('span');
      s.textContent = d.repeat(4);
      s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:28px';
      hud.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return Math.round(w * 100) / 100;
    });
  });
  assert.ok(Math.max(...digits) - Math.min(...digits) < 0.01, `lebar angka berbeda-beda: ${JSON.stringify(digits)}`);
  // dan pada elemen sungguhan: nilai dengan jumlah digit sama harus sama lebar (angka 1 dan 7 biasanya lebih sempit); rentang HR yang diterima halaman 20..250
  for (const group of [[111, 177, 188, 171], [77, 88, 71, 99]]) {
    const widths = [];
    for (const hr of group) {
      await feed(page, hr);
      await page.waitForFunction((h) => document.getElementById('hud-hr').textContent === `${h} bpm`, hr, { timeout: 15000 });
      widths.push((await rectOf(page, 'hud-hr')).w);
    }
    assert.ok(Math.max(...widths) - Math.min(...widths) < 0.01, `lebar teks HR berubah mengikuti angkanya ${JSON.stringify(group)}: ${JSON.stringify(widths)}`);
  }
  assert.deepEqual(errors, []);
  await page.close();
});
