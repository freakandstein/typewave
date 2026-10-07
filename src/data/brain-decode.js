// Membuka data otak 3D (data/brain.js, dihasilkan tools/gen_brain.mjs) menjadi larik bertipe, sekali saat dimuat.
// Titik semua garis disambung berurutan: garis l menempati [start[l], start[l] + len[l]). Lipatan yang panjang dipecah generator menjadi beberapa
// garis; bagian-bagiannya berurutan dan berbagi satu nomor rantai (chain), supaya kelompok gelombangnya ditentukan oleh panjang garis utuh.
// Posisi: Int16 little-endian per 1/32 satuan desain (x, y, z per titik); normal permukaan: Int8 per 1/100.
export const POS_Q = 32;
export const NRM_Q = 100;

function bytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function decodeBrain(data) {
  const pb = bytes(data.pos);
  const nb = bytes(data.nrm);
  const n = pb.length / 6;
  if (!Number.isInteger(n) || nb.length !== n * 3) throw new Error(`data otak tidak konsisten: ${pb.length} byte posisi, ${nb.length} byte normal`);
  const lines = data.kinds.length;
  const d = {
    n, lines,
    kind: Uint8Array.from(data.kinds), start: new Uint32Array(lines), len: Uint16Array.from(data.counts),
    chain: Uint16Array.from(data.chains ?? data.kinds.map((_, l) => l)), // garis labirin utuh asal tiap garis (bagian yang dipecah berbagi rantai)
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n),
  };
  let o = 0;
  for (let l = 0; l < lines; l++) { d.start[l] = o; o += d.len[l]; }
  if (o !== n) throw new Error(`jumlah titik garis (${o}) tidak sama dengan data (${n})`);
  const dv = new DataView(pb.buffer);
  const ns = new Int8Array(nb.buffer);
  for (let i = 0; i < n; i++) {
    d.x[i] = dv.getInt16(i * 6, true) / POS_Q;
    d.y[i] = dv.getInt16(i * 6 + 2, true) / POS_Q;
    d.z[i] = dv.getInt16(i * 6 + 4, true) / POS_Q;
    d.nx[i] = ns[i * 3] / NRM_Q;
    d.ny[i] = ns[i * 3 + 1] / NRM_Q;
    d.nz[i] = ns[i * 3 + 2] / NRM_Q;
  }
  return d;
}
