export class TTSEngine {
  constructor() {
    this._synth = window.speechSynthesis;
    this._utterance = null;
    this._isSpeaking = false;
    this._isPaused = false;
    this._currentText = '';
    this._fullText = '';
    this._seekOffsetPct = 0;
    this._progressPct = 0;
    this._progressTimer = null;
    this._startTime = 0;
    this._pausedAt = 0;
    this._totalPaused = 0;
    this._estDuration = 0;
    this._rate = parseFloat(localStorage.getItem('tts_rate') || '1.0');
    this._voiceId = localStorage.getItem('tts_voice') || '';
    this._voiceURI = null;

    this.onStart = null;
    this.onEnd = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onProgress = null;

    this.synth = this._synth;
    this._voiceName = this._voiceId;
  }

  getAllVoices() {
    return this._synth.getVoices().map(v => ({
      name: v.lang + ' - ' + v.name,
      id: v.voiceURI || v.name,
      lang: v.lang,
    }));
  }

  getVietnameseVoices() {
    return this.getAllVoices().filter(v => v.lang.startsWith('vi'));
  }

  get hasVietnameseVoice() {
    return this.getVietnameseVoices().length > 0;
  }

  get isFallbackVoice() { return false; }

  setVoiceByName(name) {
    this._voiceId = name;
    this._voiceName = name;
    localStorage.setItem('tts_voice', name);
    const v = this._synth.getVoices().find(v => (v.lang + ' - ' + v.name) === name);
    if (v) this._voiceURI = v.voiceURI;
    return true;
  }

  get voice() {
    const voices = this.getAllVoices();
    return voices.find(v => v.name === this._voiceId) || voices.find(v => v.id === this._voiceId) || voices[0] || { name: 'Default', lang: 'en-US' };
  }

  get totalChunks() { return 1; }
  get progress() { return this._progressPct; }

  /**
   * Speak a text. If keepFullText is true, _fullText is preserved
   * (used internally by seekTo to keep original text for progress tracking).
   */
  async speak(text, { keepFullText = false, seekOffsetPct = 0 } = {}) {
    this.stop();
    if (!text || !text.trim()) return;
    this._currentText = text;

    if (keepFullText) {
      // Seeking: preserve original _fullText, track offset
      this._seekOffsetPct = seekOffsetPct;
    } else {
      this._fullText = text;
      this._seekOffsetPct = 0;
    }

    this._progressPct = this._seekOffsetPct;
    this._totalPaused = 0;
    this._synth.cancel();

    this._utterance = new SpeechSynthesisUtterance(text);
    this._utterance.rate = this._rate;

    const voices = this._synth.getVoices();
    if (this._voiceURI) {
      const v = voices.find(v => v.voiceURI === this._voiceURI);
      if (v) this._utterance.voice = v;
    } else if (this._voiceId) {
      const v = voices.find(v => (v.lang + ' - ' + v.name) === this._voiceId);
      if (v) this._utterance.voice = v;
    }

    this._estDuration = Math.max(1, text.length / (12 * this._rate));
    this._startTime = performance.now();

    this._utterance.onstart = () => {
      this._isSpeaking = true;
      this._isPaused = false;
      if (this.onStart) this.onStart();
      this._startProgress();
    };
    this._utterance.onend = () => {
      this._cleanup();
      // Report exact position: seek offset + (1 - seek offset) = 1.0
      const finalPct = this._seekOffsetPct > 0
        ? this._seekOffsetPct + (1 - this._seekOffsetPct)
        : 1;
      if (this.onProgress) this.onProgress(Math.min(finalPct, 1));
      if (this.onEnd) this.onEnd();
    };
    this._utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') { this._cleanup(); return; }
      this._cleanup();
      if (this.onError) this.onError(new Error(e.error));
    };

    this._synth.speak(this._utterance);
  }

  _startProgress() {
    clearInterval(this._progressTimer);
    this._progressTimer = setInterval(() => {
      if (!this._isSpeaking || this._isPaused || this._estDuration <= 0) return;
      const elapsed = (performance.now() - this._startTime - this._totalPaused) / 1000;
      const localPct = Math.min(elapsed / this._estDuration, 0.99);
      // Map local progress (0..1 within the current chunk) to absolute progress
      const absPct = this._seekOffsetPct + localPct * (1 - this._seekOffsetPct);
      this._progressPct = absPct;
      if (this.onProgress) this.onProgress(absPct);
    }, 200);
  }

  _cleanup() {
    clearInterval(this._progressTimer);
    this._progressTimer = null;
    this._isSpeaking = false;
    this._isPaused = false;
    this._utterance = null;
  }

  pause() {
    if (this._isSpeaking && !this._isPaused) {
      this._pausedAt = performance.now();
      this._synth.pause();
      this._isPaused = true;
      if (this.onPause) this.onPause();
    }
  }

  resume() {
    if (this._isPaused) {
      this._totalPaused += performance.now() - this._pausedAt;
      this._synth.resume();
      this._isPaused = false;
      if (this.onResume) this.onResume();
    }
  }

  stop() {
    this._cleanup();
    this._synth.cancel();
    this._progressPct = 0;
    this._seekOffsetPct = 0;
    if (this.onProgress) this.onProgress(0);
  }

  /**
   * Seek to a percentage (0-100) of the full text.
   * Works by restarting speech from the calculated character position
   * while preserving the original _fullText for accurate progress tracking.
   */
  seekTo(pct) {
    if (!this._fullText) return;
    const pos = Math.floor((pct / 100) * this._fullText.length);
    const remaining = this._fullText.slice(pos);
    if (remaining.trim()) {
      const wasActive = this._isSpeaking || this._isPaused;
      this._cleanup();
      this._synth.cancel();
      if (wasActive) {
        // Speak remaining portion while keeping original _fullText
        this.speak(remaining, { keepFullText: true, seekOffsetPct: pct / 100 });
      } else {
        this._progressPct = pct / 100;
        this._seekOffsetPct = pct / 100;
        if (this.onProgress) this.onProgress(pct / 100);
      }
    }
  }

  applyRate(newRate) {
    if (this._rate === newRate) return;
    this._rate = newRate;
    localStorage.setItem('tts_rate', String(newRate));
    if (this._isSpeaking || this._isPaused) {
      const curPct = this._progressPct * 100;
      const full = this._fullText;
      this.speak(full);
      // Re-seek to previous position after short delay
      setTimeout(() => {
        if (this._isSpeaking || this._isPaused) {
          this.seekTo(curPct);
        }
      }, 100);
    }
  }

  replay() {
    if (this._fullText) this.speak(this._fullText);
  }

  get isSpeaking() { return this._isSpeaking; }
  get isPaused() { return this._isPaused; }
  set rate(value) { this.applyRate(value); }
  get rate() { return this._rate; }
  getVoiceById(id) { return this._synth.getVoices().find(v => v.voiceURI === id || v.name === id); }
}
