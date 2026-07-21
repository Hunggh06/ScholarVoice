export class TTSEngine {
  constructor() {
    this._synth = window.speechSynthesis;
    this._utterance = null;
    this._isSpeaking = false;
    this._isPaused = false;
    this._currentText = '';
    this._fullText = '';
    this._progressPct = 0;
    this._progressTimer = null;
    this._startTime = 0;
    this._pausedDuration = 0;
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
      name: `${v.lang} - ${v.name}`,
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
    // Also store the raw voiceURI for speak()
    const voices = this._synth.getVoices();
    const v = voices.find(v => (v.lang + ' - ' + v.name) === name);
    if (v) this._voiceURI = v.voiceURI;
    return true;
  }

  get voice() {
    const voices = this.getAllVoices();
    return voices.find(v => v.name === this._voiceId) || voices.find(v => v.id === this._voiceId) || voices[0] || { name: 'Default', lang: 'en-US' };
  }

  get totalChunks() { return 1; }
  get progress() { return this._progressPct; }

  async speak(text) {
    this.stop();
    if (!text || !text.trim()) return;
    this._currentText = text;
    this._fullText = text;
    this._progressPct = 0;
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

    const charCount = text.length;
    this._estDuration = Math.max(1, charCount / (12 * this._rate));
    this._startTime = performance.now();
    this._pausedDuration = 0;

    this._utterance.onstart = () => {
      this._isSpeaking = true;
      this._isPaused = false;
      if (this.onStart) this.onStart();
      this._startProgress();
    };
    this._utterance.onend = () => {
      this._cleanup();
      if (this.onProgress) this.onProgress(1);
      if (this.onEnd) this.onEnd();
    };
    this._utterance.onpause = () => {
      this._isPaused = true;
      if (this.onPause) this.onPause();
    };
    this._utterance.onresume = () => {
      this._isPaused = false;
      if (this.onResume) this.onResume();
    };
    this._utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') {
        this._cleanup();
        return;
      }
      this._cleanup();
      if (this.onError) this.onError(new Error('Lỗi giọng đọc: ' + e.error));
    };

    this._synth.speak(this._utterance);
  }

  _startProgress() {
    this._stopProgress();
    this._progressTimer = setInterval(() => {
      if (!this._isSpeaking || this._estDuration <= 0) return;
      const elapsed = (performance.now() - this._startTime - this._pausedDuration) / 1000;
      const pct = Math.min(elapsed / this._estDuration, 0.99);
      this._progressPct = pct;
      if (this.onProgress) this.onProgress(pct);
    }, 200);
  }

  _stopProgress() {
    if (this._progressTimer) { clearInterval(this._progressTimer); this._progressTimer = null; }
  }

  _cleanup() {
    this._stopProgress();
    this._isSpeaking = false;
    this._isPaused = false;
    this._utterance = null;
  }

  pause() {
    if (this._isSpeaking && !this._isPaused) {
      this._synth.pause();
    }
  }

  resume() {
    if (this._isPaused) {
      this._synth.resume();
    }
  }

  stop() {
    this._cleanup();
    this._synth.cancel();
    this._progressPct = 0;
    if (this.onProgress) this.onProgress(0);
  }

  seekTo(pct) {
    // Web Speech API doesn't support seeking — restart from position by skipping text
    if (!this._fullText) return;
    const pos = Math.floor((pct / 100) * this._fullText.length);
    const remaining = this._fullText.slice(pos);
    if (remaining.trim()) {
      const wasSpeaking = this._isSpeaking || this._isPaused;
      this.stop();
      if (wasSpeaking) this.speak(remaining);
    }
  }

  applyRate(newRate) {
    if (this._rate === newRate) return;
    this._rate = newRate;
    localStorage.setItem('tts_rate', String(newRate));
  }

  replay() {
    if (this._fullText) this.speak(this._fullText);
  }

  get isSpeaking() { return this._isSpeaking; }
  get isPaused() { return this._isPaused; }

  set rate(value) { this.applyRate(value); }
  get rate() { return this._rate; }

  getVoiceById(id) {
    return this._synth.getVoices().find(v => v.voiceURI === id || v.name === id);
  }
}
