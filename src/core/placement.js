// Posisi bead sepanjang pita (spec 6.1). u = posisi ternormalisasi 0..1 (kiri..kanan keyboard).
import { CONFIG } from '../config.js';
import { keyInfo } from '../data/layout-ansi75.js';

// Rentang u pada privacy=zone; setara 10..48 %, 52..90 %, 40..60 % lebar pada wide.
const RANGES = { L: [0, 0.475], R: [0.525, 1], B: [0.375, 0.625] };

export function beadU(code, privacy, rand = Math.random) {
  const k = keyInfo(code);
  if (privacy === 'exact') return k ? k.u : 0.5;
  const r = RANGES[k ? k.hand : 'B'];
  return r[0] + (r[1] - r[0]) * rand();
}

export function alongFrac(u, layout) {
  const [a, b] = CONFIG.layout[layout].beadRange;
  return a + (b - a) * u;
}
