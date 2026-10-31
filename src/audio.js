// Все звуки синтезируются на лету: в проекте нет аудиофайлов.
export class Sound {
  ctx = null;
  muted = false;

  // Браузеры разрешают звук только после действия игрока.
  unlock() {
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
    } catch {
      this.ctx = null;
    }
  }

  #noise(duration, freq, volume) {
    if (!this.ctx || this.muted) return;
    const { ctx } = this;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  #tone(from, to, duration, volume, type = 'square') {
    if (!this.ctx || this.muted) return;
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  dig() { this.#noise(0.07, 900, 0.1); }
  breakBlock() { this.#noise(0.2, 1400, 0.25); }
  place() { this.#noise(0.09, 500, 0.3); }
  hit() { this.#tone(220, 90, 0.12, 0.14); }
  hurt() { this.#tone(320, 120, 0.25, 0.2, 'sawtooth'); }
  groan() { this.#tone(110 + Math.random() * 30, 62, 0.7, 0.07, 'sawtooth'); }
  eat() { this.#noise(0.12, 2000, 0.15); }
  click() { this.#tone(660, 520, 0.05, 0.05); }
  death() { this.#tone(260, 50, 0.9, 0.2, 'sawtooth'); }
}
