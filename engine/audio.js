// Sonido sintetizado con Web Audio API — sin archivos externos que mantener
// ni descargar. El motor resuelve el sonido por TIPO de acción/evento, igual
// que actions.js resuelve la lógica: nunca hardcodeado por escena.
export class SoundManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.ambientKey = null;
    this.ambientNodes = [];
    this.tensionInterval = null;
    this._pendingAmbientKey = null;
    this._armGestureUnlock();
  }

  _ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.enabled = false;
      return;
    }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  _armGestureUnlock() {
    const unlock = () => {
      this._ensureContext();
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      if (this._pendingAmbientKey) {
        const key = this._pendingAmbientKey;
        this._pendingAmbientKey = null;
        this.startAmbient(key);
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  _tone(freq, { type = "sine", duration = 0.12, gain = 0.2, delay = 0 } = {}) {
    if (!this.enabled) return;
    this._ensureContext();
    if (!this.ctx || this.ctx.state === "suspended") return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  playClick() {
    this._tone(520, { type: "triangle", duration: 0.08, gain: 0.15 });
  }

  playPickup() {
    this._tone(660, { type: "sine", duration: 0.1, gain: 0.18 });
    this._tone(880, { type: "sine", duration: 0.14, gain: 0.16, delay: 0.08 });
  }

  playFail() {
    this._tone(220, { type: "sawtooth", duration: 0.18, gain: 0.12 });
    this._tone(160, { type: "sawtooth", duration: 0.22, gain: 0.12, delay: 0.1 });
  }

  playUnlock() {
    [523, 659, 784].forEach((f, i) => this._tone(f, { type: "triangle", duration: 0.15, gain: 0.16, delay: i * 0.09 }));
  }

  playEndingSting(type) {
    if (type === "verdadero") {
      [392, 494, 587, 784].forEach((f, i) => this._tone(f, { type: "sine", duration: 0.5, gain: 0.14, delay: i * 0.12 }));
    } else if (type === "agridulce") {
      [349, 415, 523].forEach((f, i) => this._tone(f, { type: "triangle", duration: 0.6, gain: 0.12, delay: i * 0.15 }));
    } else {
      [220, 196, 174].forEach((f, i) => this._tone(f, { type: "sawtooth", duration: 0.7, gain: 0.13, delay: i * 0.2 }));
    }
  }

  startAmbient(key) {
    if (this.ambientKey === key) return;
    this.stopAmbient();
    this.ambientKey = key;
    if (!key || key === "none" || !this.enabled) return;
    this._ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      this._pendingAmbientKey = key;
      return;
    }
    if (key === "wind") this._startWind();
    else if (key === "hum") this._startHum();
  }

  _startWind() {
    const ctx = this.ctx;
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;

    const gain = ctx.createGain();
    gain.gain.value = 0.05;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    noise.start();
    lfo.start();

    this.ambientNodes = [noise, lfo];
  }

  _startHum() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 60;

    const gain = ctx.createGain();
    gain.gain.value = 0.04;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();

    this.ambientNodes = [osc, lfo];
  }

  stopAmbient() {
    this.ambientNodes.forEach((n) => {
      try {
        n.stop();
      } catch (e) {
        /* ya detenido */
      }
      n.disconnect();
    });
    this.ambientNodes = [];
    this.ambientKey = null;
  }

  startTension() {
    if (this.tensionInterval || !this.enabled) return;
    this._ensureContext();
    if (!this.ctx) return;
    const beat = () => this._tone(110, { type: "sine", duration: 0.12, gain: 0.2 });
    beat();
    this.tensionInterval = setInterval(beat, 650);
  }

  stopTension() {
    if (this.tensionInterval) {
      clearInterval(this.tensionInterval);
      this.tensionInterval = null;
    }
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (muted) {
      this.stopAmbient();
      this.stopTension();
    }
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }
}
