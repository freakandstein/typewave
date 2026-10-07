import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONFIG } from '../../src/config.js';
import { createGeom } from '../../src/render/scene.js';
import { brainRect } from '../../src/render/brain.js';
import { freePort, startBridge, launch, openPage } from './helpers.mjs';

let bridge, browser;
before(async () => { bridge = await startBridge(await freePort()); browser = await launch(); });
after(async () => { await browser?.close(); await bridge?.stop(); });

const url = (q = '') => `${bridge.base}/?debug=1${q}`;
const WIDE = { width: 1280, height: 549 }; // = bingkai 21:9 bawaan pada lebar 1280, jadi bingkai persis memenuhi jendela
const TALL = { width: 720, height: 1280 };
// Kotak otak pada bingkai WIDE: halaman memakai tata letak ringkas (createGeom dengan compact), jadi tes memakai yang sama; satu tes memastikan kecocokannya dengan halaman.
const WIDE_BOX = brainRect(createGeom(WIDE.width, WIDE.height, 'wide', undefined, false, true));
const state = (page) => page.evaluate(() => window.__typewave.state());
const pixel = (page, x, y) => page.evaluate(([px, py]) => {
  const d = document.getElementById('scene').getContext('2d').getImageData(px, py, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}, [Math.round(x), Math.round(y)]);
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('?sim=1 terbuka tanpa error konsol, dengan bridge maupun ?ws=off; ketik otomatis memunculkan bead', async () => {
  for (const q of ['&sim=1', '&sim=1&ws=off']) {
    const { page, errors } = await openPage(browser, url(q), { viewport: WIDE, waitHello: !q.includes('ws=off') });
    await page.evaluate(() => window.__typewave.setAuto(true));
    await page.waitForTimeout(1500);
    const s = await state(page);
    assert.ok(s.beadsActive > 0, `beadsActive ${s.beadsActive} (${q})`);
    assert.deepEqual(errors, [], q);
    await page.close();
  }
});

test('warna ground dan ink pada pos 0.1/0.5/0.9 cocok dengan token spec, wide dan tall; screenshot disimpan untuk review', async () => {
  // ground = token ground; ink = token ink, dibaca dari pita yang dibuat tebal (mengetik cepat) tepat di kepalanya (alpha ~1).
  const anchors = {
    0.1: { ground: [15, 43, 51], ink: [142, 216, 208] },
    0.5: { ground: [45, 33, 18], ink: [242, 178, 78] },
    0.9: { ground: [43, 15, 30], ink: [255, 94, 114] },
  };
  fs.mkdirSync('test-results', { recursive: true });
  const layouts = [
    ['wide', WIDE, (w, h) => [0.5 * w, 0.97 * h], (w, h, st) => [2, st.center - 130, 42, 260]],
    ['tall', TALL, (w, h) => [0.92 * w, 0.5 * h], (w, h) => [0.42 * w - 130, h - 60, 260, 58]],
  ];
  for (const [layout, vp, groundAt, headRegion] of layouts) {
    for (const [pos, expect] of Object.entries(anchors)) {
      const { page } = await openPage(browser, url(`&ws=off&layout=${layout}`), { viewport: vp, waitHello: false });
      await page.evaluate((p) => {
        window.__typewave.setMind({ pos: p, hr: 60, q: 1 });
        let i = 0;
        window.__burst = setInterval(() => window.__typewave.press(['KeyA', 'KeyS', 'KeyD', 'KeyF'][i++ % 4]), 70);
      }, Number(pos));
      await page.waitForTimeout(3600);
      const [x, y] = groundAt(vp.width, vp.height);
      const px = await pixel(page, x, y);
      assert.ok(near(px.slice(0, 3), expect.ground, 4), `${layout} pos ${pos} ground: ${px} vs ${expect.ground}`);
      assert.equal(px[3], 255);
      const [rx, ry, rw, rh] = headRegion(vp.width, vp.height, await state(page)).map(Math.round);
      const ink = await page.evaluate(([X, Y, W, H, g]) => {
        const d = document.getElementById('scene').getContext('2d').getImageData(X, Y, W, H).data;
        let best = null, bd = -1;
        for (let i = 0; i < d.length; i += 4) {
          const dist = Math.hypot(d[i] - g[0], d[i + 1] - g[1], d[i + 2] - g[2]);
          if (dist > bd) { bd = dist; best = [d[i], d[i + 1], d[i + 2]]; }
        }
        return best;
      }, [rx, ry, rw, rh, expect.ground]);
      assert.ok(near(ink, expect.ink, 24), `${layout} pos ${pos} ink: ${ink} vs ${expect.ink}`);
      await page.evaluate(() => clearInterval(window.__burst));
      await page.screenshot({ path: `test-results/${layout}-pos${pos}.png` });
      await page.close();
    }
  }
});

test('perubahan pos halus: tanpa lompat dan tanpa overshoot', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => window.__typewave.setMind({ pos: 0.1 }));
  await page.waitForTimeout(2500);
  const n0 = (await page.evaluate(() => window.__typewave.posTrace())).length;
  await page.evaluate(() => window.__typewave.setMind({ pos: 0.9 }));
  await page.waitForTimeout(2400);
  const seg = (await page.evaluate(() => window.__typewave.posTrace())).slice(n0);
  assert.ok(seg.length > 60, 'frame terlalu sedikit: ' + seg.length);
  let maxStep = 0, minStep = 0;
  for (let i = 1; i < seg.length; i++) { const d = seg[i] - seg[i - 1]; maxStep = Math.max(maxStep, d); minStep = Math.min(minStep, d); }
  assert.ok(maxStep < 0.05, 'lompat ' + maxStep);
  assert.ok(minStep > -1e-3, 'mundur ' + minStep);
  assert.ok(Math.max(...seg) <= 0.9 + 0.005);
  assert.ok(Math.abs(seg.at(-1) - 0.9) < 0.02);
  await page.close();
});

test('idle 3 s dan noSignal 5 s: ground turun ke Batu', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  assert.equal((await state(page)).noSignal, true);
  await page.evaluate(() => { window.__typewave.setMind({ pos: 0.5 }); window.__typewave.press('KeyA'); });
  await page.waitForTimeout(300);
  let s = await state(page);
  assert.equal(s.noSignal, false); assert.equal(s.idle, false);
  await page.waitForTimeout(3100);
  assert.equal((await state(page)).idle, true);
  await page.waitForTimeout(2200);
  assert.equal((await state(page)).noSignal, true);
  await page.waitForTimeout(3500);
  const px = await pixel(page, 0.5 * WIDE.width, 0.97 * WIDE.height);
  assert.ok(near(px.slice(0, 3), [42, 45, 49], 5), String(px));
  await page.close();
});

test('setiap jenis tombol menghasilkan reaksi sendiri: char, mundur, space, neutral, sapuan Enter', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => {
    for (const c of ['KeyA', 'Backspace', 'Space', 'Enter', 'ShiftLeft', 'ArrowUp']) window.__typewave.press(c);
    window.__typewave.press('KeyB', { rep: true });
  });
  await page.waitForTimeout(100);
  const s = await state(page);
  assert.deepEqual(s.beadKinds, { char: 1, neutral: 2, rep: 1, back: 1, space: 1 });
  assert.equal(s.sweeps, 1);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__typewave.press('Enter', { rep: true }); });
  assert.equal((await state(page)).sweeps, 1, 'Enter ditahan (auto-repeat) tidak boleh memicu sapuan berulang');
  assert.deepEqual(errors, []);
  await page.close();
});

test('tall: HUD berada di dalam safe zone (kanan 15%, bawah 20%, atas 10%)', async () => {
  const vp = { width: 540, height: 960 };
  const { page } = await openPage(browser, url('&ws=off&layout=tall'), { viewport: vp, waitHello: false });
  await page.evaluate(() => { window.__typewave.setMind({ pos: 0.5, hr: 70 }); window.__typewave.press('KeyA'); });
  await page.waitForTimeout(600);
  const rects = await page.evaluate(() => ['hud-state', 'hud-wpm', 'hud-small', 'hud-status'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { id, top: r.top, right: r.right, bottom: r.bottom };
  }));
  for (const r of rects) {
    assert.ok(r.right <= 0.85 * vp.width + 0.5, `${r.id} kanan ${r.right}`);
    assert.ok(r.bottom <= 0.8 * vp.height, `${r.id} bawah ${r.bottom}`);
    assert.ok(r.top >= 0.1 * vp.height - 0.5, `${r.id} atas ${r.top}`);
  }
  await page.close();
});

test('transparent=1 menghilangkan ground; lang=id mengganti label', async () => {
  const t = await openPage(browser, url('&ws=off&transparent=1'), { viewport: WIDE, waitHello: false });
  await t.page.waitForTimeout(500);
  assert.equal((await pixel(t.page, 0.5 * WIDE.width, 0.97 * WIDE.height))[3], 0);
  assert.equal(await t.page.evaluate(() => document.documentElement.classList.contains('transparent')), true);
  await t.page.close();
  const { page } = await openPage(browser, url('&ws=off&lang=id'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => window.__typewave.setMind({ pos: 0.1 }));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#hud-state').textContent(), 'tenang');
  await page.evaluate(() => window.__typewave.setMind({ pos: 0.5 }));
  await page.waitForTimeout(2800);
  assert.equal(await page.locator('#hud-state').textContent(), 'netral');
  await page.close();
});

test('font Anybody dimuat dan sumbu wdth benar-benar bekerja (variable font)', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  const w = await page.evaluate(async () => {
    await document.fonts.load('400 40px Anybody');
    const mk = (wd) => {
      const s = document.createElement('span');
      s.textContent = 'flowflowflow';
      s.style.cssText = `position:absolute;left:-9999px;font:40px Anybody;font-variation-settings:"wdth" ${wd},"wght" 400`;
      document.body.appendChild(s);
      const r = s.getBoundingClientRect().width;
      s.remove();
      return r;
    };
    return { loaded: document.fonts.check('40px Anybody'), narrow: mk(70), wide: mk(130) };
  });
  assert.equal(w.loaded, true);
  assert.ok(w.wide > w.narrow * 1.25, `${w.narrow} vs ${w.wide}`);
  await page.close();
});

test('resize dan layout=auto: geometri dibangun ulang tanpa error, pita terisi lagi', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&layout=auto'), { viewport: WIDE, waitHello: false });
  assert.equal((await state(page)).layout, 'wide');
  await page.setViewportSize(TALL);
  await page.waitForTimeout(400);
  let s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['tall', 720, 1280]);
  const inked = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const d = c.getContext('2d').getImageData(Math.round(0.42 * c.width), 0, 1, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) n++;
    return n;
  });
  assert.ok(inked > 100, 'pita tidak terlihat: ' + inked);
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(400);
  s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', WIDE.width, WIDE.height]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('tanpa ?layout= di jendela potret: bingkai horizontal 21:9 utuh di tengah, bilah hitam di atas dan bawah, semua elemen di dalam bingkai', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: TALL, waitHello: false });
  const s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', 720, 309]);
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  assert.deepEqual(box, [0, 485, 720, 309]);
  const who = (x, y) => page.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); return e ? e.id || e.tagName : null; }, [x, y]);
  assert.equal(await who(360, 100), 'BODY', 'bilah atas bukan bagian bingkai');
  assert.equal(await who(360, 1100), 'BODY', 'bilah bawah bukan bagian bingkai');
  assert.equal(await who(360, 640), 'scene', 'tengah adalah bingkai');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)', 'bilah hitam');
  assert.ok(s.brain.x0 >= 0 && s.brain.y0 >= 0 && s.brain.x0 + s.brain.w <= s.W && s.brain.y0 + s.brain.h <= s.H, 'otak di dalam bingkai');
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#hud *')].filter((e) => e.getBoundingClientRect().width > 0 && (e.textContent || '').trim())
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
  for (const b of boxes) assert.ok(b.x >= box[0] && b.y >= box[1] && b.r <= box[0] + box[2] && b.b <= box[1] + box[3], `${b.id} keluar dari bingkai`);
  const [bx, by] = [box[0] + s.brain.x0, box[1] + s.brain.y0];
  for (const b of boxes.filter((x) => x.id !== 'hud-debug')) assert.ok(b.r <= bx || b.x >= bx + s.brain.w || b.b <= by || b.y >= by + s.brain.h, `${b.id} menabrak otak`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('bingkai bawaan 21:9 di jendela 16:9: tinggi 24% lebih pendek, bilah di atas dan bawah; ?ratio=16:9 mengembalikan tinggi penuh dengan tata letak 16:9', async () => {
  const win = { width: 1280, height: 720 };
  const a = await openPage(browser, url('&ws=off'), { viewport: win, waitHello: false });
  let s = await state(a.page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', 1280, 549]);
  assert.deepEqual(await a.page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }), [0, 85, 1280, 549]);
  assert.deepEqual(a.errors, []);
  await a.page.close();
  const b = await openPage(browser, url('&ws=off&ratio=16:9'), { viewport: win, waitHello: false });
  s = await state(b.page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', 1280, 720]);
  assert.ok(Math.abs(s.center - 0.58 * 720) < 0.5 && Math.abs(s.spawnC - (384.8 / 1080) * 720) < 0.5, `tata letak 16:9: pita ${s.center}, bead ${s.spawnC}`);
  await b.page.close();
});

test('?ratio=3:1 (terpendek): otak mengecil tetapi tetap di dalam bingkai, HUD tidak menabrak otak, dan pita tidak pernah keluar dari bawah bingkai', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&ratio=3:1'), { viewport: { width: 1200, height: 400 }, waitHello: false });
  const s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', 1200, 400]);
  assert.ok(s.brain.y0 >= 0 && s.brain.y0 + s.brain.h <= s.H && s.brain.x0 >= 0 && s.brain.x0 + s.brain.w <= s.W, 'otak di dalam bingkai');
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#hud *')].filter((e) => e.getBoundingClientRect().width > 0 && (e.textContent || '').trim() && !e.classList.contains('hud-debug'))
    .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
  for (const b of boxes) assert.ok(b.r <= s.brain.x0 || b.x >= s.brain.x0 + s.brain.w || b.b <= s.brain.y0 || b.y >= s.brain.y0 + s.brain.h, `${b.id} menabrak otak`);
  await page.evaluate(() => { window.__typewave.setMind({ pos: 0.9, hr: 80, q: 1 }); let i = 0; window.__burst = setInterval(() => window.__typewave.press(['KeyA', 'KeyS', 'KeyD', 'KeyF'][i++ % 4]), 60); });
  await page.waitForTimeout(4200); // ketikan cepat dan tegang: simpangan pita terbesar
  const bottom = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const d = c.getContext('2d').getImageData(0, c.height - 6, c.width, 6).data;
    const g = [d[0], d[1], d[2]];
    let off = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - g[0]) + Math.abs(d[i + 1] - g[1]) + Math.abs(d[i + 2] - g[2]) > 24) off++;
    return off;
  });
  assert.equal(bottom, 0, 'ada gambar di 6 baris piksel paling bawah: pita keluar dari bingkai');
  assert.deepEqual(errors, []);
  await page.close();
});

test('?fit=fill: jendela diisi penuh seperti dulu (tanpa bilah)', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&layout=wide&fit=fill'), { viewport: TALL, waitHello: false });
  const s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['wide', 720, 1280]);
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  assert.deepEqual(box, [0, 0, 720, 1280]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('jendela tinggi dengan ?layout=tall tetap 9:16 utuh, dan jendela lebar dengan ?layout=tall diberi bilah kiri-kanan', async () => {
  const { page } = await openPage(browser, url('&ws=off&layout=tall'), { viewport: { width: 1280, height: 720 }, waitHello: false });
  const s = await state(page);
  assert.deepEqual([s.layout, s.W, s.H], ['tall', 405, 720]);
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  assert.deepEqual(box, [437, 0, 405, 720]);
  await page.close();
});

test('kartu laporan mengikuti bingkai, bukan seluruh jendela', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: TALL, waitHello: false });
  await page.keyboard.press('KeyR');
  assert.equal((await state(page)).reportVisible, true);
  const r = await page.evaluate(() => { const c = document.getElementById('report'); const b = c.getBoundingClientRect(); return { cw: c.width, ch: c.height, box: [b.x, b.y, b.width, b.height] }; });
  assert.deepEqual([r.cw, r.ch], [720, 309]);
  assert.deepEqual(r.box, [0, 485, 720, 309]);
  await page.close();
});

test('halaman tersembunyi lalu muncul lagi (stall 30 s): dt di-clamp, nilai tetap finite', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => { window.__typewave.setMind({ pos: 0.4, hr: 65 }); window.__typewave.press('KeyA'); window.__typewave.simulateStall(30000); });
  await page.waitForTimeout(300);
  const s = await state(page);
  assert.ok(s.maxRawGap >= 29, 'stall tidak terjadi: ' + s.maxRawGap);
  assert.ok(s.maxDt <= 0.05 + 1e-9, 'dt tidak di-clamp: ' + s.maxDt);
  assert.ok([s.pos, s.wpm, s.density].every(Number.isFinite));
  assert.deepEqual(errors, []);
  await page.close();
});

test('panel simulator: slider pos lewat page.fill, ketik otomatis lewat klik, mematikan mind menghasilkan noSignal', async () => {
  const { page } = await openPage(browser, url('&sim=1&ws=off'), { viewport: WIDE, waitHello: false });
  assert.equal(await page.locator('#panel.on').count(), 1);
  await page.locator('#sim-pos').fill('0.9');
  await page.waitForTimeout(3000);
  assert.ok(Math.abs((await state(page)).rawPos - 0.9) < 0.011);
  const before = await page.evaluate(() => window.__typewave.stats.keysReceived);
  await page.locator('#sim-auto').click();
  await page.waitForTimeout(2500);
  assert.ok((await page.evaluate(() => window.__typewave.stats.keysReceived)) - before >= 5);
  await page.locator('#sim-auto').click();
  await page.locator('#sim-mind').uncheck();
  await page.waitForTimeout(5600);
  assert.equal((await state(page)).noSignal, true);
  await page.close();
});

test('browserkeys: tidak terhitung dobel saat bridge melaporkan listener global', async () => {
  const { page } = await openPage(browser, url('&sim=1&ws=off'), { viewport: WIDE, waitHello: false });
  const count = () => page.evaluate(() => window.__typewave.stats.keysReceived);
  await page.keyboard.press('KeyA');
  assert.equal(await count(), 1);
  await page.evaluate(() => window.__typewave.emit('hello', { keys: true }));
  await page.keyboard.press('KeyA');
  assert.equal(await count(), 1);
  await page.evaluate(() => window.__typewave.emit('hello', { keys: false }));
  await page.keyboard.press('KeyA');
  assert.equal(await count(), 2);
  await page.close();
});

test('gelombang mengikuti tenang ↔ tegang: pita tegang jauh lebih rapat daripada pita tenang', async () => {
  const oscillations = async (pos) => {
    const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
    await page.evaluate((p) => {
      window.__typewave.setMind({ pos: p, hr: 60, q: 1 });
      let i = 0;
      window.__burst = setInterval(() => window.__typewave.press(['KeyA', 'KeyS', 'KeyD', 'KeyF'][i++ % 4]), 70);
    }, pos);
    await page.waitForTimeout(7000); // ketik cepat supaya pita bergeser penuh dan terisi bentuk yang baru
    const line = await page.evaluate(() => window.__typewave.ribbonCenterline());
    await page.close();
    const recent = line.slice(0, Math.floor(line.length * 0.6));
    let n = 0, prev = 0;
    for (const c of recent) { const sg = Math.sign(c); if (sg !== 0 && prev !== 0 && sg !== prev) n++; if (sg !== 0) prev = sg; }
    return n;
  };
  const calm = await oscillations(0.05);
  const tense = await oscillations(0.95);
  assert.ok(tense >= 2 * calm && tense >= 8, `tenang ${calm} osilasi vs tegang ${tense}`);
});

test('tanpa keyboard visual secara default; ?keyboard=1 menampilkan siluetnya lagi', async () => {
  const deviation = async (query) => {
    const { page } = await openPage(browser, url(`&ws=off${query}`), { viewport: WIDE, waitHello: false });
    await page.waitForTimeout(800);
    const max = await page.evaluate(() => {
      const c = document.getElementById('scene');
      const ctx = c.getContext('2d');
      const ref = ctx.getImageData(Math.round(c.width * 0.03), Math.round(c.height * 0.3), 1, 1).data;
      const d = ctx.getImageData(Math.round(c.width * 0.12), Math.round(c.height * 0.8), Math.round(c.width * 0.76), Math.round(c.height * 0.18)).data;
      let m = 0;
      for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]));
      return m;
    });
    await page.close();
    return max;
  };
  assert.ok((await deviation('')) < 3, 'siluet keyboard tidak boleh tampil secara default');
  assert.ok((await deviation('&keyboard=1')) > 12, '?keyboard=1 harus menampilkan siluet');
});

test('ilustrasi otak tampil di atas tengah dengan warna sesuai grade; ?brain=0 menyembunyikannya', async () => {
  const R = WIDE_BOX;
  const scan = async (query, pos) => {
    const { page } = await openPage(browser, url(`&ws=off${query}`), { viewport: WIDE, waitHello: false });
    await page.evaluate((p) => window.__typewave.setMind({ pos: p, hr: 70, q: 0.9 }), pos);
    await page.waitForTimeout(3600);
    const r = await page.evaluate(([x0, y0, w, h]) => {
      const c = document.getElementById('scene');
      const ctx = c.getContext('2d');
      const ref = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.97), 1, 1).data;
      const d = ctx.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
      let best = 0; let bi = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const dev = Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]);
        if (dev > 25) n++;
        if (dev > best) { best = dev; bi = i; }
      }
      return { best, n, px: [d[bi], d[bi + 1], d[bi + 2]] };
    }, [R.x0, R.y0, R.w, R.h]);
    await page.close();
    return r;
  };
  const calm = await scan('', 0.1);
  assert.ok(calm.n > 300, `piksel garis ${calm.n}`);
  assert.ok(calm.px[2] - calm.px[0] > 20, `tenang harus kehijauan: ${calm.px}`);
  const tense = await scan('', 0.92);
  assert.ok(tense.px[0] - tense.px[2] > 40, `tegang harus kemerahan: ${tense.px}`);
  const off = await scan('&brain=0', 0.5);
  assert.ok(off.n === 0 && off.best < 3, `?brain=0 harus kosong: ${off.n} ${off.best}`);
});

test('percikan otak: satu per ketikan, repeat dibatasi, kapasitas terjaga; ?brain=0 tanpa otak', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  assert.equal((await state(page)).brain.sparks, 0);
  // tiap ketikan dan pembacaan jumlah percikan dalam satu panggilan: tanpa frame di antaranya, jadi percikan yang kebetulan mulai di ujung garis belum habis
  const sparksAfter = (keys, opts = {}) => page.evaluate(([list, o]) => { for (const c of list) window.__typewave.press(c, o); return window.__typewave.state().brain.sparks; }, [keys, opts]);
  assert.equal(await sparksAfter(['KeyA', 'KeyS', 'KeyD']), 3);
  const afterRepeat = await sparksAfter(Array(40).fill('KeyG'), { rep: true });
  const extra = afterRepeat - 3;
  assert.ok(extra >= 1 && extra <= CONFIG.beads.rep.perSec, `repeat menambah ${extra}`);
  assert.ok((await sparksAfter(Array.from({ length: 400 }, (_, i) => ['KeyQ', 'KeyP', 'Space'][i % 3]))) <= CONFIG.brain.spark.cap);
  assert.deepEqual(errors, []);
  await page.close();
  const off = await openPage(browser, url('&ws=off&brain=0'), { viewport: WIDE, waitHello: false });
  await off.page.evaluate(() => window.__typewave.press('KeyA'));
  assert.equal((await state(off.page)).brain, null);
  assert.deepEqual(off.errors, []);
  await off.page.close();
});

test('otak tidak menabrak HUD (wide dan tall) dan berada di dalam safe zone tall', async () => {
  const hit = (a, b) => a.left < b.x0 + b.w && a.right > b.x0 && a.top < b.y0 + b.h && a.bottom > b.y0;
  for (const [layout, vp] of [['wide', WIDE], ['tall', { width: 540, height: 960 }]]) {
    const { page } = await openPage(browser, url(`&ws=off&layout=${layout}`), { viewport: vp, waitHello: false });
    await page.evaluate(() => { window.__typewave.setMind({ pos: 0.5, hr: 70 }); window.__typewave.press('KeyA'); });
    await page.waitForTimeout(700);
    const brain = (await state(page)).brain;
    const rects = await page.evaluate(() => ['hud-state', 'hud-wpm', 'hud-small', 'hud-status'].map((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }));
    for (const r of rects) assert.ok(!hit(r, brain), `${layout}: ${r.id} menabrak otak`);
    assert.ok(brain.x0 >= 0 && brain.y0 >= 0 && brain.x0 + brain.w <= vp.width && brain.y0 + brain.h <= vp.height, `${layout} di dalam kanvas`);
    if (layout === 'tall') {
      assert.ok(brain.y0 >= 0.1 * vp.height - 0.5, `tall atas ${brain.y0}`);
      assert.ok(brain.x0 + brain.w <= 0.85 * vp.width + 0.5, `tall kanan ${brain.x0 + brain.w}`);
    }
    await page.close();
  }
});

test('otak tidak berdenyut: ukuran dan terang garis tetap walau detak jantung terbaca', async () => {
  const R = WIDE_BOX;
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => {
    const T = window.__typewave;
    T.brainSpin(0); // putaran dihentikan dan kondisi tenang (agitasi kecil): yang diukur hanya pengaruh detak jantung
    T.setMind({ pos: 0.05, hr: 120, q: 1 }); // 120 bpm: satu denyut tiap 0,5 detik, jadi 10 sampel mencakup beberapa fase
    window.__mind = setInterval(() => T.setMind({ pos: 0.05, hr: 120, q: 1 }), 250);
  });
  await page.waitForTimeout(1500);
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await page.evaluate(([x0, y0, w, h]) => {
      const c = document.getElementById('scene');
      const ctx = c.getContext('2d');
      const ref = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.97), 1, 1).data;
      const X0 = Math.max(0, Math.round(x0) - 20);
      const Y0 = Math.max(0, Math.round(y0) - 20);
      const W = Math.round(w) + 40;
      const d = ctx.getImageData(X0, Y0, W, Math.round(h) + 40).data;
      let ink = 0; let minX = W; let maxX = -1;
      for (let j = 0; j < d.length; j += 4) {
        const dev = Math.hypot(d[j] - ref[0], d[j + 1] - ref[1], d[j + 2] - ref[2]);
        ink += dev;
        if (dev > 30) { const x = (j / 4) % W; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
      return { ink, width: maxX - minX };
    }, [R.x0, R.y0, R.w, R.h]));
    await page.waitForTimeout(65);
  }
  const widths = samples.map((s) => s.width);
  const inks = samples.map((s) => s.ink);
  const range = (a) => Math.max(...a) - Math.min(...a);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(range(widths) <= 2, `lebar otak berubah ${range(widths)} px: ${widths}`);
  assert.ok(range(inks) / mean(inks) <= 0.04, `terang garis berubah ${(100 * range(inks) / mean(inks)).toFixed(1)}%`);
  await page.close();
});

test('level gelombang EEG sampai ke otak: theta, alpha, beta diikuti dengan halus dan kembali netral bila hilang', async () => {
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => {
    const T = window.__typewave;
    const send = () => T.setMind({ pos: 0.5, hr: 70, q: 1, theta: 1, alpha: 0, beta: 0.2 });
    send();
    window.__mind = setInterval(send, 250);
  });
  await page.waitForTimeout(4200);
  let lv = (await state(page)).brain.levels;
  assert.ok(lv[0] > 0.93 && lv[1] < 0.07 && Math.abs(lv[2] - 0.2) < 0.06, `level ${lv}`);
  await page.evaluate(() => {
    clearInterval(window.__mind);
    const T = window.__typewave;
    window.__mind = setInterval(() => T.setMind({ pos: 0.5, hr: 70, q: 1 }), 250);
  });
  await page.waitForTimeout(5200);
  lv = (await state(page)).brain.levels;
  assert.ok(lv.every((x) => Math.abs(x - 0.5) < 0.06), `harus kembali netral: ${lv}`);
  await page.close();
});

test('level gelombang tinggi menerangkan lipatan otak dan level rendah meredupkannya', async () => {
  const R = WIDE_BOX;
  const ink = async (level) => {
    const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
    await page.evaluate((v) => {
      const T = window.__typewave;
      const send = () => T.setMind({ pos: 0.5, hr: 70, q: 1, theta: v, alpha: v, beta: v });
      send();
      window.__mind = setInterval(send, 250);
    }, level);
    await page.waitForTimeout(4200);
    const total = await page.evaluate(([x0, y0, w, h]) => {
      const c = document.getElementById('scene');
      const ctx = c.getContext('2d');
      const ref = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.97), 1, 1).data;
      const d = ctx.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]);
      return s;
    }, [R.x0, R.y0, R.w, R.h]);
    await page.close();
    return total;
  };
  const low = await ink(0);
  const high = await ink(1);
  assert.ok(high > low * 1.25, `terang rendah ${low.toFixed(0)} vs tinggi ${high.toFixed(0)}`);
});

test('?sim=1: slider theta, alpha, beta mengubah level otak', async () => {
  const { page } = await openPage(browser, url('&ws=off&sim=1'), { viewport: WIDE, waitHello: false });
  await page.locator('#sim-theta').fill('1');
  await page.locator('#sim-beta').fill('0');
  await page.waitForTimeout(4200);
  const lv = (await state(page)).brain.levels;
  assert.ok(lv[0] > 0.93 && lv[2] < 0.07 && Math.abs(lv[1] - 0.5) < 0.06, `level ${lv}`);
  await page.close();
});

test('otak berputar terus dengan kecepatan tetap: tidak bergantung pada ketikan, tanpa sinyal, atau kondisi otak', async () => {
  // Kecepatan = perubahan sudut dibagi jumlah selang frame yang dipakai halaman (selang dijepit 50 ms seperti di app.js), diukur dengan probe
  // requestAnimationFrame di dalam halaman; jadi frame yang tersendat tidak membuat tes gagal, hanya kecepatan sebenarnya yang diuji.
  const speed = (page, ms = 1200) => page.evaluate((span) => new Promise((resolve) => {
    let first = null; let last = null; let sum = 0; let y0 = 0;
    const frame = (ts) => {
      const yaw = window.__typewave.state().brain.yaw;
      if (first === null) { first = ts; y0 = yaw; } else sum += Math.min((ts - last) / 1000, 0.05);
      last = ts;
      if (ts - first >= span) { resolve((((yaw - y0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / sum); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), ms);
  const want = CONFIG.brain.spin;
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  const idle = await speed(page); // belum ada sinyal sama sekali
  assert.ok(Math.abs(idle - want) < 0.05 * want, `tanpa sinyal ${idle} rad/s, seharusnya ${want}`);
  await page.evaluate(() => {
    const T = window.__typewave;
    T.setMind({ pos: 0.95, hr: 120, q: 1, theta: 1, alpha: 0, beta: 1 });
    window.__mind = setInterval(() => T.setMind({ pos: 0.95, hr: 120, q: 1, theta: 1, alpha: 0, beta: 1 }), 250);
    let i = 0; window.__burst = setInterval(() => T.press(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'Space'][i++ % 5]), 60);
  });
  await page.waitForTimeout(1500);
  const busy = await speed(page); // tegang, mengetik cepat, level gelombang ekstrem
  assert.ok(Math.abs(busy - want) < 0.05 * want, `tegang dan mengetik ${busy} rad/s, seharusnya ${want}`);
  await page.evaluate(() => { clearInterval(window.__burst); clearInterval(window.__mind); const T = window.__typewave; T.setMind({ pos: 0.05, hr: 55, q: 1 }); window.__mind = setInterval(() => T.setMind({ pos: 0.05, hr: 55, q: 1 }), 250); });
  await page.waitForTimeout(1500);
  const calm = await speed(page);
  assert.ok(Math.abs(calm - want) < 0.05 * want, `tenang ${calm} rad/s, seharusnya ${want}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('otak yang berputar benar-benar berubah di layar dan selalu berada di dalam kotaknya (cincin di luar kotak tetap kosong)', async () => {
  const R = WIDE_BOX;
  const { page } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => { const T = window.__typewave; T.setMind({ pos: 0.5, hr: 70, q: 1 }); window.__mind = setInterval(() => T.setMind({ pos: 0.5, hr: 70, q: 1 }), 250); });
  await page.waitForTimeout(3600);
  const box = (await state(page)).brain;
  assert.ok(Math.abs(box.x0 - R.x0) < 0.5 && Math.abs(box.y0 - R.y0) < 0.5 && Math.abs(box.w - R.w) < 0.5 && Math.abs(box.h - R.h) < 0.5, `kotak di halaman ${JSON.stringify(box)} vs tes ${JSON.stringify(R)}`);
  const ink = (x0, y0, w, h) => page.evaluate(([X, Y, W, H]) => {
    const c = document.getElementById('scene');
    const ctx = c.getContext('2d');
    const ref = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.97), 1, 1).data;
    const d = ctx.getImageData(Math.round(X), Math.round(Y), Math.round(W), Math.round(H)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - ref[0], d[i + 1] - ref[1], d[i + 2] - ref[2]) > 30) n++;
    return n;
  }, [x0, y0, w, h]);
  const pic = () => page.evaluate(([X, Y, W, H]) => Array.from(document.getElementById('scene').getContext('2d').getImageData(Math.round(X), Math.round(Y), Math.round(W), Math.round(H)).data), [R.x0, R.y0, R.w, R.h]);
  const a = await pic();
  let outside = 0;
  for (let i = 0; i < 12; i++) { // seperempat putaran lebih, dengan percikan tidak ada: yang di luar kotak hanya bisa berasal dari otak
    outside += await ink(R.x0 - 12, R.y0 - 12, R.w + 24, 12); // atas
    outside += await ink(R.x0 - 12, R.y0, 12, R.h); // kiri
    outside += await ink(R.x0 + R.w, R.y0, 12, R.h); // kanan
    await page.waitForTimeout(350);
  }
  const b = await pic();
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  assert.ok(diff / (a.length / 4) > 1, `gambar otak hampir tidak berubah dalam ${(12 * 0.35).toFixed(1)} detik: ${(diff / (a.length / 4)).toFixed(2)} per piksel`);
  assert.equal(outside, 0, `${outside} piksel otak di luar kotaknya`);
  await page.close();
});

test('otak tembus pandang: garis sisi belakang ikut tergambar, dan biaya gambarnya kecil', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off&sim=1'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => { window.__typewave.setAuto(true); const T = window.__typewave; T.setMind({ pos: 0.8, hr: 70, q: 1, theta: 0.7, alpha: 0.3, beta: 0.8 }); window.__mind = setInterval(() => T.setMind({ pos: 0.8, hr: 70, q: 1, theta: 0.7, alpha: 0.3, beta: 0.8 }), 250); });
  await page.waitForTimeout(5000);
  const s = (await state(page)).brain;
  assert.ok(s.drawn > 4000, `segmen tergambar ${s.drawn}`);
  assert.ok(s.drawnBack > 0.25 * s.drawn, `sisi belakang tergambar ${s.drawnBack} dari ${s.drawn}: harus tembus pandang`);
  const p = await page.evaluate(() => window.__typewave.perf());
  assert.ok(p.fpsAvg >= 30, `fps ${p.fpsAvg}`); // batas longgar: tes kecepatan sebenarnya ada di perf.test.mjs (opt-in)
  assert.ok(p.drawP95 <= 8, `waktu gambar satu frame (hanya JS) p95 ${p.drawP95} ms (otak 3D, headless tanpa GPU)`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('ukuran jendela berubah: otak dibangun ulang tanpa melompat, sudut putarnya dilanjutkan', async () => {
  const { page, errors } = await openPage(browser, url('&ws=off'), { viewport: WIDE, waitHello: false });
  await page.evaluate(() => { const T = window.__typewave; T.brainSpin(0); T.brainYaw(2.4); });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1000, height: 430 });
  await page.waitForTimeout(400);
  let b = (await state(page)).brain;
  assert.ok(Math.abs(b.yaw - 2.4) < 1e-3, `sudut setelah mengubah ukuran: ${b.yaw}`);
  assert.ok(b.x0 >= 0 && b.x0 + b.w <= 1000 && b.y0 >= 0 && b.y0 + b.h <= 430, 'otak mengikuti ukuran baru');
  await page.evaluate(() => window.__typewave.brainSpin(1));
  await page.waitForTimeout(500);
  b = (await state(page)).brain;
  assert.ok(b.yaw > 2.4 + 0.05, `putaran berlanjut setelah ukuran berubah: ${b.yaw}`);
  assert.deepEqual(errors, []);
  await page.close();
});
