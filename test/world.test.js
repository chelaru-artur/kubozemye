import assert from 'node:assert/strict';
import { test } from 'node:test';
import { B, RECIPES, mineTime, ITEM, BLOCKS, isPlaceable } from '../src/blocks.js';
import { buildChunkGeometry } from '../src/mesher.js';
import { moveBody, raycastBlock, raycastBody, hasLineOfSight } from '../src/physics.js';
import { CHUNK_SIZE, World } from '../src/world.js';

function loaded(seed = 123, radius = 2) {
  const world = new World(seed);
  for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) world.ensureChunk(x, z);
  return world;
}

test('один seed даёт одинаковый мир, другой seed — другой', () => {
  const a = new World(5).generateChunk(3, -2).blocks;
  const b = new World(5).generateChunk(3, -2).blocks;
  const c = new World(6).generateChunk(3, -2).blocks;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('в мире есть трава, земля, камень, вода и деревья', () => {
  const world = new World(77);
  const seen = new Set();
  for (let z = -8; z < 8; z++) {
    for (let x = -8; x < 8; x++) for (const id of world.generateChunk(x, z).blocks) seen.add(id);
  }
  for (const id of [B.GRASS, B.DIRT, B.STONE, B.WOOD, B.LEAVES, B.WATER, B.SAND]) {
    assert.ok(seen.has(id), BLOCKS[id].name);
  }
});

test('кроны деревьев на границе чанков совпадают', () => {
  const world = loaded(9, 4);
  let wood = 0;
  for (const chunk of world.chunks.values()) for (const id of chunk.blocks) if (id === B.WOOD) wood++;
  assert.ok(wood > 0);
  // Сгенерированный заново чанк идентичен: дерево не зависит от порядка загрузки.
  const again = new World(9).generateChunk(1, 1).blocks;
  assert.deepEqual(world.getChunk(1, 1).blocks, again);
});

test('постройка переживает выгрузку чанка и сохранение', () => {
  const world = loaded();
  world.set(5, 40, 5, B.BRICK);
  world.unloadChunk(0, 0);
  world.ensureChunk(0, 0);
  assert.equal(world.get(5, 40, 5), B.BRICK);

  const restored = new World(world.seed, World.parseEdits(JSON.parse(JSON.stringify(world.serializeEdits()))));
  restored.ensureChunk(0, 0);
  assert.equal(restored.get(5, 40, 5), B.BRICK);
});

test('отрицательные координаты адресуют правильный блок', () => {
  const world = loaded();
  world.set(-1, 50, -17, B.PLANKS);
  assert.equal(world.get(-1, 50, -17), B.PLANKS);
  assert.equal(world.getChunk(-1, -2).blocks.filter((id) => id === B.PLANKS).length, 1);
});

test('факелы восстанавливаются из сохранения и удаляются', () => {
  const world = loaded();
  world.set(3, 50, 3, B.TORCH);
  assert.equal(world.torchesNear(3, 3, 5).length, 1);
  const restored = new World(world.seed, World.parseEdits(world.serializeEdits()));
  restored.ensureChunk(0, 0);
  assert.deepEqual(restored.torchesNear(3, 3, 5), [[3, 50, 3]]);
  world.set(3, 50, 3, B.AIR);
  assert.equal(world.torchesNear(3, 3, 5).length, 0);
});

test('крыша закрывает небо, снятие крыши открывает', () => {
  const world = loaded();
  const ground = world.surfaceY(4, 4);
  assert.ok(world.isUnderSky(4, ground, 4));
  world.set(4, ground + 5, 4, B.PLANKS);
  assert.ok(!world.isUnderSky(4, ground, 4));
  world.set(4, ground + 5, 4, B.AIR);
  assert.ok(world.isUnderSky(4, ground, 4));
});

test('тело падает на землю и не проходит сквозь стену', () => {
  const world = loaded();
  const h = world.surfaceY(0, 0);
  const body = { pos: { x: 0.5, y: h + 5, z: 0.5 }, vel: { x: 0, y: 0, z: 0 }, halfW: 0.3, height: 1.8, onGround: false };
  for (let i = 0; i < 200; i++) {
    body.vel.y -= 28 * 0.016;
    moveBody(world, body, 0.016);
  }
  assert.equal(body.pos.y, h);
  assert.ok(body.onGround);

  for (let y = 0; y < 3; y++) world.set(3, h + y, 0, B.STONE);
  for (let i = 0; i < 120; i++) {
    body.vel.y -= 28 * 0.016;
    body.vel.x = 5;
    moveBody(world, body, 0.016);
  }
  assert.ok(body.pos.x < 3 - 0.3 + 0.01, `x=${body.pos.x}`);
  assert.ok(body.hitWall);
});

test('луч находит блок и сторону, в которую ставить новый', () => {
  const world = loaded();
  const h = world.surfaceY(0, 0);
  const hit = raycastBlock(world, 0.5, h + 1.6, 0.5, 0, -1, 0, 5);
  assert.deepEqual([hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz], [0, h - 1, 0, 0, 1, 0]);
  assert.equal(raycastBlock(world, 0.5, h + 20, 0.5, 0, 1, 0, 5), null);
});

test('луч попадает в тело моба и мимо него', () => {
  const mob = { pos: { x: 3, y: 0, z: 0 }, halfW: 0.3, height: 1.9 };
  assert.ok(raycastBody(mob, 0, 1, 0, 1, 0, 0, 5) > 2);
  assert.equal(raycastBody(mob, 0, 1, 0, 0, 0, 1, 5), null);
});

test('стена перекрывает видимость: зомби не ударит сквозь неё', () => {
  const world = loaded();
  assert.ok(hasLineOfSight(world, 0.5, 60, 0.5, 5.5, 60, 0.5));
  world.set(3, 60, 0, B.BRICK);
  assert.ok(!hasLineOfSight(world, 0.5, 60.5, 0.5, 5.5, 60.5, 0.5));
});

test('геометрия чанка: без лишних граней и с корректными индексами', () => {
  const world = loaded();
  const { opaque, translucent } = buildChunkGeometry(world, world.getChunk(0, 0));
  assert.ok(!opaque.empty);
  assert.equal(opaque.positions.length / 3, opaque.uvs.length / 2);
  assert.equal(opaque.indices.length % 6, 0);
  assert.ok(Math.max(...opaque.indices) < opaque.positions.length / 3);
  for (const v of opaque.positions) assert.ok(Number.isFinite(v));
  // Всего блоков в столбце — десятки, а граней только на поверхности.
  assert.ok(opaque.positions.length / 12 < CHUNK_SIZE * CHUNK_SIZE * 16);
  assert.ok(translucent.positions.length >= 0);
});

test('поставленный блок сразу появляется в геометрии', () => {
  const world = loaded();
  const chunk = world.getChunk(0, 0);
  const before = buildChunkGeometry(world, chunk).opaque.indices.length;
  world.set(8, 55, 8, B.STONE);
  const after = buildChunkGeometry(world, chunk).opaque.indices.length;
  assert.equal(after - before, 36);
});

test('кирка ускоряет добычу камня, рецепты ссылаются на существующие предметы', () => {
  assert.ok(mineTime(B.STONE, ITEM.PICK) < mineTime(B.STONE, B.DIRT));
  for (const recipe of RECIPES) {
    for (const [id, n] of recipe.need) {
      assert.ok(isPlaceable(id) && n > 0);
    }
  }
});

test('рюкзак: стопки, создание предметов и откат при нехватке места', async () => {
  const { Inventory, SLOT_COUNT } = await import('../src/inventory.js');
  const inv = new Inventory();
  assert.equal(inv.add(B.DIRT, 70), 0);
  assert.equal(inv.slots[0].n, 64);
  assert.equal(inv.slots[1].n, 6);
  inv.remove(B.DIRT, 66);
  assert.equal(inv.count(B.DIRT), 4);

  const planks = RECIPES.find((r) => r.out === B.PLANKS);
  assert.equal(inv.craft(planks), false);
  inv.add(B.WOOD, 1);
  assert.equal(inv.craft(planks), true);
  assert.equal(inv.count(B.PLANKS), 4);
  assert.equal(inv.count(B.WOOD), 0);

  const full = new Inventory();
  full.slots = new Array(SLOT_COUNT).fill(null).map(() => ({ id: B.STONE, n: 64 }));
  full.slots[0] = { id: B.WOOD, n: 2 };
  assert.equal(full.craft(planks), false);
  assert.equal(full.count(B.WOOD), 2);
});
