const MOUSE_LOOK = 0.0024;
const TOUCH_LOOK = 0.0052;
const STICK_RADIUS = 52;

// Единое управление для мыши с клавиатурой и для пальцев.
export class Input {
  moveX = 0;
  moveZ = 0;
  lookX = 0;
  lookY = 0;
  jump = false;
  sprint = false;
  mine = false;
  place = false;
  active = false;
  touchMode = false;
  lockFailed = false;

  #keys = new Set();
  #touches = new Map();
  #stick = { x: 0, y: 0 };

  constructor(canvas, ui, handlers) {
    this.canvas = canvas;
    this.ui = ui;
    this.handlers = handlers;
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;

    window.addEventListener('keydown', (e) => this.#onKey(e, true));
    window.addEventListener('keyup', (e) => this.#onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('mousemove', (e) => this.#onMouseMove(e));
    window.addEventListener('wheel', (e) => this.active && handlers.onScroll(Math.sign(e.deltaY)), { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.#onLockChange());
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });

    window.addEventListener('pointerdown', (e) => this.#onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.#onPointerMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.#onPointerUp(e));
    window.addEventListener('touchmove', (e) => { if (this.active) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('dblclick', (e) => e.preventDefault());

    this.ui.setTouchMode(this.touchMode);
  }

  reset() {
    this.#keys.clear();
    this.#touches.clear();
    this.#stick = { x: 0, y: 0 };
    this.mine = false;
    this.place = false;
    this.jump = false;
    this.sprint = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.ui.setStick(null);
    this.ui.setActionPressed(null);
  }

  lock() {
    if (this.touchMode) return;
    try {
      const result = this.canvas.requestPointerLock?.();
      result?.catch?.(() => { this.lockFailed = true; });
      if (!this.canvas.requestPointerLock) this.lockFailed = true;
    } catch {
      this.lockFailed = true;
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  // Вызывается раз в кадр: собирает клавиши и джойстик в один вектор движения.
  poll() {
    const k = this.#keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.#stick.x || this.#stick.y) {
      x = this.#stick.x;
      z = -this.#stick.y;
      // Джойстик, дожатый до края вперёд, переводит на бег.
      sprint = Math.hypot(x, z) > 0.93 && z > 0.5;
    }
    this.moveX = x;
    this.moveZ = z;
    this.sprint = sprint;
    if (k.has('Space')) this.jump = true;
  }

  consumeLook() {
    const out = [this.lookX, this.lookY];
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  #onKey(e, down) {
    if (down && e.repeat) return;
    if (down) {
      if (e.code === 'KeyE') this.handlers.onInventory();
      if (e.code === 'Escape' || e.code === 'KeyP') this.handlers.onEscape();
      if (this.active && /^Digit[1-9]$/.test(e.code)) this.handlers.onHotbar(Number(e.code[5]) - 1);
    }
    if (!this.active) {
      this.#keys.delete(e.code);
      return;
    }
    if (down) this.#keys.add(e.code);
    else {
      this.#keys.delete(e.code);
      if (e.code === 'Space') this.jump = false;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }

  #onMouseMove(e) {
    if (!this.active || this.touchMode) return;
    // Если браузер отказал в захвате курсора, камера просто следует за мышью.
    if (this.locked || this.lockFailed) {
      this.lookX += e.movementX * MOUSE_LOOK;
      this.lookY += e.movementY * MOUSE_LOOK;
    }
  }

  #onLockChange() {
    if (this.locked) this.lockFailed = false;
    if (!this.locked && this.active && !this.lockFailed) this.handlers.onEscape();
  }

  #onPointerDown(e) {
    if (e.pointerType === 'mouse') {
      if (this.touchMode && !window.matchMedia('(pointer: coarse)').matches) {
        this.touchMode = false;
        this.ui.setTouchMode(false);
      }
      if (!this.active || e.target !== this.canvas) return;
      // Браузер мог отказать (например, сразу после Esc): просим захват при каждом клике.
      if (!this.locked) {
        this.lock();
        if (!this.lockFailed) return;
      }
      if (e.button === 0) this.mine = true;
      if (e.button === 2) this.place = true;
      return;
    }

    if (!this.touchMode) {
      this.touchMode = true;
      this.ui.setTouchMode(true);
    }
    if (!this.active) return;

    const action = e.target.closest?.('[data-action]')?.dataset.action;
    if (action) {
      this.#touches.set(e.pointerId, { role: action, x: e.clientX, y: e.clientY });
      this.#setAction(action, true);
      e.preventDefault();
      return;
    }
    if (e.target.closest?.('.hud-control')) return;

    const stickFree = ![...this.#touches.values()].some((t) => t.role === 'stick');
    if (e.clientX < window.innerWidth * 0.42 && stickFree) {
      this.#touches.set(e.pointerId, { role: 'stick', x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY });
      this.ui.setStick({ cx: e.clientX, cy: e.clientY, x: 0, y: 0 });
    } else {
      this.#touches.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
    }
  }

  #onPointerMove(e) {
    const touch = this.#touches.get(e.pointerId);
    if (!touch) return;
    if (touch.role === 'stick') {
      const dx = e.clientX - touch.cx;
      const dy = e.clientY - touch.cy;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
      this.#stick = { x: (dx * k) / STICK_RADIUS, y: (dy * k) / STICK_RADIUS };
      this.ui.setStick({ cx: touch.cx, cy: touch.cy, x: dx * k, y: dy * k });
    } else if (touch.role === 'look' || touch.role === 'mine') {
      // Кнопка копания тоже поворачивает камеру: можно вести прицел, не отпуская её.
      this.lookX += (e.clientX - touch.x) * TOUCH_LOOK;
      this.lookY += (e.clientY - touch.y) * TOUCH_LOOK;
      touch.x = e.clientX;
      touch.y = e.clientY;
    }
    e.preventDefault();
  }

  #onPointerUp(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mine = false;
      if (e.button === 2) this.place = false;
      return;
    }
    const touch = this.#touches.get(e.pointerId);
    if (!touch) return;
    this.#touches.delete(e.pointerId);
    if (touch.role === 'stick') {
      this.#stick = { x: 0, y: 0 };
      this.ui.setStick(null);
    } else if (touch.role !== 'look') {
      this.#setAction(touch.role, false);
    }
  }

  #setAction(action, down) {
    if (action === 'jump') this.jump = down;
    if (action === 'mine') this.mine = down;
    if (action === 'place') this.place = down;
    this.ui.setActionPressed(action, down);
  }
}
