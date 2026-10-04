// Klien WebSocket ke bridge: memancarkan pesan ke bus lokal; reconnect dengan backoff.
import { CONFIG } from '../config.js';

export function createWsSource({ bus, url, onState, WebSocketImpl = globalThis.WebSocket, setTimer = setTimeout, now = Date.now }) {
  const delays = CONFIG.ws.backoffMs;
  const state = { connected: false, keys: false };
  let ws = null;
  let attempt = 0;
  let closed = false;

  function route(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello': {
        state.keys = !!m.keys;
        const h = { keys: state.keys };
        if (typeof m.paused === 'boolean') h.paused = m.paused;
        if (typeof m.secure === 'boolean') h.secure = m.secure;
        bus.emit('hello', h);
        break;
      }
      case 'key':
        if (typeof m.code === 'string' && m.code) {
          bus.emit('key', { code: m.code, at: Number.isFinite(m.at) ? m.at : now(), rep: !!m.rep, mods: Array.isArray(m.mods) ? m.mods : [] });
        }
        break;
      case 'mind': {
        const mind = { pos: m.pos, hr: m.hr, q: m.q };
        for (const k of ['theta', 'alpha', 'beta']) if (m[k] !== undefined) mind[k] = m[k];
        bus.emit('mind', mind);
        break;
      }
      case 'ctl':
        bus.emit('ctl', m);
        break;
      default:
    }
  }

  function onMessage(data) {
    for (const line of String(data).split('\n')) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      route(m);
    }
  }

  function schedule() {
    if (!closed) setTimer(connect, delays[Math.min(attempt++, delays.length - 1)]);
  }

  function connect() {
    if (closed) return;
    try { ws = new WebSocketImpl(url); } catch { schedule(); return; }
    ws.onopen = () => { attempt = 0; state.connected = true; if (onState) onState(state); };
    ws.onmessage = (e) => onMessage(e.data);
    ws.onclose = () => {
      state.connected = false;
      state.keys = false;
      if (onState) onState(state);
      bus.emit('hello', { keys: false });
      schedule();
    };
    ws.onerror = () => {};
  }

  connect();
  return { state, route, close() { closed = true; if (ws) ws.close(); } };
}
