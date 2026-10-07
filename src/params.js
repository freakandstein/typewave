// Parameter URL (spec 8.2).
import { CONFIG } from './config.js';

const bool = (v) => v === '1' || v === 'true';

// ?ratio=: "21:9", "3:1" atau desimal ("2.4"); selain itu null (bawaan). Dijepit ke 16:9..3:1 saat dipakai (wideRatio di scene.js).
export function parseRatio(v) {
  if (v === null || v === undefined || v === '') return null;
  const parts = String(v).split(':');
  if (parts.length > 2) return null;
  const nums = parts.map((p) => (/^\d+(\.\d+)?$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums.length === 2 ? nums[0] / nums[1] : nums[0];
}

export function resolveLayout(layout, w, h) {
  if (layout === 'wide' || layout === 'tall') return layout;
  return h > w ? 'tall' : 'wide';
}

// Host selain loopback (mis. GitHub Pages) tidak mungkin punya bridge: halaman otomatis menjadi demo (simulator, tanpa WebSocket).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const hostOf = (loc) => String((loc && loc.host) || '').replace(/:\d+$/, '');
const isRemote = (loc) => { const h = hostOf(loc); return !!h && !LOOPBACK.has(h) && loc.protocol !== 'file:'; };

const wsFromLocation = (loc) => (loc && loc.host && (loc.protocol === 'http:' || loc.protocol === 'https:')
  ? `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
  : CONFIG.ws.url);

// loc (opsional, mis. window.location): default WebSocket = bridge yang menyajikan halaman ini, di port mana pun.
export function parseParams(search, loc = null) {
  const q = new URLSearchParams(search);
  const pick = (name, allowed, d) => (allowed.includes(q.get(name)) ? q.get(name) : d);
  const ws = q.get('ws');
  const demoQ = q.get('demo');
  const demo = demoQ === '1' || demoQ === 'true' ? true : demoQ === '0' || demoQ === 'false' ? false : isRemote(loc) && !q.has('ws') && !q.get('replay');
  return {
    layout: pick('layout', ['wide', 'tall', 'auto'], 'wide'),  // default horizontal; auto memilih menurut bentuk jendela, tall untuk 9:16
    fit: pick('fit', ['contain', 'fill'], 'contain'),  // contain: bingkai utuh di tengah jendela; fill: memenuhi jendela
    ratio: parseRatio(q.get('ratio')),  // bentuk bingkai wide (lebar:tinggi); null = bawaan 21:9
    transparent: bool(q.get('transparent')),
    privacy: pick('privacy', ['zone', 'exact'], 'zone'),
    sim: bool(q.get('sim')) || demo,
    demo,  // simulator yang hidup sendiri (mengetik dan mengembara) tanpa bridge dan tanpa headset
    replay: (q.get('replay') || '').replace(/[^A-Za-z0-9._-]/g, '') || null,
    lang: pick('lang', ['en', 'id'], 'en'),
    ws: demo || ws === 'off' ? null : ws || wsFromLocation(loc),
    debug: bool(q.get('debug')),
    controls: bool(q.get('controls')),
    keyboard: bool(q.get('keyboard')),
    brain: q.get('brain') !== '0' && q.get('brain') !== 'false',
    contact: q.get('contact') !== '0' && q.get('contact') !== 'false',  // titik sensor di HUD saat headset tersambung
  };
}
