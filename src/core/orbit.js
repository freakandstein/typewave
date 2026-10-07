// Proyeksi otak 3D (spec 6.4): putar mengelilingi sumbu tegak (yaw), kamera sedikit di atas otak (pitch), perspektif lemah.
// Satu sumber untuk penggambar (render/brain.js) dan generator (tools/gen_brain.mjs), supaya kotak desain yang dihitung generator
// persis sama dengan yang digambar.
// Sumbu model: x kiri-kanan, y depan (+) ke belakang (-), z atas. Pada yaw 0 kamera ada di sisi kiri otak dan bagian depan
// menghadap ke kiri layar; yaw seperempat putaran melihat otak dari depan.
export const PITCH = 0.10; // radian: kamera sedikit di atas

// Perspektif: skala titik = 1 / (1 - kedalaman * k). Kekuatannya tetap dalam satuan model (mata sekitar 6,2 satuan dari pusat; otak
// panjangnya 2), jadi otak berukuran lain tetap berbentuk sama. unit = satuan desain per satuan model.
export const perspK = (unit) => 0.55 / (3.4 * unit);

export function viewOf(yaw, pitch = PITCH, out = {}) {
  out.cy = Math.cos(yaw);
  out.sy = Math.sin(yaw);
  out.cp = Math.cos(pitch);
  out.sp = Math.sin(pitch);
  return out;
}

// Satu titik model -> X (kanan positif), Y (atas positif), D (kedalaman, makin besar makin dekat ke kamera), relatif ke pusat putar.
// Keluarannya larik bertipe (indeks i) supaya tanpa alokasi di loop per frame.
export function projectInto(v, k, x, y, z, X, Y, D, i) {
  const x1 = x * v.cy - y * v.sy; // putar mengelilingi sumbu tegak
  const y1 = x * v.sy + y * v.cy;
  const dm = -x1; // menuju kamera
  const up = z * v.cp - dm * v.sp; // miring: pitch positif = kamera di atas
  const depth = dm * v.cp + z * v.sp;
  const f = 1 / (1 - depth * k);
  X[i] = -y1 * f;
  Y[i] = up * f;
  D[i] = depth;
}
