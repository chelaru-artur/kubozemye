import { B, BLOCKS } from './blocks.js';
import { fbm, hash2 } from './noise.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 64;
export const SEA_LEVEL = 20;
const SNOW_LINE = 44;

export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const blockIndex = (x, y, z) => x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
const mod = (v) => ((v % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

export class World {
  constructor(seed, edits = new Map()) {
    this.seed = seed;
    this.edits = edits; // chunkKey -> Map(blockIndex -> id): всё, что изменил игрок
    this.chunks = new Map();
    this.onChange = null;
  }

  // Высота рельефа; не зависит от загруженных чанков.
  terrainHeight(x, z) {
    const land = fbm(x / 130, z / 130, this.seed, 3);
    const hills = fbm(x / 34, z / 34, this.seed + 7, 3);
    const peaks = Math.max(0, fbm(x / 170, z / 170, this.seed + 13, 2) - 0.54);
    const h = 25 + (land - 0.46) * 34 + (hills - 0.5) * 11 + peaks * peaks * 620;
    return Math.max(3, Math.min(CHUNK_HEIGHT - 8, Math.floor(h)));
  }

  isTreeAt(x, z) {
    const forest = fbm(x / 60, z / 60, this.seed + 29, 2);
    if (hash2(x, z, this.seed + 41) > (forest > 0.52 ? 0.035 : 0.004)) return false;
    const h = this.terrainHeight(x, z);
    return h > SEA_LEVEL + 1 && h < SNOW_LINE - 6;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = this.terrainHeight(ox + x, oz + z);
        const beach = h <= SEA_LEVEL + 1;
        const snowy = h >= SNOW_LINE;
        const rocky = h >= SNOW_LINE - 6 && !snowy;
        for (let y = 0; y <= h; y++) {
          let id = B.STONE;
          if (y > h - 4 && !rocky) id = beach ? B.SAND : B.DIRT;
          if (y === h && !beach && !rocky) id = snowy ? B.SNOW : B.GRASS;
          blocks[blockIndex(x, y, z)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[blockIndex(x, y, z)] = B.WATER;
      }
    }

    // Деревья проверяем и в соседних чанках: крона заходит через границу.
    for (let wz = oz - 3; wz < oz + CHUNK_SIZE + 3; wz++) {
      for (let wx = ox - 3; wx < ox + CHUNK_SIZE + 3; wx++) {
        if (this.isTreeAt(wx, wz)) this.#stampTree(blocks, ox, oz, wx, wz);
      }
    }

    const chunk = { cx, cz, blocks, heights: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE), torches: [] };
    const edits = this.edits.get(chunkKey(cx, cz));
    if (edits) {
      for (const [index, id] of edits) {
        blocks[index] = id;
        if (id === B.TORCH) {
          const y = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
          const rest = index - y * CHUNK_SIZE * CHUNK_SIZE;
          chunk.torches.push([ox + rest % CHUNK_SIZE, y, oz + Math.floor(rest / CHUNK_SIZE)]);
        }
      }
    }
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) this.#recomputeHeight(chunk, x, z);
    }
    return chunk;
  }

  #stampTree(blocks, ox, oz, wx, wz) {
    const base = this.terrainHeight(wx, wz) + 1;
    const trunk = 4 + Math.floor(hash2(wx, wz, this.seed + 43) * 3);
    const put = (x, y, z, id, replace) => {
      const lx = x - ox;
      const lz = z - oz;
      if (lx < 0 || lz < 0 || lx >= CHUNK_SIZE || lz >= CHUNK_SIZE || y >= CHUNK_HEIGHT) return;
      const index = blockIndex(lx, y, lz);
      if (replace || blocks[index] === B.AIR) blocks[index] = id;
    };
    const top = base + trunk;
    for (let y = top - 2; y <= top + 1; y++) {
      const r = y >= top ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y === top + 1 || hash2(wx + dx + y, wz + dz, this.seed + 47) < 0.5)) continue;
          put(wx + dx, y, wz + dz, B.LEAVES, false);
        }
      }
    }
    for (let y = base; y < top; y++) put(wx, y, wz, B.WOOD, true);
  }

  #recomputeHeight(chunk, x, z) {
    let y = CHUNK_HEIGHT - 1;
    while (y >= 0 && !BLOCKS[chunk.blocks[blockIndex(x, y, z)]].blocksSky) y--;
    chunk.heights[x + z * CHUNK_SIZE] = y + 1;
  }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generateChunk(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  unloadChunk(cx, cz) {
    this.chunks.delete(chunkKey(cx, cz));
  }

  get(x, y, z) {
    if (y < 0) return B.STONE;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const chunk = this.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    return chunk ? chunk.blocks[blockIndex(mod(x), y, mod(z))] : B.AIR;
  }

  set(x, y, z, id) {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;
    const lx = mod(x);
    const lz = mod(z);
    const index = blockIndex(lx, y, lz);
    const old = chunk.blocks[index];
    if (old === id) return false;
    chunk.blocks[index] = id;

    const key = chunkKey(cx, cz);
    if (!this.edits.has(key)) this.edits.set(key, new Map());
    this.edits.get(key).set(index, id);

    this.#recomputeHeight(chunk, lx, lz);
    if (old === B.TORCH) chunk.torches = chunk.torches.filter((t) => t[0] !== x || t[1] !== y || t[2] !== z);
    if (id === B.TORCH) chunk.torches.push([x, y, z]);
    this.onChange?.(x, y, z, old, id);
    return true;
  }

  isSolid(x, y, z) {
    return BLOCKS[this.get(x, y, z)].solid;
  }

  // Первая свободная высота над поверхностью столбца.
  surfaceY(x, z) {
    const chunk = this.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    return chunk ? chunk.heights[mod(x) + mod(z) * CHUNK_SIZE] : this.terrainHeight(x, z) + 1;
  }

  isUnderSky(x, y, z) {
    return y >= this.surfaceY(x, z);
  }

  torchesNear(x, z, radius) {
    const found = [];
    const minX = Math.floor((x - radius) / CHUNK_SIZE);
    const maxX = Math.floor((x + radius) / CHUNK_SIZE);
    const minZ = Math.floor((z - radius) / CHUNK_SIZE);
    const maxZ = Math.floor((z + radius) / CHUNK_SIZE);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const chunk = this.getChunk(cx, cz);
        if (chunk) found.push(...chunk.torches);
      }
    }
    return found;
  }

  findSpawn() {
    for (let r = 0; r < 400; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        const h = this.terrainHeight(x, z);
        if (h > SEA_LEVEL + 1 && h < SNOW_LINE - 8 && !this.isTreeAt(x, z)) return { x: x + 0.5, z: z + 0.5 };
      }
    }
    return { x: 0.5, z: 0.5 };
  }

  serializeEdits() {
    const out = {};
    for (const [key, edits] of this.edits) out[key] = [...edits].flat();
    return out;
  }

  static parseEdits(data) {
    const edits = new Map();
    for (const key of Object.keys(data ?? {})) {
      const flat = data[key];
      const map = new Map();
      for (let i = 0; i < flat.length; i += 2) map.set(flat[i], flat[i + 1]);
      edits.set(Number(key), map);
    }
    return edits;
  }
}
