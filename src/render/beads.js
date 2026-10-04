// Bead (spec 6.1): pool struct-of-arrays tanpa alokasi per bead. Bead biasa jatuh ke pita lalu ikut terbawa;
// bead mundur bergerak melawan aliran; batang space memanjang di sepanjang pita.
import { CONFIG } from '../config.js';
import { beadU, alongFrac } from '../core/placement.js';
import { ribbonIndex, ribbonCAt } from './ribbon.js';

export const KIND = { CHAR: 0, NEUTRAL: 1, REP: 2, BACK: 3, SPACE: 4 };
const TAU = Math.PI * 2;
const REP_SLOTS = CONFIG.beads.rep.perSec;

export function createBeads(cap = CONFIG.beads.cap) {
  return {
    cap, activeCount: 0, repIdx: 0, repTimes: new Float64Array(REP_SLOTS).fill(-Infinity),
    active: new Uint8Array(cap), kind: new Uint8Array(cap), ring: new Uint8Array(cap),
    id: new Float64Array(cap), born: new Float64Array(cap), s: new Float32Array(cap),
    r: new Float64Array(cap), a: new Float64Array(cap),
    x: new Float32Array(cap), y: new Float32Array(cap), alpha: new Float32Array(cap),
    ringR: new Float32Array(cap), ringA: new Float32Array(cap), len: new Float32Array(cap),
    col: new Array(cap).fill('rgb(255,255,255)'),
  };
}

export function spawnBead(p, o) {
  let slot = -1;
  let oldest = Infinity;
  let oldestI = 0;
  for (let i = 0; i < p.cap; i++) {
    if (!p.active[i]) { slot = i; break; }
    if (p.born[i] < oldest) { oldest = p.born[i]; oldestI = i; }
  }
  if (slot < 0) slot = oldestI;
  p.active[slot] = 1;
  p.kind[slot] = o.kind;
  p.id[slot] = o.id;
  p.born[slot] = o.now;
  p.s[slot] = o.s ?? 0;
  p.r[slot] = o.r;
  p.a[slot] = o.a;
  p.ring[slot] = o.ring ? 1 : 0;
  p.col[slot] = o.col;
  p.alpha[slot] = 0;
  p.ringA[slot] = 0;
  p.len[slot] = 0;
  return slot;
}

// Jendela geser: maksimum REP_SLOTS (12) bead repeat per 1000 ms.
export function allowRep(p, now) {
  if (now - p.repTimes[p.repIdx] < 1000) return false;
  p.repTimes[p.repIdx] = now;
  p.repIdx = (p.repIdx + 1) % REP_SLOTS;
  return true;
}

const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function spawnForKey(p, rb, g, ann, opts) {
  const B = CONFIG.beads;
  const { privacy, ink, now, rand = Math.random } = opts;
  let kind, r, a, ring = 0, color = ink;
  if (ann.rep) {
    if (!allowRep(p, now)) return -1;
    kind = KIND.REP; r = B.rep.r; a = B.rep.a;
  } else if (ann.cls === 'enter') {
    return -1;
  } else if (ann.cls === 'backspace') {
    kind = KIND.BACK; r = B.back.r; a = B.back.a;
    const gray = 0.299 * ink[0] + 0.587 * ink[1] + 0.114 * ink[2];
    const k = 1 - B.back.sat;
    color = [ink[0] + (gray - ink[0]) * k, ink[1] + (gray - ink[1]) * k, ink[2] + (gray - ink[2]) * k];
  } else if (ann.code === 'Space') {
    kind = KIND.SPACE; r = 0; a = CONFIG.space.a;
  } else if (ann.modifier || ann.cls === 'other') {
    kind = KIND.NEUTRAL; r = B.neutral.r; a = B.neutral.a;
  } else {
    kind = KIND.CHAR; a = B.charAlpha; ring = 1;
    if (ann.iki === null || ann.iki === undefined) r = ann.counted ? B.rMax : (B.rMin + B.rMax) / 2;
    else r = B.rMin + (B.rMax - B.rMin) * clamp01((ann.iki - B.ikiLo) / B.ikiSpan);
  }
  const frac = alongFrac(beadU(ann.code, privacy, rand), g.layout);
  const s = g.flip ? (1 - frac) * g.L : frac * g.L;
  const age = Math.max(0, Math.min(rb.count - 1, Math.round((s - rb.acc) / rb.spacing)));
  return spawnBead(p, { kind, id: rb.headId - age, s, now, r, a, ring, col: rgb(color) });
}

export function updateBeads(p, rb, g, speed, dt, now) {
  const B = CONFIG.beads;
  const k = g.k;
  let n = 0;
  for (let i = 0; i < p.cap; i++) {
    if (!p.active[i]) continue;
    const age = now - p.born[i];
    const kind = p.kind[i];
    if (kind === KIND.BACK) {
      p.s[i] -= B.back.speed * speed * dt;
      if (age >= B.back.ms || p.s[i] < 0) { p.active[i] = 0; continue; }
      const c = g.center + ribbonCAt(rb, p.s[i]);
      p.x[i] = g.x(p.s[i], c);
      p.y[i] = g.y(p.s[i], c);
      p.alpha[i] = p.a[i] * (1 - age / B.back.ms);
      p.ringA[i] = 0;
    } else {
      const idx = ribbonIndex(rb, p.id[i]);
      const life = kind === KIND.SPACE ? CONFIG.space.ms : B.lifeMs;
      if (idx < 0 || age >= life) { p.active[i] = 0; continue; }
      const s = rb.acc + (rb.headId - p.id[i]) * rb.spacing;
      if (s > g.L) { p.active[i] = 0; continue; }
      const cRib = g.center + rb.c[idx];
      if (kind === KIND.SPACE) {
        const t = age / CONFIG.space.ms;
        p.len[i] = CONFIG.space.len * k * (1 - (1 - t) * (1 - t));
        p.alpha[i] = p.a[i] * (1 - t);
        p.x[i] = g.x(s, cRib);
        p.y[i] = g.y(s, cRib);
      } else {
        const d = Math.min(1, age / B.dropMs);
        const c = g.spawnC + (cRib - g.spawnC) * d * d;
        const fade = (1 - Math.min(1, age / B.lifeMs)) * Math.min(1, (g.L - s) / (B.edgeFadePx * k)) * Math.min(1, age / 60);
        p.x[i] = g.x(s, c);
        p.y[i] = g.y(s, c);
        p.alpha[i] = p.a[i] * fade;
        const rt = (age - B.dropMs) / B.ring.ms;
        if (p.ring[i] && rt >= 0 && rt <= 1) { p.ringR[i] = B.ring.r * k * rt; p.ringA[i] = B.ring.a * (1 - rt); } else p.ringA[i] = 0;
      }
    }
    n++;
  }
  p.activeCount = n;
}

export function drawBeads(ctx, p, g) {
  const k = g.k;
  for (let i = 0; i < p.cap; i++) {
    if (!p.active[i]) continue;
    if (p.kind[i] === KIND.SPACE) {
      const half = p.len[i] / 2;
      ctx.globalAlpha = p.alpha[i];
      ctx.strokeStyle = p.col[i];
      ctx.lineWidth = CONFIG.space.thick * k;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (g.tall) { ctx.moveTo(p.x[i], p.y[i] - half); ctx.lineTo(p.x[i], p.y[i] + half); }
      else { ctx.moveTo(p.x[i] - half, p.y[i]); ctx.lineTo(p.x[i] + half, p.y[i]); }
      ctx.stroke();
      continue;
    }
    if (p.alpha[i] > 0.01) {
      ctx.globalAlpha = p.alpha[i];
      ctx.fillStyle = p.col[i];
      ctx.beginPath();
      ctx.arc(p.x[i], p.y[i], p.r[i] * k, 0, TAU);
      ctx.fill();
    }
    if (p.ringA[i] > 0.01) {
      ctx.globalAlpha = p.ringA[i];
      ctx.strokeStyle = p.col[i];
      ctx.lineWidth = Math.max(1, k);
      ctx.beginPath();
      ctx.arc(p.x[i], p.y[i], p.ringR[i], 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
