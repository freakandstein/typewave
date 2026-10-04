import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeom, stageRect, wideRatio } from '../../src/render/scene.js';
import { CONFIG } from '../../src/config.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('stageRect: panggung wide 21:9 (bawaan) atau rasio pilihan, tall 9:16, selalu terpusat di jendela', () => {
  assert.deepEqual(stageRect('wide', 1920, 1080), { x: 0, y: 128, w: 1920, h: 823 }); // 21:9: tinggi 24% lebih pendek daripada 16:9
  assert.deepEqual(stageRect('wide', 1920, 1080, 'contain', 16 / 9), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.deepEqual(stageRect('wide', 1920, 1080, 'contain', 3), { x: 0, y: 220, w: 1920, h: 640 });
  assert.deepEqual(stageRect('wide', 720, 1280), { x: 0, y: 485, w: 720, h: 309 }); // jendela potret: bingkai horizontal utuh di tengah
  assert.deepEqual(stageRect('wide', 3000, 1000), { x: 333, y: 0, w: 2333, h: 1000 }); // jendela sangat lebar: bilah di kiri dan kanan
  assert.deepEqual(stageRect('tall', 1080, 1920), { x: 0, y: 0, w: 1080, h: 1920 });
  assert.deepEqual(stageRect('tall', 1920, 1080), { x: 656, y: 0, w: 608, h: 1080 });
  assert.deepEqual(stageRect('tall', 1920, 1080, 'contain', 3), { x: 656, y: 0, w: 608, h: 1080 }, 'rasio hanya untuk wide');
});

test('wideRatio: bawaan 21:9 (16:9 bila siluet keyboard menyala), rasio pilihan dijepit ke 16:9..3:1', () => {
  assert.equal(wideRatio(null, false), 21 / 9);
  assert.equal(wideRatio(null, true), 16 / 9);
  assert.equal(wideRatio(2.5, false), 2.5);
  assert.equal(wideRatio(10, false), 3);
  assert.equal(wideRatio(1, false), 16 / 9);
});

test('stageRect: tidak pernah melebihi jendela, rasio tepat, dan terpusat, untuk bentuk jendela dan rasio apa pun', () => {
  for (const [layout, ratio] of [['wide', undefined], ['wide', 16 / 9], ['wide', 3], ['tall', undefined]]) {
    const aspect = layout === 'tall' ? 9 / 16 : (ratio ?? 21 / 9);
    for (const [ww, wh] of [[1, 1], [100, 700], [1366, 768], [1512, 860], [1000, 1000], [640, 1136], [2560, 400], [37, 5], [1920, 1080], [1080, 1920]]) {
      const r = stageRect(layout, ww, wh, 'contain', ratio);
      assert.ok(r.w >= 1 && r.h >= 1, `${layout} ${ratio} ${ww}x${wh}: ukuran positif`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= ww && r.y + r.h <= wh, `${layout} ${ratio} ${ww}x${wh}: di dalam jendela ${JSON.stringify(r)}`);
      if (r.w > 40 && r.h > 40) assert.ok(Math.abs(r.w / r.h - aspect) < 0.04, `${layout} ${ratio} ${ww}x${wh}: rasio ${r.w / r.h}`);
      assert.ok(Math.abs(r.x - (ww - r.w - r.x)) <= 1 && Math.abs(r.y - (wh - r.h - r.y)) <= 1, `${layout} ${ratio} ${ww}x${wh}: terpusat`);
    }
  }
});

test('stageRect fit=fill: memenuhi jendela apa adanya (perilaku lama)', () => {
  assert.deepEqual(stageRect('wide', 720, 1280, 'fill'), { x: 0, y: 0, w: 720, h: 1280 });
  assert.deepEqual(stageRect('tall', 1920, 1080, 'fill'), { x: 0, y: 0, w: 1920, h: 1080 });
});

test('wide ringkas di 16:9 persis sama dengan tata letak lama', () => {
  const a = createGeom(1920, 1080, 'wide');
  const b = createGeom(1920, 1080, 'wide', undefined, false, true);
  for (const key of ['k', 'center', 'spawnC', 'L', 'A']) assert.ok(near(a[key], b[key], 1e-6), key);
  assert.ok(near(a.brain.cx, b.brain.cx, 1e-6) && near(a.brain.cy, b.brain.cy, 1e-6) && near(a.brain.h, b.brain.h, 1e-6));
});

test('wide ringkas di 21:9: skala dari lebar (elemen tetap seukuran), otak penuh, pita naik supaya ruang kosong di bawah hilang', () => {
  const g = createGeom(1920, 823, 'wide', undefined, false, true);
  assert.equal(g.k, 1);
  assert.ok(near(g.brain.h, 300) && near(g.brain.cy, 183.6, 1e-6) && near(g.brain.cx, 960));
  assert.ok(near(g.spawnC, 334.8, 1e-6));
  assert.ok(near(g.center, 623, 1e-6)); // 200 px dari dasar: cukup untuk simpangan terbesar pita
  assert.ok(near(createGeom(1280, 549, 'wide', undefined, false, true).k, 1280 / 1920, 1e-9), 'k mengikuti lebar, bukan sisi pendek');
});

test('wide ringkas di rasio 16:9..3:1: pita selalu muat di bawah, tidak menabrak otak, dan bead punya jarak jatuh', () => {
  for (const ratio of [16 / 9, 2, 21 / 9, 2.5, 3]) {
    const H = Math.round(1920 / ratio);
    const g = createGeom(1920, H, 'wide', undefined, false, true);
    const reach = (CONFIG.ribbon.amp[1] + CONFIG.ribbon.thickness[1] / 2) * g.k; // simpangan terbesar pita dari garis tengahnya
    assert.ok(H - g.center >= reach + 24 * g.k - 1e-6, `${ratio}: ruang di bawah pita ${H - g.center} < ${reach + 24}`);
    assert.ok(g.center - reach >= g.brain.cy + g.brain.h / 2 - 1e-6, `${ratio}: pita menabrak otak`);
    assert.ok(g.center - g.spawnC >= 100 * g.k - 1e-6, `${ratio}: jarak jatuh bead ${g.center - g.spawnC}`);
    assert.ok(g.brain.cy - g.brain.h / 2 >= 0, `${ratio}: otak keluar dari atas bingkai`);
  }
});

test('wide tanpa keyboard visual (default): x=s, y=c, skala 1, pita di 58% tinggi dan bead jatuh dari 31%', () => {
  const g = createGeom(1920, 1080, 'wide');
  assert.equal(g.L, 1920); assert.equal(g.A, 1080); assert.equal(g.k, 1); assert.equal(g.tall, false);
  assert.equal(g.x(100, 200), 100); assert.equal(g.y(100, 200), 200);
  assert.ok(near(g.center, 0.58 * 1080)); assert.ok(near(g.spawnC, 0.31 * 1080));
});

test('wide dengan keyboard visual (?keyboard=1): tata letak lama, pita 50% dan spawn 25%', () => {
  const g = createGeom(1920, 1080, 'wide', undefined, true);
  assert.equal(g.center, 540); assert.equal(g.spawnC, 270);
});

test('tall tidak bergantung pada keyboard visual', () => {
  const a = createGeom(1080, 1920, 'tall');
  const b = createGeom(1080, 1920, 'tall', undefined, true);
  assert.ok(near(a.center, b.center) && near(a.spawnC, b.spawnC));
});

test('tall: x=c, y=L-s (mengalir ke atas), skala memakai sisi pendek', () => {
  const g = createGeom(1080, 1920, 'tall');
  assert.equal(g.L, 1920); assert.equal(g.A, 1080); assert.equal(g.k, 1); assert.equal(g.tall, true);
  assert.equal(g.x(100, 200), 200); assert.equal(g.y(0, 200), 1920); assert.equal(g.y(1920, 200), 0);
  assert.ok(near(g.center, 453.6)); assert.ok(near(g.spawnC, 129.6));
});

test('flip (rtl) membalik arah aliran pada kedua layout', () => {
  const w = createGeom(1920, 1080, 'wide', 'rtl');
  assert.equal(w.x(0, 5), 1920); assert.equal(w.x(1920, 5), 0);
  const t = createGeom(1080, 1920, 'tall', 'rtl');
  assert.equal(t.y(0, 5), 0); assert.equal(t.y(1920, 5), 1920);
});

test('skala mengikuti sisi pendek', () => {
  assert.equal(createGeom(960, 540, 'wide').k, 0.5);
  assert.equal(createGeom(2160, 3840, 'tall').k, 2);
});

test('g.brain wide: di atas tengah (50% lebar, pusat 17% tinggi, tinggi 300 px pada skala 1) dan ikut skala', () => {
  const g = createGeom(1920, 1080, 'wide');
  assert.ok(near(g.brain.cx, 960)); assert.ok(near(g.brain.cy, 0.17 * 1080)); assert.ok(near(g.brain.h, 300));
  const s = createGeom(1280, 720, 'wide');
  assert.ok(near(s.brain.h, 300 * s.k)); assert.ok(near(s.brain.cy, 0.17 * 720));
});

test('g.brain wide dengan keyboard visual: naik dan mengecil supaya tidak menabrak titik jatuh bead', () => {
  const a = createGeom(1920, 1080, 'wide');
  const b = createGeom(1920, 1080, 'wide', undefined, true);
  assert.ok(b.brain.h < a.brain.h && b.brain.cy < a.brain.cy);
});

test('g.brain tall: di atas, di kanan kolom HUD, tidak bergantung pada keyboard visual', () => {
  const a = createGeom(1080, 1920, 'tall');
  const b = createGeom(1080, 1920, 'tall', undefined, true);
  assert.ok(near(a.brain.cx, 0.64 * 1080)); assert.ok(near(a.brain.cy, 0.19 * 1920)); assert.ok(near(a.brain.h, 280));
  assert.deepEqual(a.brain, b.brain);
});
