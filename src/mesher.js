import { B, BLOCKS, TILE, tileRect } from './blocks.js';
import { CHUNK_HEIGHT, CHUNK_SIZE, blockIndex } from './world.js';

export const TORCH_RADIUS = 10;

const FACES = [
  { n: [1, 0, 0], t: [2, 1], shade: 0.8, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], t: [2, 1], shade: 0.8, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], t: [0, 2], shade: 1, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], t: [0, 2], shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], t: [0, 1], shade: 0.68, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], t: [0, 1], shade: 0.68, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const AO_LEVELS = [0.5, 0.68, 0.84, 1];
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Bucket {
  positions = [];
  uvs = [];
  shades = [];
  skies = [];
  torches = [];
  indices = [];
  count = 0;

  quad(points, tile, shades, skies, torches) {
    const r = tileRect(tile);
    for (let i = 0; i < 4; i++) {
      this.positions.push(points[i][0], points[i][1], points[i][2]);
      this.uvs.push(r.u + UV[i][0] * r.s, r.v + UV[i][1] * r.s);
      this.shades.push(shades[i]);
      this.skies.push(skies[i]);
      this.torches.push(torches[i]);
    }
    const c = this.count;
    // Диагональ квадрата выбираем так, чтобы затенение углов не давало анизотропии.
    if (shades[0] + shades[2] >= shades[1] + shades[3]) {
      this.indices.push(c, c + 1, c + 2, c, c + 2, c + 3);
    } else {
      this.indices.push(c + 1, c + 2, c + 3, c + 1, c + 3, c);
    }
    this.count += 4;
  }

  freeze() {
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      shades: new Float32Array(this.shades),
      skies: new Float32Array(this.skies),
      torches: new Float32Array(this.torches),
      indices: new Uint32Array(this.indices),
      empty: this.count === 0,
    };
  }
}

function faceTile(block, face) {
  if (face.n[1] === 1) return block.top;
  if (face.n[1] === -1) return block.bottom;
  return block.side;
}

// Собирает геометрию чанка: непрозрачные блоки и отдельно вода со стеклом.
// Все соседние чанки должны быть загружены: от них зависят грани и тени на границе.
export function buildChunkGeometry(world, chunk) {
  const opaque = new Bucket();
  const translucent = new Bucket();
  const ox = chunk.cx * CHUNK_SIZE;
  const oz = chunk.cz * CHUNK_SIZE;

  const grid = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) grid.push(world.getChunk(chunk.cx + dx, chunk.cz + dz));
  }
  const chunkAt = (x, z) => grid[(x < 0 ? 0 : x >= CHUNK_SIZE ? 2 : 1) + (z < 0 ? 0 : z >= CHUNK_SIZE ? 2 : 1) * 3];
  const wrap = (v) => (v < 0 ? v + CHUNK_SIZE : v >= CHUNK_SIZE ? v - CHUNK_SIZE : v);
  const blockAt = (x, y, z) => {
    if (y < 0) return B.STONE;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const c = chunkAt(x, z);
    return c ? c.blocks[blockIndex(wrap(x), y, wrap(z))] : B.STONE;
  };
  const opaqueAt = (x, y, z) => BLOCKS[blockAt(x, y, z)].opaque;
  const skyAt = (x, y, z) => {
    const c = chunkAt(x, z);
    if (!c) return 1;
    const top = c.heights[wrap(x) + wrap(z) * CHUNK_SIZE];
    return y >= top ? 1 : Math.max(0.3, 0.6 - (top - y) * 0.03);
  };

  const torches = world.torchesNear(ox + CHUNK_SIZE / 2, oz + CHUNK_SIZE / 2, CHUNK_SIZE / 2 + TORCH_RADIUS);
  const torchAt = (wx, wy, wz) => {
    let best = 0;
    for (const t of torches) {
      const d = Math.hypot(wx - t[0] - 0.5, wy - t[1] - 0.5, wz - t[2] - 0.5);
      const light = 1 - d / TORCH_RADIUS;
      if (light > best) best = light;
    }
    return best;
  };

  const addBox = (x, y, z, x0, y0, z0, x1, y1, z1, tile, glow) => {
    const sky = skyAt(x, y, z);
    const torch = glow ?? torchAt(ox + x + 0.5, y + 0.5, oz + z + 0.5);
    for (const face of FACES) {
      const points = face.corners.map((c) => [
        x + (c[0] ? x1 : x0), y + (c[1] ? y1 : y0), z + (c[2] ? z1 : z0),
      ]);
      opaque.quad(points, tile, [face.shade, face.shade, face.shade, face.shade], [sky, sky, sky, sky], [torch, torch, torch, torch]);
    }
  };

  const points = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const shades = [0, 0, 0, 0];
  const skies = [0, 0, 0, 0];
  const lights = [0, 0, 0, 0];

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.blocks[blockIndex(x, y, z)];
        if (id === B.AIR) continue;
        const block = BLOCKS[id];

        if (block.shape === 'torch') {
          addBox(x, y, z, 0.44, 0, 0.44, 0.56, 0.62, 0.56, TILE.TORCH_BOX, 1);
          continue;
        }
        if (block.shape === 'door') {
          const t = 0.14;
          if (id === B.DOOR_X) addBox(x, y, z, 0, 0, 0.5 - t / 2, 1, 1, 0.5 + t / 2, TILE.DOOR);
          if (id === B.DOOR_Z) addBox(x, y, z, 0.5 - t / 2, 0, 0, 0.5 + t / 2, 1, 1, TILE.DOOR);
          if (id === B.DOOR_X_OPEN) addBox(x, y, z, 0, 0, 0, t, 1, 1, TILE.DOOR);
          if (id === B.DOOR_Z_OPEN) addBox(x, y, z, 0, 0, 0, 1, 1, t, TILE.DOOR);
          continue;
        }

        const bucket = block.translucent ? translucent : opaque;
        const lowered = block.liquid && blockAt(x, y + 1, z) !== B.WATER;

        for (const face of FACES) {
          const [nx, ny, nz] = face.n;
          const qx = x + nx;
          const qy = y + ny;
          const qz = z + nz;
          const neighbor = blockAt(qx, qy, qz);
          if (BLOCKS[neighbor].opaque) continue;
          if (block.cullSame && neighbor === id) continue;

          const [ta, tb] = face.t;
          const tile = faceTile(block, face);
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            const p = points[i];
            p[0] = x + c[0];
            p[1] = y + c[1] - (lowered && c[1] === 1 ? 0.12 : 0);
            p[2] = z + c[2];

            const off = [0, 0, 0];
            off[ta] = c[ta] ? 1 : -1;
            const offB = [0, 0, 0];
            offB[tb] = c[tb] ? 1 : -1;
            const s1 = opaqueAt(qx + off[0], qy + off[1], qz + off[2]) ? 1 : 0;
            const s2 = opaqueAt(qx + offB[0], qy + offB[1], qz + offB[2]) ? 1 : 0;
            const s3 = opaqueAt(qx + off[0] + offB[0], qy + off[1] + offB[1], qz + off[2] + offB[2]) ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - s1 - s2 - s3;
            shades[i] = face.shade * AO_LEVELS[ao];

            skies[i] = (
              skyAt(qx, qy, qz) +
              skyAt(qx + off[0], qy + off[1], qz + off[2]) +
              skyAt(qx + offB[0], qy + offB[1], qz + offB[2]) +
              skyAt(qx + off[0] + offB[0], qy + off[1] + offB[1], qz + off[2] + offB[2])
            ) / 4;

            lights[i] = torches.length ? torchAt(ox + p[0], p[1], oz + p[2]) : 0;
          }
          bucket.quad(points, tile, shades, skies, lights);
        }
      }
    }
  }

  return { opaque: opaque.freeze(), translucent: translucent.freeze() };
}
