import { ATLAS_COLS, TILE } from './blocks.js';

const SIZE = 16;

function rng(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vary = (rgb, r, amount) => {
  const d = (r() - 0.5) * amount;
  return [rgb[0] + d, rgb[1] + d, rgb[2] + d, 255];
};

const GRASS = [96, 152, 60];
const DIRT = [124, 88, 60];
const STONE = [128, 128, 130];
const PLANK = [176, 136, 84];
const SNOW = [238, 244, 250];

function dirtPixel(r) {
  return vary(DIRT, r, 36);
}

// Каждая функция отдаёт цвет пикселя (x, y) плитки 16×16; y растёт вниз.
const PAINTERS = {
  [TILE.GRASS_TOP]: (x, y, r) => vary(GRASS, r, 40),
  [TILE.GRASS_SIDE]: (x, y, r) => {
    const edge = 3 + Math.floor((Math.sin(x * 1.9) + Math.sin(x * 0.7 + 2)) * 0.8 + 0.8);
    return y < edge ? vary(GRASS, r, 36) : dirtPixel(r);
  },
  [TILE.DIRT]: (x, y, r) => dirtPixel(r),
  [TILE.STONE]: (x, y, r) => {
    const crack = Math.sin(x * 0.9 + y * 0.4) * Math.cos(y * 1.3 - x * 0.3) > 0.72;
    return vary(crack ? [98, 98, 102] : STONE, r, 24);
  },
  [TILE.WOOD_SIDE]: (x, y, r) => {
    const band = x % 4 === 0 ? 0.72 : x % 4 === 2 ? 0.88 : 1;
    return vary([136 * band, 98 * band, 60 * band], r, 14);
  },
  [TILE.WOOD_TOP]: (x, y, r) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7.2) return vary([96, 68, 42], r, 12);
    return vary(Math.floor(d) % 3 === 0 ? [150, 114, 70] : [184, 148, 96], r, 10);
  },
  [TILE.LEAVES]: (x, y, r) => {
    if (r() < 0.09) return [0, 0, 0, 0];
    return vary([58, 118, 44], r, 44);
  },
  [TILE.SAND]: (x, y, r) => vary([222, 206, 150], r, 18),
  [TILE.PLANKS]: (x, y, r) => {
    if (y % 4 === 3) return vary([112, 84, 50], r, 8);
    const seam = (x + (y >> 2) * 7) % 16 === 0;
    return seam ? [122, 92, 56, 255] : vary(PLANK, r, 18);
  },
  [TILE.BRICK]: (x, y, r) => {
    const row = y >> 2;
    const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
    return mortar ? vary([186, 178, 168], r, 10) : vary([156, 76, 58], r, 24);
  },
  [TILE.GLASS]: (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const glint = x - y > 3 && x - y < 7 && x > 5 && y < 9;
    if (edge) return [214, 238, 244, 235];
    return glint ? [255, 255, 255, 110] : [190, 228, 240, 42];
  },
  [TILE.WATER]: (x, y, r) => {
    const d = (r() - 0.5) * 7;
    return [46 + d, 106 + d, 196 + d, 170];
  },
  [TILE.SNOW]: (x, y, r) => vary(SNOW, r, 10),
  [TILE.SNOW_SIDE]: (x, y, r) => {
    const edge = 4 + Math.floor((Math.sin(x * 1.6) + 1) * 0.9);
    return y < edge ? vary(SNOW, r, 10) : dirtPixel(r);
  },
  [TILE.DOOR]: (x, y, r) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return vary([88, 60, 36], r, 8);
    if (x > 3 && x < 12 && y > 2 && y < 7) return [176, 214, 226, 255];
    if (x === 12 && (y === 8 || y === 9)) return [218, 190, 90, 255];
    return vary(x % 5 === 0 ? [124, 90, 54] : [148, 108, 66], r, 12);
  },
  [TILE.TORCH_BOX]: (x, y, r) => (y < 5 ? vary([255, 196, 72], r, 40) : vary([104, 74, 44], r, 14)),
  [TILE.SKIN]: (x, y, r) => vary([222, 178, 140], r, 10),
};

const SPRITES = {
  [TILE.TORCH_ICON]: [
    '................', '................', '.......YY.......', '......YOOY......', '......YOOY......',
    '.......OO.......', '.......WW.......', '.......WW.......', '.......WW.......', '.......WW.......',
    '.......WW.......', '.......WW.......', '.......WW.......', '.......WW.......', '................', '................',
  ],
  [TILE.PICK]: [
    '................', '...SSSSSSS......', '..SSLLLLLLSS....', '.SS......WLSS...', '.........WW.SS..', '........WW...S..',
    '.......WW....S..', '......WW.....S..', '.....WW.........', '....WW..........', '...WW...........', '..WW............',
    '.WW.............', 'WW..............', '................', '................',
  ],
  [TILE.SWORD]: [
    '.............LL.', '............LSS.', '...........LSS..', '..........LSS...', '.........LSS....', '........LSS.....',
    '.......LSS......', '......LSS.......', '.Y...LSS........', '.YY.LSS.........', '..YYSS..........', '...YY...........',
    '..WWYY..........', '.WW..YY.........', 'WW..............', '................',
  ],
  [TILE.MEAT]: [
    '................', '................', '.....RRRRR......', '...RRPPPPRR.....', '..RRPPPPPPPR....', '..RPPPRPPPPPR...',
    '..RPPRRPPPPPR...', '..RPPPPPPRPPR...', '...RPPPPPRRPR...', '....RPPPPPPR.GG.', '.....RRRRRRGGGG.', '..........GGGG..',
    '...........GG...', '................', '................', '................',
  ],
};
const SPRITE_COLORS = {
  Y: [255, 214, 92, 255], O: [255, 140, 40, 255], W: [122, 86, 50, 255], S: [150, 152, 158, 255],
  L: [214, 216, 222, 255], R: [176, 58, 56, 255], P: [226, 124, 118, 255], G: [238, 232, 216, 255],
};

export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE * ATLAS_COLS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(canvas.width, canvas.height);

  const put = (tile, x, y, c) => {
    const px = (tile % ATLAS_COLS) * SIZE + x;
    const py = Math.floor(tile / ATLAS_COLS) * SIZE + y;
    const i = (py * canvas.width + px) * 4;
    image.data[i] = c[0];
    image.data[i + 1] = c[1];
    image.data[i + 2] = c[2];
    image.data[i + 3] = c[3];
  };

  for (const [tile, paint] of Object.entries(PAINTERS)) {
    const r = rng(Number(tile) * 977 + 11);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) put(Number(tile), x, y, paint(x, y, r));
    }
  }
  for (const [tile, rows] of Object.entries(SPRITES)) {
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== '.') put(Number(tile), x, y, SPRITE_COLORS[ch]);
      });
    });
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function tileIcon(atlas, tile) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  canvas.getContext('2d').drawImage(atlas, col * SIZE, row * SIZE, SIZE, SIZE, 0, 0, SIZE, SIZE);
  return canvas.toDataURL();
}

// Средний цвет плитки: им красятся осколки разбитого блока.
export function tileColor(atlas, tile) {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  const data = atlas.getContext('2d').getImageData(col * SIZE, row * SIZE, SIZE, SIZE).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 60) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
}

export function createFace(skin, eyes, mouth) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = eyes;
  ctx.fillRect(1, 3, 2, 1);
  ctx.fillRect(5, 3, 2, 1);
  ctx.fillStyle = mouth;
  ctx.fillRect(2, 5, 4, 1);
  ctx.fillRect(3, 6, 1, 1);
  return canvas;
}

export function createCloudTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = rng(424242);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 44; i++) {
    const w = 6 + Math.floor(r() * 18);
    const h = 3 + Math.floor(r() * 8);
    const x = Math.floor(r() * size);
    const y = Math.floor(r() * size);
    ctx.fillRect(x, y, w, h);
    ctx.fillRect(x + 2, y - 2, Math.max(1, w - 5), 2);
  }
  return canvas;
}
