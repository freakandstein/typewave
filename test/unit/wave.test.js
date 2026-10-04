import test from 'node:test';
import assert from 'node:assert/strict';
import { waveShapeInto } from '../../src/core/wave.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('tenang = ayunan panjang dan mulus, tegang = rapat dan lebih patah; titik tengah = bentuk lama (420 px, harmonik 0.3)', () => {
  const calm = waveShapeInto({}, 0);
  const tense = waveShapeInto({}, 1);
  const mid = waveShapeInto({}, 0.5);
  assert.ok(near(calm.wavelength, 640) && near(calm.harm, 0.15));
  assert.ok(near(tense.wavelength, 200) && near(tense.harm, 0.45));
  assert.ok(near(mid.wavelength, 420) && near(mid.harm, 0.3));
});

test('monoton: makin tegang makin pendek dan makin banyak harmonik; di luar rentang dijepit; NaN dianggap tengah', () => {
  let prev = waveShapeInto({}, 0);
  for (let p = 0.05; p <= 1.0001; p += 0.05) {
    const cur = waveShapeInto({}, p);
    assert.ok(cur.wavelength < prev.wavelength && cur.harm > prev.harm, 'pos ' + p);
    prev = cur;
  }
  assert.deepEqual(waveShapeInto({}, -3), waveShapeInto({}, 0));
  assert.deepEqual(waveShapeInto({}, 7), waveShapeInto({}, 1));
  assert.deepEqual(waveShapeInto({}, NaN), waveShapeInto({}, 0.5));
});

test('menulis ke objek yang diberikan (tanpa alokasi per frame) dan mengembalikannya', () => {
  const out = { thick: 5 };
  assert.equal(waveShapeInto(out, 0.2), out);
  assert.equal(out.thick, 5);
  assert.ok(out.wavelength > 0 && out.harm > 0);
});
