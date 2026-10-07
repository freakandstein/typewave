// Status headset di halaman: pesan `headset` dari sumber EEG (lewat bridge), kekinian pesan itu, dan status sambungan ke bridge.
// Hasilnya satu status untuk HUD: unknown (sumber EEG belum pernah terlihat), bridge (halaman kehilangan bridge), offline (sumber EEG diam atau berhenti),
// connecting, connected, reconnecting. Titik sensor hanya ada saat connected dan pesannya segar.
import { CONFIG } from '../config.js';
import { clamp } from './color.js';

const H = CONFIG.headset;
const STATES = ['connecting', 'connected', 'reconnecting', 'stopped'];
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Kualitas kanal 0..1 dari DSP -> level titik sensor. Ambangnya sama dengan DSP: kanal < 0,65 tidak dipakai untuk band power.
export const contactLevel = (q) => (q >= H.good ? 'good' : q >= H.fair ? 'fair' : 'poor');

// Pesan headset -> bentuk bersih, atau null (abaikan). Percobaan hanya berarti saat reconnecting; kontak harus tepat empat angka.
export function sanitizeHeadset(m) {
  if (!m || typeof m !== 'object' || !STATES.includes(m.state)) return null;
  let attempt = 0;
  if (m.state === 'reconnecting') {
    const a = fin(m.attempt);
    attempt = a === null ? 1 : Math.min(9999, Math.max(1, Math.round(a)));
  }
  const c = m.contact;
  const contact = Array.isArray(c) && c.length === 4 && c.every((v) => fin(v) !== null) ? c.map((v) => clamp(v, 0, 1)) : null;
  return { state: m.state, attempt, contact };
}

export function createHeadset() {
  let last = null;
  let at = -Infinity;
  let bridgeUp = true; // tanpa WebSocket sama sekali (demo, replay) bridge tidak pernah dilaporkan putus
  const levels = [null, null, null, null]; // dipakai ulang per frame, seperti objek lain di render
  const snap = { state: 'unknown', attempt: 0, contact: null };
  return {
    onMessage(m, now) {
      const s = sanitizeHeadset(m);
      if (!s) return false; // pesan sampah tidak boleh dianggap detak sumber EEG
      last = s;
      at = now;
      return true;
    },
    // Bridge kembali: detak yang hilang selama bridge mati bukan bukti sumber EEG mati, jadi kekinian dihitung dari saat sambung ulang
    // (detak berikutnya datang dalam 200 ms; bila tetap sunyi 3 detik baru offline). Tanpa ini "sumber EEG terputus" berkedip sesaat.
    onBridge(up, now) {
      const was = bridgeUp;
      bridgeUp = !!up;
      if (bridgeUp && !was && last && typeof now === 'number') at = now;
    },
    snapshot(now) {
      snap.attempt = 0;
      snap.contact = null;
      if (!bridgeUp) snap.state = 'bridge';
      else if (!last) snap.state = 'unknown';
      else if (now - at > H.staleMs || last.state === 'stopped') snap.state = 'offline';
      else {
        snap.state = last.state;
        snap.attempt = last.attempt;
        if (last.state === 'connected' && last.contact) {
          for (let i = 0; i < 4; i++) levels[i] = contactLevel(last.contact[i]);
          snap.contact = levels;
        }
      }
      return snap;
    },
  };
}
