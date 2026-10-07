// Semua konstanta tuning (spec bagian 3, 4.1, 6). Satuan px mengacu ke sisi pendek 1080 (lihat scaleFor).

// Slot ilustrasi otak (px desain pada skala 1; tinggi kotak, jarak dari atas bingkai, dan jarak ke titik jatuh bead). Otaknya 3D dan
// berputar, jadi kotaknya memuat otak di sudut putar mana pun (lihat data/brain.js); lebar kotak = tinggi x 1000 / 813.
const BRAIN_TOP = 33.6;
const BRAIN_H = 350;
const SPAWN_GAP = 1.2;
const KB_TOP = 23.3; // dengan siluet keyboard (?keyboard=1) otak mengecil dan naik sedikit
const KB_H = 286;
const KB_GAP = 1.7;

export const CONFIG = Object.freeze({
  colors: Object.freeze({
    calm: Object.freeze({ ground: '#0F2B33', ink: '#8ED8D0' }),
    flow: Object.freeze({ ground: '#2D2112', ink: '#F2B24E' }),
    tense: Object.freeze({ ground: '#2B0F1E', ink: '#FF5E72' }),
    noSignal: Object.freeze({ ground: '#2A2D31', ink: '#ECE7DC' }),
    text: '#ECE7DC',
  }),
  zone: Object.freeze({ calmMax: 0.35, tenseMin: 0.65, calmFlow: [0.15, 0.35], flowTense: [0.65, 0.85], dwellMs: 500 }),
  sat: [0.5, 1.0],
  // Sumbu huruf HUD satu nilai tetap (lebar normal, semi-tebal): ukuran dan tebal teks tidak berubah mengikuti kondisi otak, supaya tetap terbaca di OBS.
  type: Object.freeze({ hudWdth: 100, hudWght: 600, reportWdth: 100, reportWght: 500, statePx: 96, wpmPx: 64, smallPx: 28 }),
  spring: Object.freeze({ omega: 5, restOmega: 1.6, noSignalOmega: 3 }),
  metrics: Object.freeze({
    pauseMs: 3000, idleMs: 3000, wpmWindowMs: 10000, wpmMinWindowMs: 3000,
    densityTauMs: 1500, noSignalMs: 5000, flowRange: [0.35, 0.65], hrRange: [20, 250],
  }),
  maxDt: 0.05,
  ribbon: Object.freeze({
    spacing: 8, wpmMax: 120, thickness: [2, 28],
    densityAmpMax: 8, amp: [8, 120], densitySpeedMax: 10, speed: [40, 420],
    roughFrom: 0.5, roughMax: 5, tailAlpha: 0.2,
    // Bentuk gelombang dari pos (tenang -> tegang): panjang gelombang px, dan bobot harmonik 2.3x (0 = sinus mulus).
    // Titik tengah pos 0.5 = 420 px dan 0.30, persis bentuk sebelum gelombang mengikuti EEG.
    wavelength: [640, 200], harmonic: [0.15, 0.45],
    idleSpeed: 28, idleAmp: 5, idleThick: [2, 3.5], idleBreathHz: 0.25,
    dir: 'ltr', // 'ltr' = kiri ke kanan (wide) / bawah ke atas (tall); 'rtl' membalik
  }),
  breathe: 0.03,
  beads: Object.freeze({
    cap: 400, dropMs: 280, lifeMs: 8000, edgeFadePx: 60,
    rMin: 3, rMax: 10, ikiLo: 120, ikiSpan: 800, charAlpha: 0.9,
    ring: Object.freeze({ r: 18, ms: 500, a: 0.5 }),
    neutral: Object.freeze({ r: 3, a: 0.6 }),
    rep: Object.freeze({ r: 3, a: 0.5, perSec: 12 }),
    back: Object.freeze({ speed: 0.4, ms: 700, sat: 0.5, a: 0.8, r: 4 }),
  }),
  space: Object.freeze({ len: 40, thick: 3, ms: 400, a: 0.8 }),
  enter: Object.freeze({ px: 1, ms: 600, a: 0.35 }),
  footprint: Object.freeze({
    alpha: 0.25, litMs: 450, aspect: 0.6, gap: 0.06,
    wide: Object.freeze({ x: [0.10, 0.90], bottom: 0.96 }),
    tall: Object.freeze({ x: [0.06, 0.82], bottom: 0.78 }),
  }),
  // Bingkai horizontal (wide): lebar : tinggi. Bawaan 21:9 (tinggi 24% lebih pendek daripada 16:9, tanpa ruang kosong di bawah pita); ?ratio= boleh
  // 16:9 sampai 3:1. Dengan siluet keyboard (?keyboard=1) bawaannya tetap 16:9 karena footprint memakai ruang bawah.
  stage: Object.freeze({ wideRatio: 21 / 9, minRatio: 16 / 9, maxRatio: 3, keyboardRatio: 16 / 9 }),
  // Tata letak wide ringkas (bingkai lebih pendek dari 16:9), satuan px desain pada skala 1 = lebar 1920. Di 16:9 hasilnya sama dengan layout.wide.
  compact: Object.freeze({
    brainTop: BRAIN_TOP, brainH: BRAIN_H, brainFullAt: 823, // otak penuh sampai tinggi 823 (21:9), di bawahnya mengecil sebanding dengan tinggi
    spawnGap: SPAWN_GAP, centerMax: 626.4, belowRibbon: 200, minFall: 110, // pita selalu 200 px dari dasar, bead jatuh minimal 110 px
  }),
  layout: Object.freeze({
    // brain: pusat sebagai pecahan lebar dan tinggi kanvas, tinggi dalam px pada skala 1 (dikali g.k)
    wide: Object.freeze({ center: 0.58, spawn: (BRAIN_TOP + BRAIN_H + SPAWN_GAP) / 1080, beadRange: [0.10, 0.90], brain: Object.freeze({ cx: 0.5, cy: (BRAIN_TOP + BRAIN_H / 2) / 1080, h: BRAIN_H }) }),
    tall: Object.freeze({ center: 0.42, spawn: 0.12, beadRange: [0.24, 0.86], brain: Object.freeze({ cx: 0.64, cy: 0.19, h: 327 }) }),
  }),
  // Menimpa layout bila siluet keyboard dinyalakan (?keyboard=1): ruang bawah dipakai footprint, jadi pita kembali ke tengah
  // dan otak mengecil sedikit supaya tetap di atas titik jatuh bead.
  layoutKeyboard: Object.freeze({
    wide: Object.freeze({ center: 0.5, spawn: (KB_TOP + KB_H + KB_GAP) / 1080, brain: Object.freeze({ cx: 0.5, cy: (KB_TOP + KB_H / 2) / 1080, h: KB_H }) }),
  }),
  // Ilustrasi otak 3D (spec 6.4). Tanpa glow: hanya alpha dan lebar garis (px pada skala 1). Satuan jarak: satuan desain (kotak 1000 lebar).
  brain: Object.freeze({
    alpha: Object.freeze({ fixed: 0.75, lit: 0.3, base: [0.8, 1], noSignal: 0.35 }), // fixed = terang celah utama dan batang otak (tidak ikut kelompok gelombang)
    // Putaran mengelilingi sumbu tegak: kecepatan tetap (rad/detik, sekitar 20 detik per putaran), tidak mengikuti ketikan atau EEG; yaw0 = sudut awal.
    spin: 0.32, yaw0: 0.55,
    // Tembus pandang: semua garis tergambar, yang makin jauh makin redup dan tipis, yang menghadap menjauh dari kamera (back) lebih redup lagi.
    // far = terang relatif garis terjauh, curve = kelengkungan, gain = penguat terang dasar, range = setengah rentang kedalaman (satuan model).
    depth: Object.freeze({ far: 0.12, curve: 1.5, back: 0.4, gain: 1.3, range: 1.25 }),
    width: Object.freeze([0.9, 1.2, 1.6, 1.7]), // lebar garis: sisi belakang, depan jauh, depan dekat (dan lipatan yang menyala), celah utama
    // Tiga kelompok lipatan menurut panjang (terpanjang = theta lambat, sedang = alpha, terpendek = beta cepat). Level 0..1 dari EEG
    // mengatur terang dasar tiap kelompok, kelompok percikan ketikan, serta kecepatan dan panjang ekornya.
    bands: Object.freeze({
      fold: [0.1, 0.74], // opasitas dasar lipatan pada level 0 dan 1 (level 0.5 = 0.42, sama seperti tanpa data)
      tauMs: 1200, floor: 0.15,
      speed: [0.55, 1, 1.6], trail: [1.3, 1, 0.7],
    }),
    line: Object.freeze({ spark: 2.6, head: 4.2 }),
    motion: Object.freeze({ amp: [1.5, 6], speed: [0.35, 2.4], roughFrom: 0.5, rough: 0.6 }), // amp: satuan desain
    energyMs: 700,
    spark: Object.freeze({
      cap: 48, enter: 0.55,
      char: Object.freeze({ trail: 140, speed: 700, ms: 900, a: 1, e: 1, near: 3 }),
      space: Object.freeze({ trail: 220, speed: 450, ms: 1300, a: 0.9, e: 1, near: 5 }),
      back: Object.freeze({ trail: 90, speed: 800, ms: 800, a: 0.6, e: 0.6, near: 2 }),
      neutral: Object.freeze({ trail: 60, speed: 500, ms: 700, a: 0.55, e: 0.5, near: 1 }),
      rep: Object.freeze({ trail: 60, speed: 500, ms: 600, a: 0.45, e: 0.4, near: 1 }),
    }),
  }),
  hud: Object.freeze({ fadeInMs: 400, fadeOutMs: 1500 }),
  // Status headset dari sumber EEG. Ambang kontak sama dengan DSP (eeg/dsp.py): kanal >= good dipakai untuk band power, >= fair marginal.
  // Sumber EEG mengirim ~5 pesan per detik: diam selama staleMs berarti sumbernya mati.
  headset: Object.freeze({ staleMs: 3000, good: 0.65, fair: 0.25 }),
  report: Object.freeze({
    showMs: 9000, dim: 0.6, wide: [1920, 1080], tall: [1080, 1920],
    margin: 0.07, hookPx: 0.075, // dikali sisi pendek; posisi vertikal di bawah dikali tinggi kanvas
    layout: Object.freeze({
      wide: Object.freeze({ chartY: 0.30, chartH: 0.14, stripY: 0.46, stripH: 0.08, statsY: 0.66, statsStep: 0.065, statsPx: 0.045 }),
      tall: Object.freeze({ chartY: 0.28, chartH: 0.12, stripY: 0.42, stripH: 0.06, statsY: 0.56, statsStep: 0.05, statsPx: 0.04 }),
    }),
  }),
  ws: Object.freeze({ url: 'ws://127.0.0.1:8770/ws', backoffMs: [1000, 2000, 5000] }),
});

// Skala px: sisi pendek / 1080 (tall adalah wide yang diputar).
export const scaleFor = (W, H) => Math.min(W, H) / 1080;
