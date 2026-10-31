import { RECIPES, itemName, itemTile } from './blocks.js';
import { HOTBAR_SIZE } from './inventory.js';
import { tileIcon } from './textures.js';

const $ = (id) => document.getElementById(id);

function iconCache(atlas) {
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) cache.set(id, tileIcon(atlas, itemTile(id)));
    return cache.get(id);
  };
}

function fillSlot(el, slot, icon) {
  el.replaceChildren();
  el.setAttribute('aria-label', slot ? `${itemName(slot.id)}: ${slot.n}` : 'Пусто');
  if (!slot) return;
  const img = document.createElement('img');
  img.src = icon(slot.id);
  img.alt = '';
  img.draggable = false;
  el.append(img);
  if (slot.n > 1) {
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = slot.n;
    el.append(count);
  }
}

export class UI {
  constructor(atlas, handlers) {
    this.icon = iconCache(atlas);
    this.handlers = handlers;
    this.pickedSlot = null;
    this.toastTimer = 0;

    this.hotbarSlots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const button = document.createElement('button');
      button.className = 'slot';
      button.type = 'button';
      button.addEventListener('click', () => handlers.onHotbar(i));
      $('hotbar-slots').append(button);
      this.hotbarSlots.push(button);
    }

    this.hearts = [];
    for (let i = 0; i < 10; i++) {
      const heart = document.createElement('i');
      heart.className = 'heart';
      $('hearts').append(heart);
      this.hearts.push(heart);
    }

    $('btn-bag').addEventListener('click', () => handlers.onInventory());
    $('btn-pause').addEventListener('click', () => handlers.onEscape());
    $('btn-close-inv').addEventListener('click', () => handlers.onInventory());
    $('btn-play').addEventListener('click', () => handlers.onPlay());
    $('btn-respawn').addEventListener('click', () => handlers.onRespawn());
    $('btn-sound').addEventListener('click', () => handlers.onToggleSound());

    const newWorld = $('btn-new');
    newWorld.addEventListener('click', () => {
      if (newWorld.dataset.armed) {
        delete newWorld.dataset.armed;
        newWorld.textContent = 'Новый мир';
        handlers.onNewWorld();
      } else {
        newWorld.dataset.armed = '1';
        newWorld.textContent = 'Удалить этот мир?';
        setTimeout(() => {
          delete newWorld.dataset.armed;
          newWorld.textContent = 'Новый мир';
        }, 4000);
      }
    });
  }

  setTouchMode(on) {
    document.body.classList.toggle('touch', on);
  }

  setScreen(name) {
    for (const id of ['menu', 'inventory', 'death']) $(id).hidden = id !== name;
    $('hud').hidden = name === 'menu';
  }

  setMenu({ canContinue, worldLabel }) {
    $('btn-play').textContent = canContinue ? 'Продолжить' : 'Играть';
    $('btn-new').hidden = !canContinue;
    $('world-label').textContent = worldLabel;
  }

  setSoundLabel(muted) {
    $('btn-sound').textContent = muted ? 'Звук: выкл' : 'Звук: вкл';
  }

  renderHotbar(inventory) {
    this.hotbarSlots.forEach((el, i) => {
      fillSlot(el, inventory.slots[i], this.icon);
      el.classList.toggle('selected', i === inventory.selected);
    });
  }

  renderHearts(hp) {
    this.hearts.forEach((heart, i) => {
      const value = hp - i * 2;
      heart.className = `heart ${value >= 2 ? 'full' : value === 1 ? 'half' : 'empty'}`;
    });
  }

  setClock(text, night) {
    $('clock').textContent = text;
    $('clock').classList.toggle('night', night);
  }

  flashDamage() {
    const el = $('damage');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  setUnderwater(on) {
    $('underwater').hidden = !on;
  }

  setMineProgress(p) {
    const bar = $('mine-bar');
    bar.hidden = p <= 0;
    bar.firstElementChild.style.width = `${Math.round(p * 100)}%`;
  }

  setHint(text) {
    const el = $('hint');
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  setStick(state) {
    const stick = $('stick');
    if (!state) {
      stick.classList.remove('live');
      stick.style.removeProperty('left');
      stick.style.removeProperty('top');
      stick.style.removeProperty('bottom');
      $('stick-knob').style.transform = '';
      return;
    }
    stick.classList.add('live');
    stick.style.left = `${state.cx}px`;
    stick.style.top = `${state.cy}px`;
    stick.style.bottom = 'auto';
    $('stick-knob').style.transform = `translate(${state.x}px, ${state.y}px)`;
  }

  setActionPressed(action, down) {
    if (!action) {
      document.querySelectorAll('[data-action]').forEach((b) => b.classList.remove('pressed'));
      return;
    }
    document.querySelector(`[data-action="${action}"]`)?.classList.toggle('pressed', down);
  }

  renderInventory(inventory, onChange) {
    const grid = $('inv-grid');
    grid.replaceChildren();
    inventory.slots.forEach((slot, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot';
      if (i < HOTBAR_SIZE) button.classList.add('in-hotbar');
      if (i === this.pickedSlot) button.classList.add('picked');
      fillSlot(button, slot, this.icon);
      button.addEventListener('click', () => {
        if (this.pickedSlot === null) {
          if (slot) this.pickedSlot = i;
        } else {
          inventory.swap(this.pickedSlot, i);
          this.pickedSlot = null;
        }
        onChange();
      });
      grid.append(button);
    });

    const list = $('craft-list');
    list.replaceChildren();
    RECIPES.forEach((recipe) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'recipe';
      row.disabled = !inventory.canCraft(recipe);

      const img = document.createElement('img');
      img.src = this.icon(recipe.out);
      img.alt = '';
      const title = document.createElement('span');
      title.className = 'recipe-title';
      title.textContent = recipe.count > 1 ? `${itemName(recipe.out)} × ${recipe.count}` : itemName(recipe.out);
      const needs = document.createElement('span');
      needs.className = 'recipe-needs';
      needs.textContent = recipe.need
        .map(([id, n]) => `${itemName(id)} ${Math.min(inventory.count(id), n)}/${n}`)
        .join(', ');
      row.append(img, title, needs);
      row.addEventListener('click', () => {
        this.handlers.onCraft(recipe);
        onChange();
      });
      list.append(row);
    });
  }

  showFatal(message) {
    $('fatal').hidden = false;
    $('fatal').textContent = message;
  }
}
