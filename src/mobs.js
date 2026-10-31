import THREE from './three.js';
import { B, BLOCKS, ITEM } from './blocks.js';
import { TORCH_RADIUS } from './mesher.js';
import { aabbHitsSolid, hasLineOfSight, moveBody, raycastBody } from './physics.js';
import { createFace } from './textures.js';

const GRAVITY = 28;
const JUMP = 8.2;
const AGGRO_RANGE = 30;
const DESPAWN_RANGE = 75;
const SPAWN_MIN = 18;
const SPAWN_MAX = 36;
const NIGHT_ZOMBIES = 12;
const DAY_ZOMBIES = 3;
const ANIMALS = 6;

export const MOB_TYPES = {
  zombie: { hostile: true, hp: 20, speed: 1.9, damage: 2, scale: 1, skin: '#6f9e5c', shirt: '#3d6e8f', legs: '#39406b', eyes: '#1b2a14', mouth: '#2b3d20' },
  runner: { hostile: true, hp: 12, speed: 3.5, damage: 1, scale: 0.78, skin: '#a7b561', shirt: '#8f4a3d', legs: '#4a3a2c', eyes: '#c42b1e', mouth: '#3d2a15' },
  brute: { hostile: true, hp: 44, speed: 1.25, damage: 4, scale: 1.3, skin: '#4d7a68', shirt: '#4b4f55', legs: '#2d2f36', eyes: '#e8d94a', mouth: '#16281f' },
  pig: { hostile: false, animal: true, hp: 8, speed: 1.2, skin: '#e7a3a0', legs: '#c9817f', eyes: '#2c1c1c', mouth: '#a8605f', drop: ITEM.MEAT, width: 0.45, height: 0.9 },
  sheep: { hostile: false, animal: true, hp: 8, speed: 1.1, skin: '#ebe7dc', legs: '#6b5f55', eyes: '#2c2c2c', mouth: '#9b8d80', drop: ITEM.MEAT, width: 0.45, height: 1.05 },
};

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const limbBox = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
const faceCache = new Map();

function faceTexture(typeName) {
  if (!faceCache.has(typeName)) {
    const t = MOB_TYPES[typeName];
    const texture = new THREE.CanvasTexture(createFace(t.skin, t.eyes, t.mouth));
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.NoColorSpace;
    faceCache.set(typeName, texture);
  }
  return faceCache.get(typeName);
}

class Mob {
  constructor(typeName, x, y, z) {
    const type = MOB_TYPES[typeName];
    this.typeName = typeName;
    this.type = type;
    this.hp = type.hp;
    const scale = type.scale ?? 1;
    this.halfW = type.width ?? 0.3 * scale;
    this.height = type.height ?? 1.85 * scale;
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = false;
    this.hitWall = false;
    this.yaw = Math.random() * Math.PI * 2;
    this.walkPhase = Math.random() * 6;
    this.attackCooldown = 0;
    this.stuck = 0;
    this.sidestep = 0;
    this.sideSign = 1;
    this.wanderTimer = 0;
    this.wanderDir = 0;
    this.moving = false;
    this.flash = 0;
    this.dead = false;
    this.fade = 1;
    this.materials = [];
    this.group = type.animal ? this.#buildAnimal(typeName, type) : this.#buildHumanoid(typeName, type, scale);
  }

  #mat(color) {
    const material = new THREE.MeshBasicMaterial({ color });
    material.userData.base = new THREE.Color(color);
    this.materials.push(material);
    return material;
  }

  #head(typeName, color) {
    const skin = this.#mat(color);
    const face = new THREE.MeshBasicMaterial({ map: faceTexture(typeName) });
    face.userData.base = new THREE.Color('#ffffff');
    this.materials.push(face);
    return new THREE.Mesh(unitBox, [skin, skin, skin, skin, face, skin]);
  }

  #part(geometry, material, sx, sy, sz, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    return mesh;
  }

  #buildHumanoid(typeName, type, s) {
    const group = new THREE.Group();
    const skin = this.#mat(type.skin);
    const shirt = this.#mat(type.shirt);
    const legs = this.#mat(type.legs);
    const girth = this.typeName === 'brute' ? 1.25 : 1;

    const head = this.#head(typeName, type.skin);
    head.scale.setScalar(0.5 * s);
    head.position.y = 1.6 * s;
    group.add(head);
    group.add(this.#part(unitBox, shirt, 0.52 * s * girth, 0.7 * s, 0.28 * s * girth, 0, 1.0 * s, 0));

    this.limbs = [];
    const limb = (material, sx, sy, x, y, armPose) => {
      const mesh = this.#part(limbBox, material, sx * s, sy * s, sx * s, x * s * girth, y * s, 0);
      if (armPose) mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      return mesh;
    };
    this.legL = limb(legs, 0.24, 0.65, -0.13, 0.65, false);
    this.legR = limb(legs, 0.24, 0.65, 0.13, 0.65, false);
    this.armL = limb(skin, 0.2, 0.65, -0.37, 1.32, true);
    this.armR = limb(skin, 0.2, 0.65, 0.37, 1.32, true);
    return group;
  }

  #buildAnimal(typeName, type) {
    const group = new THREE.Group();
    const skin = this.#mat(type.skin);
    const legs = this.#mat(type.legs);
    const woolly = typeName === 'sheep' ? 1.15 : 1;
    group.add(this.#part(unitBox, skin, 0.62 * woolly, 0.5 * woolly, 1 * woolly, 0, 0.62, 0));
    const head = this.#head(typeName, type.skin);
    head.scale.setScalar(0.44);
    head.position.set(0, 0.86, 0.62);
    group.add(head);
    const leg = (x, z) => {
      const mesh = this.#part(limbBox, legs, 0.18, 0.4, 0.18, x, 0.4, z);
      group.add(mesh);
      return mesh;
    };
    this.legL = leg(-0.2, 0.32);
    this.legR = leg(0.2, 0.32);
    this.armL = leg(0.2, -0.32);
    this.armR = leg(-0.2, -0.32);
    return group;
  }

  syncView(light) {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
    if (this.dead) this.group.rotation.z = (1 - this.fade) * (Math.PI / 2);

    const swing = this.moving ? Math.sin(this.walkPhase) * 0.7 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    if (this.type.animal) {
      this.armL.rotation.x = swing;
      this.armR.rotation.x = -swing;
    } else {
      this.armL.rotation.x = -Math.PI / 2 + swing * 0.2;
      this.armR.rotation.x = -Math.PI / 2 - swing * 0.2;
    }

    for (const material of this.materials) {
      material.color.copy(material.userData.base).multiplyScalar(light);
      if (this.flash > 0) {
        material.color.r = Math.min(1, material.color.r + 0.6);
        material.color.g *= 0.4;
        material.color.b *= 0.4;
      }
    }
  }

  dispose() {
    for (const material of this.materials) material.dispose();
  }
}

export class MobManager {
  constructor(scene, world, callbacks) {
    this.scene = scene;
    this.world = world;
    this.callbacks = callbacks; // onPlayerHit(damage, fromX, fromZ), onDrop(id), onGroan()
    this.list = [];
    this.spawnTimer = 5;
    this.groanTimer = 6;
  }

  add(typeName, x, y, z) {
    const mob = new Mob(typeName, x, y, z);
    this.list.push(mob);
    this.scene.add(mob.group);
    return mob;
  }

  remove(mob) {
    this.scene.remove(mob.group);
    mob.dispose();
    this.list.splice(this.list.indexOf(mob), 1);
  }

  clear() {
    while (this.list.length) this.remove(this.list[0]);
  }

  // Ближайшее живое тело на линии взгляда.
  pick(ox, oy, oz, dx, dy, dz, reach) {
    let best = null;
    let bestDist = reach;
    for (const mob of this.list) {
      if (mob.dead) continue;
      const dist = raycastBody(mob, ox, oy, oz, dx, dy, dz, bestDist);
      if (dist !== null && dist <= bestDist) {
        best = mob;
        bestDist = dist;
      }
    }
    return best ? { mob: best, dist: bestDist } : null;
  }

  damage(mob, amount, fromX, fromZ) {
    mob.hp -= amount;
    mob.flash = 0.18;
    const dx = mob.pos.x - fromX;
    const dz = mob.pos.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    mob.vel.x = (dx / len) * 6;
    mob.vel.z = (dz / len) * 6;
    mob.vel.y = 5;
    if (mob.hp <= 0) {
      mob.dead = true;
      if (mob.type.drop) this.callbacks.onDrop(mob.type.drop);
      this.callbacks.onKill?.(mob);
    }
  }

  blocksPlacement(x, y, z) {
    return this.list.some((m) => !m.dead
      && m.pos.x + m.halfW > x && m.pos.x - m.halfW < x + 1
      && m.pos.z + m.halfW > z && m.pos.z - m.halfW < z + 1
      && m.pos.y + m.height > y && m.pos.y < y + 1);
  }

  update(dt, player, sim) {
    for (const mob of [...this.list]) {
      this.#step(mob, dt, player);
      mob.syncView(Math.max(0.42, sim.day));
      if (mob.dead && mob.fade <= 0) this.remove(mob);
      else if (Math.hypot(mob.pos.x - player.pos.x, mob.pos.z - player.pos.z) > DESPAWN_RANGE) this.remove(mob);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = sim.night ? 2.5 : 9;
      this.#trySpawn(player, sim);
    }

    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 5 + Math.random() * 7;
      const near = this.list.some((m) => m.type.hostile && !m.dead
        && Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) < 16);
      if (near) this.callbacks.onGroan();
    }
  }

  #step(mob, dt, player) {
    const { world } = this;
    mob.flash = Math.max(0, mob.flash - dt);
    mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);

    let dirX = 0;
    let dirZ = 0;
    let speed = mob.type.speed;

    if (mob.dead) {
      mob.fade -= dt * 2;
    } else {
      const dx = player.pos.x - mob.pos.x;
      const dz = player.pos.z - mob.pos.z;
      const dist = Math.hypot(dx, dz);
      const chasing = mob.type.hostile && player.alive && dist < AGGRO_RANGE;

      if (chasing && dist > 0.4) {
        dirX = dx / dist;
        dirZ = dz / dist;
        if (mob.sidestep > 0) {
          mob.sidestep -= dt;
          [dirX, dirZ] = [-dirZ * mob.sideSign, dirX * mob.sideSign];
        }
      } else if (!chasing) {
        mob.wanderTimer -= dt;
        if (mob.wanderTimer <= 0) {
          mob.wanderTimer = 2 + Math.random() * 4;
          mob.wanderDir = Math.random() < 0.45 ? null : Math.random() * Math.PI * 2;
        }
        if (mob.wanderDir !== null) {
          dirX = Math.sin(mob.wanderDir);
          dirZ = Math.cos(mob.wanderDir);
          speed *= 0.5;
        }
      }

      if (chasing && dist < mob.halfW + 1.05 && Math.abs(player.pos.y - mob.pos.y) < 1.9 && mob.attackCooldown <= 0) {
        // Без прямой видимости удар не проходит: дом и закрытая дверь защищают.
        const eye = mob.pos.y + mob.height * 0.85;
        if (hasLineOfSight(world, mob.pos.x, eye, mob.pos.z, player.pos.x, player.pos.y + 1.5, player.pos.z)) {
          mob.attackCooldown = 1.2;
          this.callbacks.onPlayerHit(mob.type.damage, mob.pos.x, mob.pos.z);
        }
      }
    }

    const blend = Math.min(1, dt * 8);
    if (dirX || dirZ) mob.yaw = Math.atan2(dirX, dirZ);
    mob.vel.x += (dirX * speed - mob.vel.x) * blend;
    mob.vel.z += (dirZ * speed - mob.vel.z) * blend;

    const inWater = BLOCKS[world.get(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.4), Math.floor(mob.pos.z))].liquid;
    mob.vel.y = inWater ? Math.min(mob.vel.y + 34 * dt, 2.4) : Math.max(mob.vel.y - GRAVITY * dt, -40);

    const steps = Math.ceil(dt / 0.025);
    for (let i = 0; i < steps; i++) moveBody(world, mob, dt / steps);

    if (mob.hitWall && !mob.dead) {
      if (mob.onGround) mob.vel.y = JUMP;
      mob.stuck += dt;
      if (mob.stuck > 0.9) {
        mob.stuck = 0;
        mob.sidestep = 1.1;
        mob.sideSign = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      mob.stuck = Math.max(0, mob.stuck - dt * 0.5);
    }

    mob.moving = Math.hypot(mob.vel.x, mob.vel.z) > 0.2;
    mob.walkPhase += dt * Math.hypot(mob.vel.x, mob.vel.z) * 3.4;
  }

  #trySpawn(player, sim) {
    const counts = { hostile: 0, animal: 0 };
    for (const mob of this.list) counts[mob.type.hostile ? 'hostile' : 'animal']++;
    const hostileCap = sim.night ? NIGHT_ZOMBIES : DAY_ZOMBIES;

    let typeName;
    if (counts.hostile < hostileCap && (sim.night || counts.animal >= ANIMALS || Math.random() < 0.5)) {
      const roll = Math.random();
      typeName = roll < 0.62 ? 'zombie' : roll < 0.88 ? 'runner' : 'brute';
    } else if (counts.animal < ANIMALS) {
      typeName = Math.random() < 0.5 ? 'pig' : 'sheep';
    } else {
      return;
    }

    const angle = Math.random() * Math.PI * 2;
    const radius = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const x = Math.floor(player.pos.x + Math.cos(angle) * radius);
    const z = Math.floor(player.pos.z + Math.sin(angle) * radius);
    if (!this.#canSpawnAt(x, z, MOB_TYPES[typeName])) return;
    this.add(typeName, x + 0.5, this.world.surfaceY(x, z), z + 0.5);
  }

  #canSpawnAt(x, z, type) {
    const { world } = this;
    if (!world.getChunk(Math.floor(x / 16), Math.floor(z / 16))) return false;
    const y = world.surfaceY(x, z);
    const ground = world.get(x, y - 1, z);
    if (ground === B.LEAVES || !BLOCKS[ground].solid) return false;
    if (type.animal && ground !== B.GRASS) return false;
    if (BLOCKS[world.get(x, y, z)].liquid) return false;
    if (aabbHitsSolid(world, x + 0.5, y, z + 0.5, 0.4, 1.9)) return false;
    // Рядом с факелами зомби не появляются: так можно обезопасить двор.
    if (type.hostile) {
      for (const t of world.torchesNear(x, z, TORCH_RADIUS)) {
        if (Math.hypot(t[0] - x, t[2] - z) < TORCH_RADIUS) return false;
      }
    }
    return true;
  }
}
