import THREE from './three.js';
import { Sound } from './audio.js';
import {
  B, BLOCKS, ITEM, MEAT_HEAL, TILE, dropOf, isDoor, isPlaceable, itemName, itemTile, mineTime, tileRect, toggledDoor,
} from './blocks.js';
import { Input } from './input.js';
import { HOTBAR_SIZE, Inventory } from './inventory.js';
import { TORCH_RADIUS, buildChunkGeometry } from './mesher.js';
import { MobManager } from './mobs.js';
import { aabbHitsSolid, moveBody, raycastBlock } from './physics.js';
import { createAtlas, createCloudTexture, tileColor } from './textures.js';
import { UI } from './ui.js';
import { CHUNK_HEIGHT, CHUNK_SIZE, World, chunkKey } from './world.js';

const SAVE_KEY = 'kubozemye.save.v1';
// Страница проверки релиза запускает игру с ?check: отдельный мир, сохранение игрока не затрагивается.
const CHECK_MODE = new URLSearchParams(window.location.search).has('check');
const DAY_LENGTH = 720; // секунд на полные сутки
const REACH = 5;
const ATTACK_REACH = 3.6;
const MAX_HP = 20;
const GRAVITY = 28;

const VERTEX = `
attribute float aShade;
attribute float aSky;
attribute float aTorch;
varying vec2 vUv;
varying float vShade;
varying float vSky;
varying float vTorch;
varying float vDist;
void main() {
  vUv = uv;
  vShade = aShade;
  vSky = aSky;
  vTorch = aTorch;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = `
uniform sampler2D uMap;
uniform float uDay;
uniform float uCut;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
varying vec2 vUv;
varying float vShade;
varying float vSky;
varying float vTorch;
varying float vDist;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < uCut) discard;
  vec3 torch = vec3(1.0, 0.8, 0.55) * pow(vTorch, 1.4) * 1.15;
  vec3 light = max(max(vec3(vSky * uDay), torch), vec3(0.035));
  vec3 color = tex.rgb * light * vShade;
  gl_FragColor = vec4(mix(color, uFogColor, smoothstep(uFogNear, uFogFar, vDist)), tex.a);
}`;

// Цвета и текстуры храним как есть, без перевода в линейное пространство.
THREE.ColorManagement.enabled = false;

const SKY_DAY = new THREE.Color('#86c0ee');
const SKY_DUSK = new THREE.Color('#e58a5a');
const SKY_NIGHT = new THREE.Color('#080d20');

const HINTS = [
  { text: 'Подойди к дереву, наведи прицел на ствол и держи кирку', done: (g) => g.inventory.count(B.WOOD) >= 3 },
  { text: 'Открой рюкзак и сделай доски из дерева', done: (g) => g.inventory.count(B.PLANKS) > 0 },
  { text: 'Выбери доски внизу и строй: стены, крыша, дверь', done: (g) => g.stats.placed >= 8 },
  { text: 'Сделай факелы и дверь: ночью выйдут зомби', done: (g) => g.stats.placed >= 30 },
];

function loadSave() {
  if (CHECK_MODE) return { seed: 4242 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function dayCurve(t) {
  const sun = -Math.cos(t * Math.PI * 2);
  const k = Math.min(1, Math.max(0, (sun + 0.15) / 0.4));
  return { sun, light: 0.14 + 0.86 * k * k * (3 - 2 * k), k };
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'menu';
    this.sound = new Sound();
    this.atlasCanvas = createAtlas();

    this.ui = new UI(this.atlasCanvas, {
      onHotbar: (i) => this.selectSlot(i),
      onInventory: () => this.toggleInventory(),
      onEscape: () => this.escape(),
      onPlay: () => this.play(),
      onRespawn: () => this.respawn(),
      onNewWorld: () => this.newWorld(),
      onToggleSound: () => this.toggleSound(),
      onCraft: (recipe) => this.craft(recipe),
    });

    this.input = new Input(canvas, this.ui, {
      onHotbar: (i) => this.selectSlot(i),
      onScroll: (d) => this.selectSlot((this.inventory.selected + d + HOTBAR_SIZE) % HOTBAR_SIZE),
      onInventory: () => this.toggleInventory(),
      onEscape: () => this.escape(),
    });

    const touch = this.input.touchMode;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.viewChunks = touch ? 4 : 7;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.#createMaterials();
    this.#createSky();
    this.#createEffects();

    this.meshes = new Map();
    this.dirty = new Set();
    this.lastChunk = null;
    this.mining = null;
    this.placeCooldown = 0;
    this.attackCooldown = 0;
    this.digSoundTimer = 0;
    this.swing = 0;
    this.bob = 0;
    this.cloudDrift = 0;
    this.saveTimer = 0;
    this.clockTimer = 0;
    this.fpsSamples = [];
    this.lastFrame = performance.now();

    this.#loadWorld(loadSave());

    window.addEventListener('resize', () => this.#resize());
    window.visualViewport?.addEventListener('resize', () => this.#resize());
    this.#resize();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
        if (this.state === 'playing') this.escape();
      }
    });
    window.addEventListener('pagehide', () => this.save());

    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ---------- Мир и сохранение ----------

  #loadWorld(save) {
    for (const key of [...this.meshes.keys()]) this.#disposeMesh(key);
    this.dirty.clear();
    this.mobs?.clear();
    this.lastChunk = null;

    const seed = save?.seed ?? Math.floor(Math.random() * 1e6);
    this.world = new World(seed, World.parseEdits(save?.edits));
    this.world.onChange = (x, y, z, oldId, newId) => this.#onBlockChange(x, y, z, oldId, newId);
    this.inventory = new Inventory(save?.slots);
    this.inventory.selected = save?.selected ?? 0;
    this.time = save?.time ?? 0.3;
    this.dayNumber = save?.dayNumber ?? 1;
    this.stats = { placed: save?.placed ?? 0 };
    this.hintIndex = save?.hintIndex ?? 0;
    this.hasStarted = !!save;

    const spawn = this.world.findSpawn();
    this.spawn = spawn;
    this.player = {
      pos: { x: save?.x ?? spawn.x, y: save?.y ?? 0, z: save?.z ?? spawn.z },
      vel: { x: 0, y: 0, z: 0 },
      halfW: 0.3,
      height: 1.8,
      onGround: false,
      hitWall: false,
      yaw: save?.yaw ?? 0,
      pitch: save?.pitch ?? -0.12,
      hp: save?.hp ?? MAX_HP,
      alive: true,
      regen: 0,
      fallSpeed: 0,
    };
    if (this.player.hp <= 0) this.player.hp = MAX_HP;

    this.#ensureAround(this.player.pos.x, this.player.pos.z);
    if (!save || aabbHitsSolid(this.world, this.player.pos.x, this.player.pos.y, this.player.pos.z, 0.3, 1.8)) {
      this.player.pos.y = this.world.surfaceY(Math.floor(this.player.pos.x), Math.floor(this.player.pos.z));
    }

    this.mobs = new MobManager(this.scene, this.world, {
      onPlayerHit: (damage, x, z) => this.#hurtPlayer(damage, x, z),
      onDrop: (id) => this.#collect(id, 1),
      onGroan: () => this.sound.groan(),
    });
    this.#faceInterestingDirection(save);

    this.ui.setMenu({ canContinue: this.hasStarted, worldLabel: `Мир № ${seed}` });
    this.ui.setScreen('menu');
    this.ui.setSoundLabel(this.sound.muted);
    this.ui.renderHotbar(this.inventory);
    this.ui.renderHearts(this.player.hp);
    this.#updateHint();
    this.#updateHand();
    this.#updateClock();
  }

  #faceInterestingDirection(save) {
    if (save) return;
    // На новом мире смотрим в сторону ближайшего дерева, чтобы цель была видна сразу.
    const { x, z } = this.player.pos;
    for (let r = 4; r < 40; r++) {
      for (let a = 0; a < 24; a++) {
        const angle = (a / 24) * Math.PI * 2;
        const tx = Math.floor(x + Math.sin(angle) * r);
        const tz = Math.floor(z + Math.cos(angle) * r);
        if (this.world.isTreeAt(tx, tz)) {
          this.player.yaw = angle + Math.PI;
          return;
        }
      }
    }
  }

  save() {
    if (!this.hasStarted || CHECK_MODE) return;
    try {
      const p = this.player;
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        seed: this.world.seed,
        edits: this.world.serializeEdits(),
        slots: this.inventory.slots,
        selected: this.inventory.selected,
        time: this.time,
        dayNumber: this.dayNumber,
        placed: this.stats.placed,
        hintIndex: this.hintIndex,
        x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp,
      }));
    } catch {
      // Хранилище недоступно (приватное окно) — игра работает без сохранения.
    }
  }

  newWorld() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // см. save()
    }
    this.#loadWorld(null);
  }

  // ---------- Состояния ----------

  play() {
    this.sound.unlock();
    this.hasStarted = true;
    this.state = 'playing';
    this.input.reset();
    this.input.active = true;
    this.ui.setScreen('hud');
    if (CHECK_MODE) {
      this.sound.muted = true;
    } else if (this.input.touchMode) {
      document.documentElement.requestFullscreen?.()?.catch?.(() => {});
      navigator.wakeLock?.request?.('screen')?.catch?.(() => {});
    } else {
      this.input.lock();
    }
    this.lastFrame = performance.now();
    this.save();
  }

  escape() {
    if (this.state === 'inventory') {
      this.toggleInventory();
    } else if (this.state === 'playing') {
      this.state = 'menu';
      this.input.active = false;
      this.input.reset();
      this.input.unlock();
      this.save();
      this.ui.setMenu({ canContinue: true, worldLabel: `Мир № ${this.world.seed}` });
      this.ui.setScreen('menu');
    }
  }

  toggleInventory() {
    if (this.state === 'playing') {
      this.state = 'inventory';
      this.input.active = false;
      this.input.reset();
      this.input.unlock();
      this.ui.pickedSlot = null;
      this.ui.setScreen('inventory');
      this.#renderInventory();
    } else if (this.state === 'inventory') {
      this.state = 'playing';
      this.input.reset();
      this.input.active = true;
      this.ui.setScreen('hud');
      if (!CHECK_MODE) this.input.lock();
      this.ui.renderHotbar(this.inventory);
      this.#updateHand();
    }
  }

  #renderInventory() {
    this.ui.renderInventory(this.inventory, () => {
      this.#renderInventory();
      this.ui.renderHotbar(this.inventory);
    });
  }

  craft(recipe) {
    if (this.inventory.craft(recipe)) {
      this.sound.click();
      this.#updateHint();
    } else if (this.inventory.canCraft(recipe)) {
      this.ui.toast('Рюкзак полон');
    }
  }

  toggleSound() {
    this.sound.muted = !this.sound.muted;
    this.ui.setSoundLabel(this.sound.muted);
  }

  selectSlot(i) {
    if (this.inventory.selected === i) return;
    this.inventory.selected = i;
    this.mining = null;
    this.ui.renderHotbar(this.inventory);
    this.#updateHand();
    const held = this.inventory.held;
    if (held !== null) this.ui.toast(itemName(held));
  }

  respawn() {
    const p = this.player;
    p.hp = MAX_HP;
    p.alive = true;
    p.vel = { x: 0, y: 0, z: 0 };
    p.pos.x = this.spawn.x;
    p.pos.z = this.spawn.z;
    this.#ensureAround(p.pos.x, p.pos.z);
    p.pos.y = this.world.surfaceY(Math.floor(p.pos.x), Math.floor(p.pos.z));
    for (const mob of [...this.mobs.list]) if (mob.type.hostile) this.mobs.remove(mob);
    this.ui.renderHearts(p.hp);
    this.play();
  }

  // ---------- Чанки ----------

  #ensureAround(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) this.#loadChunk(cx + dx, cz + dz);
    }
  }

  #loadChunk(cx, cz) {
    if (this.world.getChunk(cx, cz)) return;
    this.world.ensureChunk(cx, cz);
    // Появление чанка меняет грани и тени у соседей.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) this.dirty.add(chunkKey(cx + dx, cz + dz));
    }
  }

  #disposeMesh(key) {
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const mesh of entry) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  #makeMesh(data, material, cx, cz) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geometry.setAttribute('aShade', new THREE.BufferAttribute(data.shades, 1));
    geometry.setAttribute('aSky', new THREE.BufferAttribute(data.skies, 1));
    geometry.setAttribute('aTorch', new THREE.BufferAttribute(data.torches, 1));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(CHUNK_SIZE / 2, CHUNK_HEIGHT / 2, CHUNK_SIZE / 2),
      Math.hypot(CHUNK_SIZE / 2, CHUNK_HEIGHT / 2, CHUNK_SIZE / 2),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  #rebuildChunk(chunk) {
    const key = chunkKey(chunk.cx, chunk.cz);
    const { opaque, translucent } = buildChunkGeometry(this.world, chunk);
    this.#disposeMesh(key);
    const entry = [];
    if (!opaque.empty) entry.push(this.#makeMesh(opaque, this.solidMaterial, chunk.cx, chunk.cz));
    if (!translucent.empty) entry.push(this.#makeMesh(translucent, this.glassMaterial, chunk.cx, chunk.cz));
    this.meshes.set(key, entry);
  }

  #neighborsLoaded(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.world.getChunk(cx + dx, cz + dz)) return false;
      }
    }
    return true;
  }

  // Подгружает мир порциями с ограничением по времени, чтобы кадр не проседал.
  #updateChunks(budgetMs) {
    const started = performance.now();
    const pcx = Math.floor(this.player.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(this.player.pos.z / CHUNK_SIZE);
    const R = this.viewChunks;

    const moved = !this.lastChunk || this.lastChunk.cx !== pcx || this.lastChunk.cz !== pcz;
    if (moved) {
      this.lastChunk = { cx: pcx, cz: pcz };
      this.missing = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) {
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          if (!this.world.getChunk(cx, cz)) this.missing.push({ cx, cz, d: dx * dx + dz * dz });
        }
      }
      this.missing.sort((a, b) => b.d - a.d);
      for (const chunk of [...this.world.chunks.values()]) {
        if (Math.abs(chunk.cx - pcx) > R + 3 || Math.abs(chunk.cz - pcz) > R + 3) {
          this.#disposeMesh(chunkKey(chunk.cx, chunk.cz));
          this.world.unloadChunk(chunk.cx, chunk.cz);
        }
      }
    }

    this.#ensureAround(this.player.pos.x, this.player.pos.z);

    while (this.missing.length && performance.now() - started < budgetMs * 0.5) {
      const next = this.missing.pop();
      this.#loadChunk(next.cx, next.cz);
    }

    if (!this.dirty.size) return;
    const ready = [];
    for (const key of this.dirty) {
      const chunk = this.world.chunks.get(key);
      if (!chunk) {
        this.dirty.delete(key);
        continue;
      }
      const d = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
      if (d <= R && this.#neighborsLoaded(chunk.cx, chunk.cz)) ready.push({ key, chunk, d });
    }
    ready.sort((a, b) => a.d - b.d);
    for (let i = 0; i < ready.length; i++) {
      if (i > 0 && performance.now() - started > budgetMs) break;
      this.dirty.delete(ready[i].key);
      this.#rebuildChunk(ready[i].chunk);
    }
  }

  #onBlockChange(x, y, z, oldId, newId) {
    const radius = oldId === B.TORCH || newId === B.TORCH ? TORCH_RADIUS : 1;
    const minX = Math.floor((x - radius) / CHUNK_SIZE);
    const maxX = Math.floor((x + radius) / CHUNK_SIZE);
    const minZ = Math.floor((z - radius) / CHUNK_SIZE);
    const maxZ = Math.floor((z + radius) / CHUNK_SIZE);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) this.dirty.add(chunkKey(cx, cz));
    }
  }

  // ---------- Графика ----------

  #createMaterials() {
    const texture = new THREE.CanvasTexture(this.atlasCanvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    this.atlas = texture;

    this.uniforms = {
      uMap: { value: texture },
      uDay: { value: 1 },
      uFogNear: { value: 60 },
      uFogFar: { value: 100 },
      uFogColor: { value: new THREE.Color() },
    };
    this.solidMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...this.uniforms, uCut: { value: 0.5 } },
    });
    this.glassMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...this.uniforms, uCut: { value: 0.01 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  #createSky() {
    const disc = (color, size) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false, transparent: true }),
      );
      mesh.renderOrder = -10;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.sun = disc('#fff3b0', 60);
    this.moon = disc('#dfe6f5', 40);

    const starCount = 500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(500);
      v.y = Math.abs(v.y);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false,
    }));
    this.stars.renderOrder = -11;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    const cloudTexture = new THREE.CanvasTexture(createCloudTexture());
    cloudTexture.magFilter = THREE.NearestFilter;
    cloudTexture.minFilter = THREE.NearestFilter;
    cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;
    cloudTexture.repeat.set(4, 4);
    cloudTexture.colorSpace = THREE.NoColorSpace;
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.MeshBasicMaterial({ map: cloudTexture, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -5;
    this.scene.add(this.clouds);
  }

  #createEffects() {
    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: '#10130c', transparent: true, opacity: 0.75 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.008, 1.008, 1.008),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0, depthWrite: false }),
    );
    this.crack.visible = false;
    this.scene.add(this.crack);

    this.particleCount = 96;
    this.particles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      this.particleCount,
    );
    this.particles.frustumCulled = false;
    this.particleData = Array.from({ length: this.particleCount }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
    this.particleNext = 0;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.particleCount; i++) {
      this.particles.setMatrixAt(i, hidden);
      this.particles.setColorAt(i, new THREE.Color('#ffffff'));
    }
    this.scene.add(this.particles);
    this.tempMatrix = new THREE.Matrix4();

    this.hand = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, depthTest: false, depthWrite: false, fog: false }),
    );
    this.hand.renderOrder = 1000;
    this.hand.frustumCulled = false;
    this.camera.add(this.hand);
  }

  #updateHand() {
    const held = this.inventory.held;
    const tile = held === null ? TILE.SKIN : itemTile(held);
    const r = tileRect(tile);
    const uv = this.hand.geometry.attributes.uv;
    const base = [[0, 1], [1, 1], [0, 0], [1, 0]];
    for (let i = 0; i < uv.count; i++) {
      const [a, b] = base[i % 4];
      uv.setXY(i, r.u + a * r.s, r.v + b * r.s);
    }
    uv.needsUpdate = true;
    const flat = held !== null && !isPlaceable(held) || held === B.TORCH;
    if (held === null) this.hand.scale.set(0.14, 0.14, 0.52);
    else if (flat) this.hand.scale.set(0.3, 0.3, 0.015);
    else if (held === B.DOOR_X) this.hand.scale.set(0.2, 0.34, 0.03);
    else this.hand.scale.set(0.22, 0.22, 0.22);
  }

  #burst(x, y, z, tile) {
    const [r, g, b] = tileColor(this.atlasCanvas, tile);
    const color = new THREE.Color(r, g, b);
    for (let i = 0; i < 12; i++) {
      const index = this.particleNext;
      this.particleNext = (index + 1) % this.particleCount;
      const p = this.particleData[index];
      p.life = 0.5 + Math.random() * 0.35;
      p.x = x + 0.5 + (Math.random() - 0.5) * 0.7;
      p.y = y + 0.5 + (Math.random() - 0.5) * 0.7;
      p.z = z + 0.5 + (Math.random() - 0.5) * 0.7;
      p.vx = (Math.random() - 0.5) * 3.4;
      p.vy = Math.random() * 3.6;
      p.vz = (Math.random() - 0.5) * 3.4;
      this.particles.setColorAt(index, color);
    }
    this.particles.instanceColor.needsUpdate = true;
  }

  #updateParticles(dt) {
    let changed = false;
    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particleData[i];
      if (p.life <= 0) continue;
      changed = true;
      p.life -= dt;
      p.vy -= 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const scale = p.life > 0 ? 1 : 0;
      this.tempMatrix.makeScale(scale, scale, scale).setPosition(p.x, p.y, p.z);
      this.particles.setMatrixAt(i, this.tempMatrix);
    }
    if (changed) this.particles.instanceMatrix.needsUpdate = true;
  }

  #resize() {
    const viewport = window.visualViewport;
    const w = viewport?.width ?? window.innerWidth;
    const h = viewport?.height ?? window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    // Сгладить разницу между телефонами с тонкой пропорцией экрана.
    this.camera.fov = this.camera.aspect < 1 ? 82 : 72;
    this.camera.updateProjectionMatrix();
  }

  #updateSky(dt) {
    const curve = dayCurve(this.time);
    const dusk = Math.max(0, 1 - Math.abs(curve.sun) / 0.28);
    const color = SKY_NIGHT.clone().lerp(SKY_DAY, curve.k).lerp(SKY_DUSK, dusk * 0.55);
    this.renderer.setClearColor(color);
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uDay.value = curve.light;
    const far = (this.viewChunks - 0.4) * CHUNK_SIZE;
    this.uniforms.uFogNear.value = far * 0.62;
    this.uniforms.uFogFar.value = far;

    const eye = this.camera.position;
    const a = this.time * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0.22).normalize();
    this.sun.position.copy(eye).addScaledVector(dir, 420);
    this.sun.lookAt(eye);
    this.moon.position.copy(eye).addScaledVector(dir, -420);
    this.moon.lookAt(eye);
    this.stars.position.copy(eye);
    this.stars.material.opacity = Math.max(0, 1 - curve.k * 1.6);
    this.stars.visible = this.stars.material.opacity > 0.01;

    this.clouds.position.set(eye.x, CHUNK_HEIGHT + 22, eye.z);
    const cloudMap = this.clouds.material.map;
    cloudMap.offset.set(eye.x / 300 + this.cloudDrift, -eye.z / 300);
    this.cloudDrift += dt * 0.0016;
    this.clouds.material.color.setScalar(0.3 + curve.light * 0.7);
    this.clouds.material.opacity = 0.72;

    this.hand.material.color.setScalar(Math.max(0.45, curve.light));
  }

  // ---------- Игрок ----------

  #hurtPlayer(damage, fromX, fromZ) {
    const p = this.player;
    if (!p.alive || this.state !== 'playing') return;
    p.hp = Math.max(0, p.hp - damage);
    p.regen = 0;
    if (fromX !== undefined) {
      const dx = p.pos.x - fromX;
      const dz = p.pos.z - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      p.vel.x += (dx / len) * 6;
      p.vel.z += (dz / len) * 6;
      if (p.onGround) p.vel.y = 4.5;
    }
    this.ui.renderHearts(p.hp);
    this.ui.flashDamage();
    this.sound.hurt();
    navigator.vibrate?.(60);
    if (p.hp === 0) {
      p.alive = false;
      this.state = 'dead';
      this.input.active = false;
      this.input.reset();
      this.input.unlock();
      this.sound.death();
      this.ui.setScreen('death');
      this.save();
    }
  }

  #collect(id, n) {
    const left = this.inventory.add(id, n);
    if (left > 0) this.ui.toast('Рюкзак полон');
    this.ui.renderHotbar(this.inventory);
    this.#updateHand();
  }

  #updatePlayer(dt) {
    const p = this.player;
    const { input } = this;
    input.poll();

    const [lookX, lookY] = input.consumeLook();
    p.yaw -= lookX;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - lookY));

    const inWater = BLOCKS[this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y + 0.4), Math.floor(p.pos.z))].liquid;
    const eyeInWater = BLOCKS[this.world.get(Math.floor(p.pos.x), Math.floor(p.pos.y + 1.62), Math.floor(p.pos.z))].liquid;
    this.ui.setUnderwater(!!eyeInWater);

    let speed = input.sprint ? 6.4 : 4.4;
    if (inWater) speed *= 0.55;
    const len = Math.hypot(input.moveX, input.moveZ);
    const k = len > 1 ? 1 / len : 1;
    const mx = input.moveX * k;
    const mz = input.moveZ * k;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const wishX = (mx * cos - mz * sin) * speed;
    const wishZ = (-mx * sin - mz * cos) * speed;
    const blend = Math.min(1, dt * (p.onGround ? 14 : 5));
    p.vel.x += (wishX - p.vel.x) * blend;
    p.vel.z += (wishZ - p.vel.z) * blend;

    if (inWater) {
      p.vel.y = input.jump ? Math.min(p.vel.y + 22 * dt, 3.6) : Math.max(p.vel.y - 9 * dt, -2.4);
    } else {
      if (input.jump && p.onGround) p.vel.y = 8.7;
      p.vel.y = Math.max(p.vel.y - GRAVITY * dt, -42);
    }

    const before = p.vel.y;
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) moveBody(this.world, p, dt / steps);

    if (p.onGround && before < -13.5 && !inWater) {
      this.#hurtPlayer(Math.floor((-before - 13.5) * 0.9) + 1);
    }

    // На телефоне прыгать одним пальцем неудобно: на ступеньку поднимаемся сами.
    if (input.touchMode && p.hitWall && p.onGround && len > 0.15) {
      const fx = p.pos.x + (wishX / speed) * 0.7;
      const fz = p.pos.z + (wishZ / speed) * 0.7;
      const stepClear = !aabbHitsSolid(this.world, fx, p.pos.y + 1.05, fz, 0.28, 1.75);
      if (stepClear) p.vel.y = 8.7;
    }

    p.regen += dt;
    if (p.regen > 4 && p.hp < MAX_HP) {
      p.regen = 0;
      p.hp++;
      this.ui.renderHearts(p.hp);
    }

    const walking = p.onGround && Math.hypot(p.vel.x, p.vel.z) > 0.5;
    this.bob += walking ? dt * Math.hypot(p.vel.x, p.vel.z) * 2.2 : 0;

    if (p.pos.y < -20) this.#hurtPlayer(MAX_HP);
  }

  #syncCamera() {
    const p = this.player;
    this.camera.position.set(p.pos.x, p.pos.y + 1.62 + Math.abs(Math.sin(this.bob)) * 0.03, p.pos.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
    this.camera.updateMatrixWorld();
  }

  #aim() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    const block = raycastBlock(this.world, o.x, o.y, o.z, dir.x, dir.y, dir.z, REACH);
    const body = this.mobs.pick(o.x, o.y, o.z, dir.x, dir.y, dir.z, ATTACK_REACH);
    const mob = body && (!block || body.dist < block.dist) ? body.mob : null;
    return { block, mob };
  }

  #updateActions(dt) {
    const { input, inventory } = this;
    const { block, mob } = this.#aim();
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.swing = Math.max(0, this.swing - dt * 3.4);

    this.highlight.visible = !!block && !mob;
    if (block) this.highlight.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);

    if (input.mine && mob) {
      this.mining = null;
      if (this.attackCooldown <= 0) {
        this.attackCooldown = 0.42;
        this.swing = 1;
        const held = inventory.held;
        const damage = held === ITEM.SWORD ? 9 : held === ITEM.PICK ? 5 : 3;
        this.mobs.damage(mob, damage, this.player.pos.x, this.player.pos.z);
        this.sound.hit();
      }
    } else if (input.mine && block && block.y > 0) {
      const same = this.mining && this.mining.x === block.x && this.mining.y === block.y && this.mining.z === block.z;
      if (!same) this.mining = { x: block.x, y: block.y, z: block.z, progress: 0 };
      this.mining.progress += dt / Math.max(0.05, mineTime(block.id, inventory.held));
      if (this.swing < 0.3) this.swing = 1;
      this.digSoundTimer -= dt;
      if (this.digSoundTimer <= 0) {
        this.digSoundTimer = 0.22;
        this.sound.dig();
      }
      if (this.mining.progress >= 1) {
        this.#breakBlock(block.x, block.y, block.z, block.id);
        this.mining = null;
      }
    } else {
      this.mining = null;
    }

    const progress = this.mining?.progress ?? 0;
    this.ui.setMineProgress(progress);
    this.crack.visible = progress > 0;
    if (progress > 0) {
      this.crack.position.set(this.mining.x + 0.5, this.mining.y + 0.5, this.mining.z + 0.5);
      this.crack.material.opacity = 0.12 + progress * 0.5;
    }

    if (input.place && this.placeCooldown <= 0) this.#use(block);
  }

  #breakBlock(x, y, z, id) {
    const block = BLOCKS[id];
    if (isDoor(id)) {
      this.#clearDoor(x, y, z);
    } else {
      this.world.set(x, y, z, B.AIR);
      this.#collect(dropOf(id), 1);
    }
    this.#burst(x, y, z, block.side ?? TILE.DOOR);
    this.sound.breakBlock();

    // Факел и дверь не висят в воздухе.
    const above = this.world.get(x, y + 1, z);
    if (above === B.TORCH) {
      this.world.set(x, y + 1, z, B.AIR);
      this.#collect(B.TORCH, 1);
    } else if (isDoor(above)) {
      this.#clearDoor(x, y + 1, z);
    }
    this.#updateHint();
  }

  #doorSpan(x, y, z) {
    let bottom = y;
    while (isDoor(this.world.get(x, bottom - 1, z))) bottom--;
    let top = y;
    while (isDoor(this.world.get(x, top + 1, z))) top++;
    return [bottom, top];
  }

  #clearDoor(x, y, z) {
    const [bottom, top] = this.#doorSpan(x, y, z);
    for (let by = bottom; by <= top; by++) this.world.set(x, by, z, B.AIR);
    this.#collect(B.DOOR_X, 1);
  }

  #use(block) {
    const { inventory } = this;
    const held = inventory.held;

    if (block && isDoor(block.id)) {
      const [bottom, top] = this.#doorSpan(block.x, block.y, block.z);
      for (let y = bottom; y <= top; y++) {
        const id = this.world.get(block.x, y, block.z);
        const next = toggledDoor(id);
        if (BLOCKS[next].solid && this.#bodyInside(block.x, y, block.z)) return;
        this.world.set(block.x, y, block.z, next);
      }
      this.placeCooldown = 0.3;
      this.swing = 1;
      this.sound.place();
      return;
    }

    if (held === ITEM.MEAT) {
      if (this.player.hp < MAX_HP) {
        this.player.hp = Math.min(MAX_HP, this.player.hp + MEAT_HEAL);
        inventory.takeHeld();
        this.ui.renderHearts(this.player.hp);
        this.ui.renderHotbar(inventory);
        this.#updateHand();
        this.sound.eat();
        this.placeCooldown = 0.4;
      }
      return;
    }
    if (!block || held === null || !isPlaceable(held)) return;

    const x = block.x + block.nx;
    const y = block.y + block.ny;
    const z = block.z + block.nz;
    if (!this.#canPlaceInto(x, y, z)) return;

    if (held === B.TORCH && !BLOCKS[this.world.get(x, y - 1, z)].solid) {
      this.ui.toast('Факел ставится на верх блока');
      this.placeCooldown = 0.5;
      return;
    }

    let placed = held;
    if (held === B.DOOR_X) {
      if (!this.#canPlaceInto(x, y + 1, z) || !BLOCKS[this.world.get(x, y - 1, z)].solid) {
        this.ui.toast('Для двери нужно 2 свободных блока над землёй');
        this.placeCooldown = 0.5;
        return;
      }
      // Полотно поперёк взгляда игрока.
      placed = Math.abs(Math.sin(this.player.yaw)) > Math.abs(Math.cos(this.player.yaw)) ? B.DOOR_Z : B.DOOR_X;
      this.world.set(x, y + 1, z, placed);
    }

    this.world.set(x, y, z, placed);
    inventory.takeHeld();
    this.stats.placed++;
    this.placeCooldown = 0.26;
    this.swing = 1;
    this.sound.place();
    this.ui.renderHotbar(inventory);
    this.#updateHand();
    this.#updateHint();
  }

  #bodyInside(x, y, z) {
    const p = this.player;
    const insidePlayer = p.pos.x + p.halfW > x && p.pos.x - p.halfW < x + 1
      && p.pos.z + p.halfW > z && p.pos.z - p.halfW < z + 1
      && p.pos.y + p.height > y && p.pos.y < y + 1;
    return insidePlayer || this.mobs.blocksPlacement(x, y, z);
  }

  #canPlaceInto(x, y, z) {
    const id = this.world.get(x, y, z);
    if (id !== B.AIR && !BLOCKS[id].liquid) return false;
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    return !this.#bodyInside(x, y, z) || !BLOCKS[this.inventory.held].solid;
  }

  #updateHandPose() {
    const swing = Math.sin(this.swing * Math.PI);
    const bob = Math.sin(this.bob * 2) * 0.012;
    const held = this.inventory.held;
    const armOffset = held === null ? -0.1 : 0;
    this.hand.position.set(0.42 - swing * 0.12, -0.38 + bob - swing * 0.08 + armOffset, -0.62 - swing * 0.1);
    this.hand.rotation.set(-0.25 - swing * 0.9, -0.5 + swing * 0.3, 0.05);
  }

  #updateHint() {
    while (this.hintIndex < HINTS.length && HINTS[this.hintIndex].done(this)) this.hintIndex++;
    this.ui.setHint(this.hintIndex < HINTS.length ? HINTS[this.hintIndex].text : null);
  }

  #updateClock() {
    const minutes = Math.floor(this.time * 24 * 60);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(Math.floor(minutes / 10) % 6);
    const night = dayCurve(this.time).sun < -0.05;
    this.ui.setClock(`День ${this.dayNumber} · ${hh}:${mm}0`, night);
  }

  #adaptQuality(dt) {
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 180) return;
    const average = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples = [];
    if (average <= 1 / 24) return;
    // Слабое устройство: сначала снижаем резкость, затем дальность.
    if (this.pixelRatio > 1) {
      this.pixelRatio = 1;
      this.renderer.setPixelRatio(1);
      this.#resize();
    } else if (this.viewChunks > 3) {
      this.viewChunks--;
      this.lastChunk = null;
    }
  }

  // ---------- Главный цикл ----------

  #frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.state === 'playing') {
      this.#updateChunks(5);
      this.#updatePlayer(dt);
      if (this.state === 'playing') {
        this.#syncCamera();
        this.#updateActions(dt);

        const previous = this.time;
        this.time = (this.time + dt / DAY_LENGTH) % 1;
        if (this.time < previous) this.dayNumber++;

        const curve = dayCurve(this.time);
        const sim = { day: curve.light, night: curve.sun < -0.05 };
        this.mobs.update(dt, this.player, sim);

        this.clockTimer -= dt;
        if (this.clockTimer <= 0) {
          this.clockTimer = 0.5;
          this.#updateClock();
          this.#updateHint();
        }
        this.saveTimer += dt;
        if (this.saveTimer > 10) {
          this.saveTimer = 0;
          this.save();
        }
      }
      this.#adaptQuality(dt);
    } else if (this.state === 'menu') {
      // За меню живой мир: камера медленно осматривается.
      this.#updateChunks(9);
      this.player.yaw += dt * 0.05;
      this.#syncCamera();
      this.highlight.visible = false;
      this.crack.visible = false;
    } else if (this.state === 'inventory') {
      this.#updateChunks(3);
    }

    this.#updateParticles(dt);
    this.#updateHandPose();
    this.hand.visible = this.state !== 'menu';
    this.#updateSky(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
