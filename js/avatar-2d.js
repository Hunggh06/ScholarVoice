// Avatar2D - lightweight inline animation controller
// Called by app.js to sync speaking state with visual elements
export class Avatar2D {
  constructor(containerEl) {
    this.container = containerEl;
    this._isSpeaking = false;
    this._bars = containerEl.querySelectorAll('.av2d-bar');
    this._charEl = containerEl.querySelector('.av2d-character');
    this._visualizer = containerEl.querySelector('.av2d-visualizer');
    this._gestureEl = containerEl.querySelector('.av2d-gesture');
    this._gestureTimer = 0;
    this._gestureInterval = 6;
    this._animId = null;
    console.log('[Avatar2D] Initialized - bars:', this._bars.length, 'char:', !!this._charEl);
    this._tick();
  }
  get isLoaded() { return true; }
  _tick() {
    if (this._disposed) return;
    this._animId = requestAnimationFrame(() => this._tick());
    if (!this._isSpeaking) return;
    this._bars.forEach(b => { b.style.height = (20 + Math.random() * 80) + '%'; });
    this._gestureTimer += 0.016;
    if (this._gestureTimer >= this._gestureInterval) {
      this._gestureTimer = 0;
      this._gestureInterval = 5 + Math.random() * 5;
      if (this._gestureEl) {
        this._gestureEl.style.opacity = '1';
        this._gestureEl.style.transform = 'translateX(0)';
        setTimeout(() => {
          if (this._gestureEl) {
            this._gestureEl.style.opacity = '0';
            this._gestureEl.style.transform = 'translateX(12px)';
          }
        }, 1500);
      }
    }
  }
  setSpeaking(v) {
    this._isSpeaking = !!v;
    if (this._charEl) this._charEl.classList.toggle('av2d-speaking', this._isSpeaking);
    if (this._visualizer) this._visualizer.classList.toggle('av2d-active', this._isSpeaking);
    if (!v) {
      this._bars.forEach(b => { b.style.height = '8%'; });
      if (this._gestureEl) this._gestureEl.style.opacity = '0';
    }
  }
  dispose() {
    this._disposed = true;
    if (this._animId) cancelAnimationFrame(this._animId);
  }
}
