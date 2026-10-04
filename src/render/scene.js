// Geometri scene: koordinat (s, c) -> kanvas. s = jarak sepanjang aliran pita (0 di hulu), c = jarak melintang.
// Tall adalah wide yang diputar: sumbu sepanjang pita vertikal (mengalir ke atas), sumbu silang horizontal.
import { CONFIG, scaleFor } from '../config.js';

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Rasio bingkai wide: ?ratio= bila ada (dijepit 16:9..3:1), selain itu bawaan (16:9 bila siluet keyboard menyala).
export function wideRatio(ratio, keyboard = false) {
  const { wideRatio: dflt, keyboardRatio, minRatio, maxRatio } = CONFIG.stage;
  return clampTo(ratio ?? (keyboard ? keyboardRatio : dflt), minRatio, maxRatio);
}

// Panggung: bingkai wide (rasio wideRatio, bawaan 21:9) atau tall (9:16) yang terpusat di jendela, jadi komposisinya sama dengan di OBS apa pun
// bentuk jendelanya (sisanya bilah). fit 'fill' memenuhi jendela apa adanya, dengan geometri diregangkan mengikuti bentuk jendela.
export function stageRect(layout, ww, wh, fit = 'contain', ratio = null) {
  const W = Math.max(1, ww);
  const H = Math.max(1, wh);
  if (fit === 'fill') return { x: 0, y: 0, w: W, h: H };
  const aspect = layout === 'tall' ? 9 / 16 : wideRatio(ratio);
  let w;
  let h;
  if (W / H > aspect) { h = H; w = Math.max(1, Math.round(H * aspect)); } else { w = W; h = Math.max(1, Math.round(W / aspect)); }
  return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
}

// compact: tata letak wide untuk bingkai yang lebih pendek dari 16:9 (bawaan 21:9). Skala dari lebar (elemen tetap seukuran, hanya ruang kosong di bawah
// yang hilang), pita selalu belowRibbon px dari dasar, otak mengecil bila bingkai lebih pendek dari 21:9. Di 16:9 hasilnya sama dengan tata letak lama.
// Tidak berlaku untuk tall dan untuk siluet keyboard (footprint memakai ruang bawah).
export function createGeom(W, H, layout, dir = CONFIG.ribbon.dir, keyboard = false, compact = false) {
  const tall = layout === 'tall';
  const L = tall ? H : W;
  const A = tall ? W : H;
  const flip = dir === 'rtl';
  const ring = compact && !tall && !keyboard;
  const k = ring ? W / 1920 : scaleFor(W, H);
  let center;
  let spawnC;
  let brain;
  if (ring) {
    const c = CONFIG.compact;
    const hd = H / k; // tinggi dalam px desain
    const brainH = c.brainH * Math.min(1, hd / c.brainFullAt);
    const spawn = c.brainTop + brainH + c.spawnGap;
    center = clampTo(hd - c.belowRibbon, spawn + c.minFall, c.centerMax) * k;
    spawnC = spawn * k;
    brain = { cx: 0.5 * W, cy: (c.brainTop + brainH / 2) * k, h: brainH * k };
  } else {
    const lc = keyboard ? { ...CONFIG.layout[layout], ...CONFIG.layoutKeyboard[layout] } : CONFIG.layout[layout];
    center = lc.center * A;
    spawnC = lc.spawn * A;
    brain = { cx: lc.brain.cx * W, cy: lc.brain.cy * H, h: lc.brain.h * k }; // ilustrasi otak: tegak, tidak ikut diputar
  }
  return {
    W, H, L, A, layout, tall, flip, k, center, spawnC, brain,
    x(s, c) { const ss = flip ? L - s : s; return tall ? c : ss; },
    y(s, c) { const ss = flip ? L - s : s; return tall ? L - ss : c; },
  };
}
