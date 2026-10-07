// Teks: label en/id (termasuk status headset) dan format durasi.

export const LABELS = {
  en: { calm: 'calm', flow: 'flow', tense: 'tense', noSignal: 'no signal', paused: 'paused', wpm: 'wpm', bpm: 'bpm',
    bridgeOff: 'bridge disconnected', eegOff: 'EEG source offline', connecting: 'connecting to headset', reconnecting: 'reconnecting, attempt {n}',
    warming: 'warming up', checkSensors: 'check the sensors', demoHint: 'Demo without a headset. Type on your keyboard and drag the sliders at the bottom right.' },
  id: { calm: 'tenang', flow: 'mengalir', tense: 'tegang', noSignal: 'tanpa sinyal', paused: 'jeda', wpm: 'wpm', bpm: 'bpm',
    bridgeOff: 'bridge terputus', eegOff: 'sumber EEG terputus', connecting: 'menyambung ke headset', reconnecting: 'menyambung ulang, percobaan {n}',
    warming: 'menyiapkan sinyal', checkSensors: 'cek sensor', demoHint: 'Demo tanpa headset. Ketik di keyboard-mu dan geser slider di kanan bawah.' },
};

export const labelFor = (key, lang = 'en') => (LABELS[lang] || LABELS.en)[key];

// Teks status di HUD dari status headset (src/core/headset.js) dan apakah mind sedang tidak mengalir. Tanpa info headset: seperti dulu.
// Putus, menyambung, dan bridge terputus tampil segera (data terakhir bisa saja belum basi); "connected" hanya bicara selama belum ada mind.
export function headsetText(h, noSignal, lang = 'en') {
  switch (h ? h.state : 'unknown') {
    case 'bridge': return labelFor('bridgeOff', lang);
    case 'offline': return labelFor('eegOff', lang);
    case 'connecting': return labelFor('connecting', lang);
    case 'reconnecting': return labelFor('reconnecting', lang).replace('{n}', String(h.attempt));
    case 'connected':
      // Kontak segar dan ada sensor yang terbaca sementara mind mengalir: tidak ada yang perlu dikatakan. Belum ada kontak segar (baru tersambung,
      // mind lama belum basi 5 detik) berarti sinyal baru disiapkan; tanpa satu pun sensor hijau (DSP butuh minimal satu kanal bagus untuk mind)
      // langsung "cek sensor" tanpa menunggu mind lama basi.
      if (h.contact && h.contact.every((l) => l !== 'good')) return labelFor('checkSensors', lang);
      return !noSignal && h.contact ? '' : labelFor('warming', lang);
    default: return noSignal ? labelFor('noSignal', lang) : '';
  }
}

export function formatDur(totalSec, lang = 'en') {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60), s = sec % 60;
  const u = lang === 'id' ? { m: 'menit', s: 'detik' } : { m: 'min', s: 's' };
  if (m && s) return `${m} ${u.m} ${s} ${u.s}`;
  if (m) return `${m} ${u.m}`;
  return `${s} ${u.s}`;
}
