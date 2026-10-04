// Menjalankan sesi sintetis lewat metrics dengan jam virtual (langkah 50 ms); dipakai tes sesi dan laporan.
import { createMetrics } from '../../src/core/metrics.js';

export function runSession(s, stepMs = 50) {
  const m = createMetrics(0);
  let i = 0;
  for (let now = 0; now <= s.meta.durationMs; now += stepMs) {
    while (i < s.events.length && s.events[i].t <= now) {
      const e = s.events[i++];
      if (e.type === 'key') m.onKey({ code: e.code, at: e.t, rep: false, mods: [] }, e.t);
      else m.onMind({ pos: e.pos, hr: e.hr, q: e.q }, e.t);
    }
    m.tick(now, stepMs / 1000);
  }
  return m.summary(s.meta.durationMs);
}
