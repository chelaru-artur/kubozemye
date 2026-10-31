import { itemStack } from './blocks.js';

export const SLOT_COUNT = 27;
export const HOTBAR_SIZE = 9;

export class Inventory {
  constructor(slots) {
    this.slots = slots ?? new Array(SLOT_COUNT).fill(null);
    this.selected = 0;
  }

  get held() {
    return this.slots[this.selected]?.id ?? null;
  }

  count(id) {
    return this.slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.n : 0), 0);
  }

  // Возвращает, сколько не поместилось.
  add(id, n = 1) {
    const max = itemStack(id);
    for (const slot of this.slots) {
      if (n > 0 && slot?.id === id && slot.n < max) {
        const moved = Math.min(n, max - slot.n);
        slot.n += moved;
        n -= moved;
      }
    }
    for (let i = 0; i < this.slots.length && n > 0; i++) {
      if (!this.slots[i]) {
        const moved = Math.min(n, max);
        this.slots[i] = { id, n: moved };
        n -= moved;
      }
    }
    return n;
  }

  remove(id, n = 1) {
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const slot = this.slots[i];
      if (slot?.id !== id) continue;
      const taken = Math.min(n, slot.n);
      slot.n -= taken;
      n -= taken;
      if (slot.n === 0) this.slots[i] = null;
    }
  }

  takeHeld() {
    const slot = this.slots[this.selected];
    if (!slot) return;
    slot.n--;
    if (slot.n === 0) this.slots[this.selected] = null;
  }

  swap(a, b) {
    const from = this.slots[a];
    const to = this.slots[b];
    if (from && to && from.id === to.id && a !== b) {
      const moved = Math.min(from.n, itemStack(to.id) - to.n);
      to.n += moved;
      from.n -= moved;
      if (from.n === 0) this.slots[a] = null;
      return;
    }
    this.slots[a] = to;
    this.slots[b] = from;
  }

  canCraft(recipe) {
    return recipe.need.every(([id, n]) => this.count(id) >= n);
  }

  craft(recipe) {
    if (!this.canCraft(recipe)) return false;
    for (const [id, n] of recipe.need) this.remove(id, n);
    const left = this.add(recipe.out, recipe.count);
    if (left > 0) {
      // Рюкзак полон: возвращаем материалы и всё, что успело лечь.
      this.remove(recipe.out, recipe.count - left);
      for (const [id, n] of recipe.need) this.add(id, n);
      return false;
    }
    return true;
  }
}
