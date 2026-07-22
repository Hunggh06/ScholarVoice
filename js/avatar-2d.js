export class Avatar2D {
  constructor(containerEl) {
    this.container = containerEl;
    this._isSpeaking = false;
    this._initialized = true;

    this.container.innerHTML = `
      <div class="av2d-inner">
        <div class="av2d-character">🎓</div>
        <div class="av2d-visualizer">
          <span class="av2d-bar"></span><span class="av2d-bar"></span>
          <span class="av2d-bar"></span><span class="av2d-bar"></span>
          <span class="av2d-bar"></span>
        </div>
        <div class="av2d-gesture"></div>
      </div>
    `;

    this._charEl = this.container.querySelector('.av2d-character');
    this._visualizer = this.container.querySelector('.av2d-visualizer');
    this._gestureEl = this.container.querySelector('.av2d-gesture');
    this._bars = this.container.querySelectorAll('.av2d-bar');

    this._gestureTimer = 0;
    this._gestureInterval = 6 + Math.random() * 4;
    this._gestureActive = false;

    // Start animation loop
    this._tick();
  }

  get isLoaded() { return true; }

  _tick() {
    if (this._disposed) return;
    this._animFrameId = requestAnimationFrame(() => this._tick());

    if (this._isSpeaking) {
      // Animate waveform bars with random heights
      for (const bar of this._bars) {
        const h = 30 + Math.random() * 70;
        bar.style.height = h + '%';
      }
      // Gesture timing
      this._gestureTimer += 0.016;
      if (!this._gestureActive && this._gestureTimer >= this._gestureInterval) {
        this._showGesture();
      }
    }
  }

  _showGesture() {
    this._gestureActive = true;
    this._gestureEl.textContent = '👉';
    this._gestureEl.style.opacity = '1';
    this._gestureEl.style.transform = 'translateX(0)';
    setTimeout(() => {
      this._gestureEl.style.opacity = '0';
      this._gestureEl.style.transform = 'translateX(20px)';
      this._gestureTimer = 0;
      this._gestureInterval = 6 + Math.random() * 4;
      this._gestureActive = false;
    }, 1500);
  }

  setSpeaking(v) {
    this._isSpeaking = !!v;
    if (this._charEl) {
      this._charEl.classList.toggle('av2d-speaking', this._isSpeaking);
    }
    if (this._visualizer) {
      this._visualizer.classList.toggle('av2d-active', this._isSpeaking);
    }
    if (!v) {
      // Reset bars
      for (const bar of this._bars) {
        bar.style.height = '8%';
      }
      this._gestureActive = false;
      if (this._gestureEl) {
        this._gestureEl.style.opacity = '0';
      }
    }
  }

  dispose() {
    this._disposed = true;
    if (this._animFrameId) cancelAnimationFrame(this._animFrameId);
    if (this.container) this.container.innerHTML = '';
  }
}
