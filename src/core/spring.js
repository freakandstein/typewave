// Critically damped spring, solusi analitik: hasil sama untuk dt berapa pun.
export function createSpring(x0 = 0, omega = 5) {
  return { x: x0, v: 0, omega };
}

export function stepSpring(s, target, dt) {
  if (!(dt > 0)) return s.x;
  const w = s.omega;
  const e = s.x - target;
  const b = s.v + w * e;
  const ex = Math.exp(-w * dt);
  s.x = target + (e + b * dt) * ex;
  s.v = (s.v - w * b * dt) * ex;
  return s.x;
}

export function snapSpring(s, x) {
  s.x = x;
  s.v = 0;
  return x;
}
