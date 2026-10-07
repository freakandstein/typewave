import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAIN } from '../../src/data/brain.js';
import { decodeBrain, POS_Q, NRM_Q } from '../../src/data/brain-decode.js';
import { viewOf, perspK, projectInto, PITCH } from '../../src/core/orbit.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

test('decodeBrain: posisi Int16 little-endian per 1/32 satuan desain, normal Int8 per 1/100, garis menurut jenis dan jumlah titik', () => {
  const pos = new DataView(new ArrayBuffer(5 * 6));
  [[32, -64, 96], [0, 0, 0], [-32768 / 32, 1, 2], [100, 200, -300], [1, 2, 3]].forEach(([x, y, z], i) => {
    pos.setInt16(i * 6, Math.round(x * POS_Q), true); pos.setInt16(i * 6 + 2, Math.round(y * POS_Q), true); pos.setInt16(i * 6 + 4, Math.round(z * POS_Q), true);
  });
  const nrm = Int8Array.from([100, 0, 0, 0, -100, 0, 0, 0, 100, -50, 50, 0, 10, 20, 30]);
  const raw = { kinds: [0, 2], counts: [3, 2], pos: b64(new Uint8Array(pos.buffer)), nrm: b64(new Uint8Array(nrm.buffer)) };
  assert.deepEqual(Array.from(decodeBrain(raw).chain), [0, 1], 'tanpa chains: tiap garis rantainya sendiri');
  const d = decodeBrain({ ...raw, chains: [4, 4] });
  assert.deepEqual(Array.from(d.chain), [4, 4]);
  assert.equal(d.n, 5);
  assert.equal(d.lines, 2);
  assert.deepEqual(Array.from(d.kind), [0, 2]);
  assert.deepEqual(Array.from(d.start), [0, 3]);
  assert.deepEqual(Array.from(d.len), [3, 2]);
  assert.deepEqual([d.x[0], d.y[0], d.z[0]], [32, -64, 96]);
  assert.equal(d.x[2], -1024, 'bilangan negatif Int16 terbaca bertanda');
  assert.deepEqual([d.nx[0], d.ny[0], d.nz[0]], [100 / NRM_Q, 0, 0]);
  assert.deepEqual([d.nx[1], d.ny[1], d.nz[1]], [0, -100 / NRM_Q, 0], 'normal Int8 negatif terbaca bertanda');
  assert.ok(Math.abs(d.nx[3] + 0.5) < 1e-6 && Math.abs(d.ny[3] - 0.5) < 1e-6);
});

const D = decodeBrain(BRAIN);
const U = BRAIN.unit;
const idx = (k) => { const a = []; for (let l = 0; l < D.lines; l++) if (D.kind[l] === k) a.push(l); return a; };

test('data otak: kotak desain, satuan, dan empat jenis garis terisi, terurut menurut jenis', () => {
  assert.ok(BRAIN.w > 0 && BRAIN.h > 0 && BRAIN.unit > 0);
  assert.ok(idx(0).length >= 60, `lipatan ${idx(0).length}`);
  assert.ok(idx(1).length >= 4, `celah utama ${idx(1).length}: Sylvian dan sentral di tiap belahan`);
  assert.ok(idx(2).length >= 10, `otak kecil ${idx(2).length}`);
  assert.ok(idx(3).length >= 5, `batang otak ${idx(3).length}`);
  for (let l = 1; l < D.lines; l++) assert.ok(D.kind[l] >= D.kind[l - 1], 'jenis garis berurutan supaya tiap jenis menempati satu rentang');
  assert.ok(Array.from(D.kind).every((k) => k >= 0 && k <= 3));
});

test('data otak: koordinat berhingga, garis punya >= 2 titik, normal hampir satuan', () => {
  for (let l = 0; l < D.lines; l++) assert.ok(D.len[l] >= 2, `garis ${l} hanya ${D.len[l]} titik`);
  for (let i = 0; i < D.n; i++) {
    assert.ok(Number.isFinite(D.x[i]) && Number.isFinite(D.y[i]) && Number.isFinite(D.z[i]), `titik ${i}`);
    const m = Math.hypot(D.nx[i], D.ny[i], D.nz[i]);
    assert.ok(m > 0.9 && m < 1.1, `normal ${i} panjang ${m}`);
  }
});

test('data otak: jumlah titik dalam anggaran supaya gambar per frame murah, tetapi cukup rapat untuk terbaca sebagai otak', () => {
  assert.ok(D.n <= 12000, `${D.n} titik`);
  let foldSegs = 0;
  for (const l of idx(0)) foldSegs += D.len[l] - 1;
  assert.ok(foldSegs >= 3000, `segmen lipatan ${foldSegs}`);
});

test('data otak: kotak desain memuat otak di setiap sudut putar dengan sisa tipis, tanpa ruang kosong yang terbuang', () => {
  const X = new Float64Array(D.n); const Y = new Float64Array(D.n); const Dp = new Float64Array(D.n);
  const k = perspK(U);
  let maxW = 0; let maxH = 0; let top = Infinity; let bottom = Infinity;
  for (let yaw = 0; yaw < 2 * Math.PI; yaw += (2 * Math.PI) / 180) {
    const v = viewOf(yaw, PITCH);
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < D.n; i++) {
      projectInto(v, k, D.x[i], D.y[i], D.z[i], X, Y, Dp, i);
      const sx = BRAIN.w / 2 + X[i];
      const sy = BRAIN.h / 2 - Y[i];
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    assert.ok(x0 >= 0 && x1 <= BRAIN.w && y0 >= 0 && y1 <= BRAIN.h, `yaw ${yaw.toFixed(2)} keluar kotak: x ${x0.toFixed(1)}..${x1.toFixed(1)}, y ${y0.toFixed(1)}..${y1.toFixed(1)}`);
    maxW = Math.max(maxW, x1 - x0); maxH = Math.max(maxH, y1 - y0);
    top = Math.min(top, y0); bottom = Math.min(bottom, BRAIN.h - y1);
  }
  assert.ok(maxW >= 0.9 * BRAIN.w, `lebar terpakai ${(maxW / BRAIN.w).toFixed(3)}`);
  assert.ok(maxH >= 0.9 * BRAIN.h, `tinggi terpakai ${(maxH / BRAIN.h).toFixed(3)}`);
  assert.ok(Math.abs(top - bottom) <= 0.03 * BRAIN.h, `terpusat vertikal: sisa atas ${top.toFixed(1)}, bawah ${bottom.toFixed(1)}`);
});

test('data otak: lipatan menyebar di kedua belahan dan di seluruh panjang dan tinggi otak, supaya percikan selalu punya jalur', () => {
  let left = 0; let right = 0; let n = 0;
  let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const l of idx(0)) {
    for (let i = D.start[l]; i < D.start[l] + D.len[l]; i++) {
      n++;
      if (D.x[i] < 0) left++; else right++;
      y0 = Math.min(y0, D.y[i]); y1 = Math.max(y1, D.y[i]); z0 = Math.min(z0, D.z[i]); z1 = Math.max(z1, D.z[i]);
    }
  }
  assert.ok(left / n > 0.3 && right / n > 0.3, `belahan kiri ${(left / n).toFixed(2)}, kanan ${(right / n).toFixed(2)}`);
  assert.ok(y0 <= -0.8 * U && y1 >= 0.8 * U, `panjang ${(y0 / U).toFixed(2)}..${(y1 / U).toFixed(2)}`);
  assert.ok(z1 - z0 >= 1.0 * U, `tinggi ${((z1 - z0) / U).toFixed(2)}`);
});

test('data otak: otak kecil di belakang-bawah dan batang otak di bawah tengah, supaya tidak ikut kelompok gelombang dan tidak tertukar', () => {
  let cbY1 = -Infinity; let cbY0 = Infinity;
  for (const l of idx(2)) for (let i = D.start[l]; i < D.start[l] + D.len[l]; i++) { cbY1 = Math.max(cbY1, D.y[i]); cbY0 = Math.min(cbY0, D.y[i]); }
  assert.ok(cbY1 < -0.3 * U && cbY0 > -1.05 * U, `otak kecil y ${(cbY0 / U).toFixed(2)}..${(cbY1 / U).toFixed(2)}`);
  for (const l of idx(3)) {
    for (let i = D.start[l]; i < D.start[l] + D.len[l]; i++) {
      assert.ok(Math.abs(D.x[i]) <= 0.16 * U && D.y[i] <= -0.05 * U && D.y[i] >= -0.6 * U, `batang otak ${(D.x[i] / U).toFixed(2)},${(D.y[i] / U).toFixed(2)}`);
    }
  }
  const sides = new Set();
  for (const l of idx(1)) sides.add(Math.sign(D.x[D.start[l] + (D.len[l] >> 1)]));
  assert.ok(sides.has(1) && sides.has(-1), 'celah utama ada di kedua belahan');
});

test('data otak: tiap lipatan sepanjang paling banyak garis terpanjang desain lama (610 satuan), supaya percikan bisa menempuh satu garis dan "dekat" tetap lokal', () => {
  const lens = idx(0).map((l) => { let t = 0; for (let i = D.start[l]; i < D.start[l] + D.len[l] - 1; i++) t += Math.hypot(D.x[i + 1] - D.x[i], D.y[i + 1] - D.y[i], D.z[i + 1] - D.z[i]); return t; });
  assert.ok(Math.max(...lens) <= 610, `lipatan terpanjang ${Math.max(...lens).toFixed(0)} satuan`);
  assert.ok(lens.filter((t) => t >= 250).length >= 40, `garis panjang untuk kelompok theta: ${lens.filter((t) => t >= 250).length}`);
});

test('data otak: lipatan berasal dari garis labirin utuh (chains); bagian yang bersebelahan satu rantai bersambung ujung ke ujung, jenis lain tidak berbagi rantai', () => {
  assert.equal(BRAIN.chains.length, BRAIN.kinds.length);
  for (let l = 1; l < D.lines; l++) {
    if (D.chain[l] !== D.chain[l - 1]) continue;
    assert.ok(D.kind[l] === 0 && D.kind[l - 1] === 0, 'hanya lipatan yang dipecah');
    const a = D.start[l - 1] + D.len[l - 1] - 1;
    const b = D.start[l];
    assert.ok(Math.hypot(D.x[a] - D.x[b], D.y[a] - D.y[b], D.z[a] - D.z[b]) < 0.2, `bagian ${l - 1} dan ${l} tidak bersambung`);
  }
  const rantai = new Set(idx(0).map((l) => D.chain[l]));
  assert.ok(rantai.size >= 80 && rantai.size < idx(0).length, `rantai ${rantai.size} untuk ${idx(0).length} lipatan`);
  for (const k of [1, 2, 3]) for (const l of idx(k)) assert.ok(!rantai.has(D.chain[l]), `jenis ${k} memakai rantai lipatan`);
});
