// Таблицы блоков, предметов и рецептов. Без зависимостей от браузера.

export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, WOOD_SIDE: 4, WOOD_TOP: 5, LEAVES: 6, SAND: 7,
  PLANKS: 8, BRICK: 9, GLASS: 10, WATER: 11, SNOW: 12, SNOW_SIDE: 13, DOOR: 14, TORCH_BOX: 15,
  TORCH_ICON: 16, PICK: 17, SWORD: 18, MEAT: 19, SKIN: 20,
};

export const ATLAS_COLS = 8;

const BLEED = 0.0006;
export function tileRect(tile) {
  const size = 1 / ATLAS_COLS;
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  return { u: col * size + BLEED, v: 1 - (row + 1) * size + BLEED, s: size - 2 * BLEED };
}

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, SAND: 6, PLANKS: 7, BRICK: 8, GLASS: 9,
  WATER: 10, SNOW: 11, TORCH: 12, DOOR_X: 13, DOOR_X_OPEN: 14, DOOR_Z: 15, DOOR_Z_OPEN: 16,
};

// Предметы, которые нельзя поставить, идут после блоков.
export const ITEM = { PICK: 100, SWORD: 101, MEAT: 102 };

function cube(name, top, side, bottom, hardness, extra = {}) {
  return { name, top, side, bottom, hardness, solid: true, opaque: true, blocksSky: true, ...extra };
}

const DOOR = { name: 'Дверь', hardness: 0.8, shape: 'door', opaque: false, blocksSky: false, drop: B.DOOR_X };

export const BLOCKS = {
  [B.AIR]: { name: 'Воздух', solid: false, opaque: false, blocksSky: false },
  [B.GRASS]: cube('Трава', TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT, 0.6, { drop: B.DIRT }),
  [B.DIRT]: cube('Земля', TILE.DIRT, TILE.DIRT, TILE.DIRT, 0.5),
  [B.STONE]: cube('Камень', TILE.STONE, TILE.STONE, TILE.STONE, 2.4, { toolBonus: true }),
  [B.WOOD]: cube('Дерево', TILE.WOOD_TOP, TILE.WOOD_SIDE, TILE.WOOD_TOP, 1.2),
  [B.LEAVES]: cube('Листва', TILE.LEAVES, TILE.LEAVES, TILE.LEAVES, 0.2, { opaque: false, cullSame: true }),
  [B.SAND]: cube('Песок', TILE.SAND, TILE.SAND, TILE.SAND, 0.5),
  [B.PLANKS]: cube('Доски', TILE.PLANKS, TILE.PLANKS, TILE.PLANKS, 1),
  [B.BRICK]: cube('Кирпич', TILE.BRICK, TILE.BRICK, TILE.BRICK, 2.4, { toolBonus: true }),
  [B.GLASS]: cube('Стекло', TILE.GLASS, TILE.GLASS, TILE.GLASS, 0.3,
    { opaque: false, blocksSky: false, cullSame: true, translucent: true }),
  [B.WATER]: { name: 'Вода', top: TILE.WATER, side: TILE.WATER, bottom: TILE.WATER, solid: false, opaque: false,
    blocksSky: false, cullSame: true, translucent: true, liquid: true },
  [B.SNOW]: cube('Снег', TILE.SNOW, TILE.SNOW_SIDE, TILE.DIRT, 0.5),
  [B.TORCH]: { name: 'Факел', hardness: 0.05, shape: 'torch', solid: false, opaque: false, blocksSky: false },
  [B.DOOR_X]: { ...DOOR, solid: true },
  [B.DOOR_X_OPEN]: { ...DOOR, solid: false },
  [B.DOOR_Z]: { ...DOOR, solid: true },
  [B.DOOR_Z_OPEN]: { ...DOOR, solid: false },
};

export const ITEMS = {
  [ITEM.PICK]: { name: 'Кирка', tile: TILE.PICK, stack: 1 },
  [ITEM.SWORD]: { name: 'Меч', tile: TILE.SWORD, stack: 1 },
  [ITEM.MEAT]: { name: 'Мясо', tile: TILE.MEAT, stack: 16 },
};

export const MEAT_HEAL = 6;

export function itemTile(id) {
  if (ITEMS[id]) return ITEMS[id].tile;
  if (id === B.TORCH) return TILE.TORCH_ICON;
  if (id === B.DOOR_X) return TILE.DOOR;
  return BLOCKS[id].side;
}

export function itemName(id) {
  return ITEMS[id] ? ITEMS[id].name : BLOCKS[id].name;
}

export function itemStack(id) {
  return ITEMS[id] ? ITEMS[id].stack : 64;
}

export function isPlaceable(id) {
  return !ITEMS[id] && !!BLOCKS[id];
}

export function isDoor(id) {
  return BLOCKS[id]?.shape === 'door';
}

export function toggledDoor(id) {
  return { [B.DOOR_X]: B.DOOR_X_OPEN, [B.DOOR_X_OPEN]: B.DOOR_X, [B.DOOR_Z]: B.DOOR_Z_OPEN, [B.DOOR_Z_OPEN]: B.DOOR_Z }[id];
}

// Секунды копания с учётом инструмента в руке.
export function mineTime(blockId, heldId) {
  const block = BLOCKS[blockId];
  if (heldId === ITEM.PICK) return block.hardness * (block.toolBonus ? 0.25 : 0.6);
  return block.hardness;
}

export function dropOf(blockId) {
  const block = BLOCKS[blockId];
  return block.drop ?? blockId;
}

export const RECIPES = [
  { out: B.PLANKS, count: 4, need: [[B.WOOD, 1]] },
  { out: B.TORCH, count: 4, need: [[B.WOOD, 1]] },
  { out: B.DOOR_X, count: 1, need: [[B.PLANKS, 4]] },
  { out: B.BRICK, count: 2, need: [[B.STONE, 2]] },
  { out: B.GLASS, count: 1, need: [[B.SAND, 2]] },
  { out: ITEM.PICK, count: 1, need: [[B.PLANKS, 2], [B.STONE, 3]] },
  { out: ITEM.SWORD, count: 1, need: [[B.PLANKS, 1], [B.STONE, 2]] },
];
