import { BLOCKS } from './blocks.js';

const EPS = 0.001;

export function aabbHitsSolid(world, x, y, z, halfW, height) {
  const x0 = Math.floor(x - halfW);
  const x1 = Math.floor(x + halfW);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + height);
  const z0 = Math.floor(z - halfW);
  const z1 = Math.floor(z + halfW);
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (world.isSolid(bx, by, bz)) return true;
      }
    }
  }
  return false;
}

// Двигает тело по осям по очереди, упираясь в блоки. pos — центр ступней.
export function moveBody(world, body, dt) {
  const { pos, vel, halfW, height } = body;
  body.onGround = false;
  body.hitWall = false;

  pos.y += vel.y * dt;
  if (aabbHitsSolid(world, pos.x, pos.y, pos.z, halfW, height)) {
    if (vel.y < 0) {
      pos.y = Math.floor(pos.y) + 1;
      body.onGround = true;
    } else {
      pos.y = Math.floor(pos.y + height) - height - EPS;
    }
    vel.y = 0;
  }

  pos.x += vel.x * dt;
  if (aabbHitsSolid(world, pos.x, pos.y, pos.z, halfW, height)) {
    pos.x = vel.x > 0 ? Math.floor(pos.x + halfW) - halfW - EPS : Math.floor(pos.x - halfW) + 1 + halfW + EPS;
    vel.x = 0;
    body.hitWall = true;
  }

  pos.z += vel.z * dt;
  if (aabbHitsSolid(world, pos.x, pos.y, pos.z, halfW, height)) {
    pos.z = vel.z > 0 ? Math.floor(pos.z + halfW) - halfW - EPS : Math.floor(pos.z - halfW) + 1 + halfW + EPS;
    vel.z = 0;
    body.hitWall = true;
  }
}

// Шаг по сетке вдоль луча. Возвращает первый блок, в который можно целиться (не воздух и не вода).
export function raycastBlock(world, ox, oy, oz, dx, dy, dz, reach) {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const deltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * deltaX : Infinity;
  let tY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * deltaY : Infinity;
  let tZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * deltaZ : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  while (t <= reach) {
    const id = world.get(x, y, z);
    if (id !== 0 && !BLOCKS[id].liquid) return { x, y, z, nx, ny, nz, id, dist: t };
    if (tX < tY && tX < tZ) {
      x += stepX; t = tX; tX += deltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tY < tZ) {
      y += stepY; t = tY; tY += deltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tZ; tZ += deltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

// Расстояние до коробки тела вдоль луча или null, если луч не попал.
export function raycastBody(body, ox, oy, oz, dx, dy, dz, reach) {
  const { pos, halfW, height } = body;
  let tMin = 0;
  let tMax = reach;
  const axes = [
    [ox, dx, pos.x - halfW, pos.x + halfW],
    [oy, dy, pos.y, pos.y + height],
    [oz, dz, pos.z - halfW, pos.z + halfW],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-6) {
      if (o < lo || o > hi) return null;
    } else {
      let t0 = (lo - o) / d;
      let t1 = (hi - o) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

// Есть ли прямая видимость между двумя точками (стекло и закрытые двери её перекрывают).
export function hasLineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(dist * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (world.isSolid(Math.floor(ax + dx * t), Math.floor(ay + dy * t), Math.floor(az + dz * t))) return false;
  }
  return true;
}
