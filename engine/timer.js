// Timer de tensión genérico: cuenta regresiva desde N segundos, dispara onExpire si no se detiene antes.
export class SceneTimer {
  constructor({ onTick, onExpire }) {
    this.onTick = onTick;
    this.onExpire = onExpire;
    this._intervalId = null;
    this.remaining = 0;
    this.running = false;
  }

  start(seconds) {
    this.stop();
    this.remaining = seconds;
    this.running = true;
    this.onTick?.(this.remaining);
    this._intervalId = setInterval(() => {
      this.remaining -= 1;
      this.onTick?.(this.remaining);
      if (this.remaining <= 0) {
        this.stop();
        this.onExpire?.();
      }
    }, 1000);
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this.running = false;
  }
}
