/**
 * TTSEngine - Sinh giong tu nhien qua Google Cloud Text-to-Speech (server proxy /api/tts).
 * Key nam tren server (env GOOGLE_TTS_KEY), khong lo len trinh duyet.
 * Giu nguyen interface cu de app.js khong can sua.
 */

// name = dinh danh luu vao localStorage (tuong thich app.js); id = ma giong goi server
const GOOGLE_VOICES = [
  { name: 'Việt Nam - Wavenet A (Nữ)', id: 'vi-VN-Wavenet-A', lang: 'vi-VN' },
  { name: 'Việt Nam - Wavenet B (Nam)', id: 'vi-VN-Wavenet-B', lang: 'vi-VN' },
  { name: 'Việt Nam - Neural2 A (Nữ)', id: 'vi-VN-Neural2-A', lang: 'vi-VN' },
  { name: 'Việt Nam - Neural2 B (Nam)', id: 'vi-VN-Neural2-B', lang: 'vi-VN' },
  { name: 'US - Wavenet C (Nữ)', id: 'en-US-Wavenet-C', lang: 'en-US' },
  { name: 'US - Neural2 F (Nữ)', id: 'en-US-Neural2-F', lang: 'en-US' },
  { name: 'Japan - Wavenet A (Nữ)', id: 'ja-JP-Wavenet-A', lang: 'ja-JP' },
  { name: 'Korea - Wavenet B (Nữ)', id: 'ko-KR-Wavenet-B', lang: 'ko-KR' },
  { name: 'France - Wavenet B (Nữ)', id: 'fr-FR-Wavenet-B', lang: 'fr-FR' },
  { name: 'Germany - Wavenet B (Nữ)', id: 'de-DE-Wavenet-B', lang: 'de-DE' },
];

function _resolveVoiceId(nameOrId) {
  if (!nameOrId) return 'vi-VN-Wavenet-A';
  const byName = GOOGLE_VOICES.find(v => v.name === nameOrId);
  if (byName) return byName.id;
  const byId = GOOGLE_VOICES.find(v => v.id === nameOrId);
  if (byId) return byId.id;
  return 'vi-VN-Wavenet-A';
}

export class TTSEngine {
  constructor() {
    this._audio = new Audio();
    this._isSpeaking = false;
    this._isPaused = false;
    this._stopRequested = false;
    this._currentText = '';
    this._fullText = '';
    this._progressPct = 0;
    this._pendingSeek = null;
    this._rate = parseFloat(localStorage.getItem('tts_rate') || '1.0');
    this._voiceId = localStorage.getItem('tts_voice') || 'vi-VN-Wavenet-A';

    // Tuong thich app.js cu
    this.synth = { addEventListener() {} };
    this._voiceName = this._voiceId;

    this.onStart = null;
    this.onEnd = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onProgress = null;

    this._audio.addEventListener('loadedmetadata', () => {
      if (this._pendingSeek != null) {
        const pct = this._pendingSeek;
        this._pendingSeek = null;
        this.seekTo(pct);
      }
    });
    this._audio.addEventListener('timeupdate', () => {
      if (this._audio.duration > 0) {
        const pct = this._audio.currentTime / this._audio.duration;
        this._progressPct = pct;
        if (this.onProgress) this.onProgress(pct);
      }
    });
    this._audio.addEventListener('ended', () => {
      if (this._stopRequested) return;
      this._isSpeaking = false;
      this._isPaused = false;
      this._progressPct = 1;
      if (this.onProgress) this.onProgress(1);
      if (this.onEnd) this.onEnd();
    });
    this._audio.addEventListener('error', () => {
      if (this._stopRequested) return;
      this._isSpeaking = false;
      if (this.onError) this.onError(new Error('Lỗi phát âm thanh từ server TTS.'));
    });
  }

  getAllVoices() {
    return GOOGLE_VOICES;
  }

  getVietnameseVoices() {
    return GOOGLE_VOICES.filter(v => v.lang.startsWith('vi'));
  }

  get hasVietnameseVoice() {
    return this.getVietnameseVoices().length > 0;
  }

  get isFallbackVoice() {
    return false;
  }

  setVoiceByName(name) {
    this._voiceId = name;
    this._voiceName = name;
    localStorage.setItem('tts_voice', name);
    return true;
  }

  get voice() {
    return GOOGLE_VOICES.find(v => v.name === this._voiceId) || GOOGLE_VOICES[0];
  }

  get totalChunks() {
    return 1;
  }

  get progress() {
    return this._progressPct;
  }

  async speak(text) {
    this.stop();
    this._stopRequested = false;
    if (!text || !text.trim()) return;

    this._currentText = text;
    this._fullText = text;
    this._progressPct = 0;

    if (this.onStart) this.onStart();

    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          voice: _resolveVoiceId(this._voiceId),
          rate: this._rate,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || ('TTS lỗi HTTP ' + resp.status));
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      this._audio.src = url;
      this._isSpeaking = true;
      this._isPaused = false;
      await this._audio.play();
    } catch (e) {
      this._isSpeaking = false;
      if (this.onError) this.onError(e);
    }
  }

  pause() {
    if (this._isSpeaking && !this._isPaused) {
      this._audio.pause();
      this._isPaused = true;
      if (this.onPause) this.onPause();
    }
  }

  resume() {
    if (this._isPaused) {
      this._audio.play();
      this._isPaused = false;
      if (this.onResume) this.onResume();
    }
  }

  stop() {
    this._stopRequested = true;
    this._audio.pause();
    this._audio.currentTime = 0;
    this._isSpeaking = false;
    this._isPaused = false;
    this._progressPct = 0;
    if (this.onProgress) this.onProgress(0);
  }

  seekTo(pct) {
    if (!this._audio.duration) return;
    const t = Math.max(0, Math.min(pct / 100, 1)) * this._audio.duration;
    this._audio.currentTime = t;
    this._progressPct = pct / 100;
    if (this.onProgress) this.onProgress(this._progressPct);
  }

  applyRate(newRate) {
    if (this._rate === newRate) return;
    this._rate = newRate;
    localStorage.setItem('tts_rate', String(newRate));
    if (this._isSpeaking || this._isPaused) {
      const curPct = this._progressPct * 100;
      this.speak(this._fullText);
      this._pendingSeek = curPct;
    }
  }

  replay() {
    this.stop();
    this.speak(this._fullText || this._currentText);
  }

  get isSpeaking() { return this._isSpeaking; }
  get isPaused() { return this._isPaused; }

  set rate(value) { this.applyRate(value); }
  get rate() { return this._rate; }
}
