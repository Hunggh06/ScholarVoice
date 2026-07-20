/**
 * TTSEngine - Dùng Web Speech API của trình duyệt.
 * Giong phu thuoc vao giong da cai dat tren he dieu hanh cua user
 * (tren Windows/macOS/iOS thuong co san giong tieng Viet tu nhien).
 * Khong can server, chay ngay tren browser.
 */

export class TTSEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this._isSpeaking = false;
    this._isPaused = false;
    this._stopRequested = false;
    this._currentText = '';
    this._fullText = '';
    this._progressPct = 0;
    this._resumeTimer = null;
    this._seekOffset = 0;
    this._lastCharIndex = 0;
    this._voiceName = localStorage.getItem('tts_voice') || '';
    this._rate = parseFloat(localStorage.getItem('tts_rate') || '1.0');

    this.onStart = null;
    this.onEnd = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onProgress = null;

    setInterval(() => {
      if (this.synth.speaking && !this.synth.paused) {
        if (!this._isSpeaking && !this._stopRequested) {
          this._isSpeaking = true;
          this._isPaused = false;
        }
      } else if (this.synth.paused) {
        if (!this._isPaused) {
          this._isPaused = true;
          if (this.onPause) this.onPause();
        }
      } else if (!this.synth.speaking && this._isSpeaking && !this._stopRequested) {
        this._isSpeaking = false;
        this._isPaused = false;
        if (this.onEnd) this.onEnd();
      }
    }, 200);
  }

  getAllVoices() {
    return this.synth.getVoices();
  }

  getVietnameseVoices() {
    return this.synth.getVoices().filter(v =>
      v.lang.startsWith('vi') || v.lang.startsWith('vi-VN')
    );
  }

  get hasVietnameseVoice() {
    return this.getVietnameseVoices().length > 0;
  }

  get isFallbackVoice() {
    return !this.hasVietnameseVoice;
  }

  setVoiceByName(name) {
    this._voiceName = name;
    localStorage.setItem('tts_voice', name);
    return true;
  }

  get voice() {
    const all = this.synth.getVoices();
    if (all.length === 0) return null;
    if (this._voiceName) {
      const found = all.find(v => v.name === this._voiceName);
      if (found) return found;
    }
    const viVoices = this.getVietnameseVoices();
    if (viVoices.length > 0) return viVoices[0];
    return all[0] || null;
  }

  get totalChunks() {
    return Math.ceil((this._currentText || '').length / 200) || 1;
  }

  get progress() {
    return this._progressPct;
  }

  async speak(text) {
    clearTimeout(this._resumeTimer);
    this._resumeTimer = null;
    this.stop();
    this._stopRequested = false;
    if (!text || !text.trim()) return;

    const voice = this.voice;
    if (!voice) {
      if (this.onError) this.onError(new Error('Chưa tải được giọng đọc. F5 lại trang hoặc cài giọng tiếng Việt trong Settings hệ thống.'));
      return;
    }

    this._currentText = text;
    this._fullText = text;
    this._seekOffset = 0;
    this._lastCharIndex = 0;
    this._progressPct = 0;
    this._isSpeaking = true;
    this._isPaused = false;
    if (this.onStart) this.onStart();

    this._createUtterance(text, this._rate);
  }

  _createUtterance(text, rate) {
    const v = this.voice;
    if (!v) {
      if (this.onError) this.onError(new Error('Không có giọng đọc tiếng Việt.'));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = v;
    utterance.lang = v.lang || 'vi-VN';
    utterance.rate = rate;
    utterance.volume = 1;

    utterance.onend = () => {
      this._isSpeaking = false;
      this._isPaused = false;
      this._progressPct = 1;
      if (this.onProgress) this.onProgress(1);
      if (this.onEnd) this.onEnd();
    };

    utterance.onboundary = (e) => {
      this._lastCharIndex = e.charIndex;
      const absIdx = this._seekOffset + e.charIndex;
      const pct = this._fullText.length > 0
        ? Math.min(absIdx / this._fullText.length, 0.99)
        : 0;
      this._progressPct = pct;
      if (this.onProgress) this.onProgress(pct);
    };

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('Speech error:', e.error);
      this._isSpeaking = false;
      if (this.onError) this.onError(new Error('Lỗi giọng đọc: ' + e.error));
    };

    this.synth.speak(utterance);
  }

  pause() {
    if (this._isSpeaking && !this._isPaused) {
      this.synth.pause();
      this._isPaused = true;
      if (this.onPause) this.onPause();
    }
  }

  resume() {
    if (this._isPaused) {
      this.synth.resume();
      this._isPaused = false;
      if (this.onResume) this.onResume();

      const savedText = this._fullText;
      const savedOffset = this._seekOffset + this._lastCharIndex;
      clearTimeout(this._resumeTimer);
      this._resumeTimer = setTimeout(() => {
        this._resumeTimer = null;
        if (savedText && this._fullText === savedText
          && !this.synth.speaking && !this.synth.paused) {
          this._seekFrom(savedOffset);
        }
      }, 350);
    }
  }

  _seekFrom(charIdx) {
    if (!this._fullText) return;
    const idx = Math.min(charIdx, this._fullText.length - 1);
    if (idx <= 0) {
      this.speak(this._fullText);
      return;
    }
    this._seekOffset = idx;
    this._lastCharIndex = 0;
    const remaining = this._fullText.slice(idx);
    this._isSpeaking = true;
    this._isPaused = false;
    this._stopRequested = true;
    setTimeout(() => {
      this._stopRequested = false;
      this._createUtterance(remaining, this._rate);
    }, 50);
  }

  stop() {
    clearTimeout(this._resumeTimer);
    this._resumeTimer = null;
    this._stopRequested = true;
    this.synth.cancel();
    this._isSpeaking = false;
    this._isPaused = false;
    this._progressPct = 0;
    this._seekOffset = 0;
    this._lastCharIndex = 0;
    if (this.onProgress) this.onProgress(0);
  }

  seekTo(pct) {
    if (!this._isSpeaking && !this._isPaused) return;
    if (!this._fullText) return;
    const idx = Math.floor(pct / 100 * this._fullText.length);
    this.synth.cancel();
    this._seekFrom(idx);
  }

  applyRate(newRate) {
    if (this._rate === newRate) return;
    this._rate = newRate;
    localStorage.setItem('tts_rate', String(newRate));
    if (this._isSpeaking && !this._isPaused && this._fullText) {
      const curIdx = this._seekOffset + this._lastCharIndex;
      this.synth.cancel();
      this._seekFrom(curIdx);
    }
  }

  replay() {
    this.stop();
    this.speak(this._fullText || this._currentText);
  }

  get isSpeaking() { return this._isSpeaking; }
  get isPaused() { return this._isPaused; }

  set rate(value) {
    this.applyRate(value);
  }
  get rate() { return this._rate; }
}
