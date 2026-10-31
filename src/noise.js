// Детерминированный шум: один и тот же seed всегда даёт один и тот же мир.

export function hash2(x, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(z - zi);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, z, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}
