// Bentuk gelombang pita dari pos (tenang <-> tegang): tenang = ayunan panjang dan mulus,
// tegang = lebih rapat dan lebih "patah". Ketikan tetap mengatur tinggi dan kecepatan (bagian 6 spec).
import { CONFIG } from '../config.js';
import { clamp, lerp } from './color.js';

// Menulis `wavelength` (px acuan, belum diskalakan) dan `harm` (bobot harmonik 0..1) ke `out` tanpa alokasi.
export function waveShapeInto(out, pos) {
  const p = Number.isFinite(pos) ? clamp(pos) : 0.5;
  const R = CONFIG.ribbon;
  out.wavelength = lerp(R.wavelength[0], R.wavelength[1], p);
  out.harm = lerp(R.harmonic[0], R.harmonic[1], p);
  return out;
}
