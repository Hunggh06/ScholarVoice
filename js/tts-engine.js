/**
 * TTSEngine - Sinh giong doc tu nhien qua edge-tts (Microsoft Neural TTS)
 * Server proxy tai /api/tts tra ve audio mp3. Khong phu thuoc giong cai dat
 * tren trinh duyet, giong tieng Viet rat tu nhien, toc do nhanh (stream API).
 *
 * Giu nguyen interface cu (speak/pause/resume/stop/seekTo/applyRate + callbacks)
 * de app.js khong can sua.
 */

// name = dinh danh luu vao localStorage (tuong thich app.js cu); id = ma giong thuc te goi server
const EDGE_VOICES = [
  { name: 'Việt Nam - Hoài My (Nữ)', id: 'vi-VN-HoaiMyNeural', lang: 'vi-VN' },
  { name: 'Việt Nam - Nam Minh (Nam)', id: 'vi-VN-NamMinhNeural', lang: 'vi-VN' },
  { name: 'US - Jenny (Nữ)', id: 'en-US-JennyNeural', lang: 'en-US' },
  { name: 'US - Guy (Nam)', id: 'en-US-GuyNeural', lang: 'en-US' },
  { name: 'UK - Sonia (Nữ)', id: 'en-GB-SoniaNeural', lang: 'en-GB' },
  { name: 'Japan - Nanami (Nữ)', id: 'ja-JP-NanamiNeural', lang: 'ja-JP' },
  { name: 'Korea - SunHi (Nữ)', id: 'ko-KR-SunHiNeural', lang: 'ko-KR' },
  { name: 'France - Denise (Nữ)', id: 'fr-FR-DeniseNeural', lang: 'fr-FR' },
  { name: 'Germany - Katja (Nữ)', id: 'de-DE-KatjaNeural', lang: 'de-DE' },
  { name: 'China - Xiaoxiao (Nữ)', id: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN' },
];

function _resolveVoiceId(nameOrId) {
  if (!nameOrId) return 'vi-VN-HoaiMyNeural';
  const byName = EDGE_VOICES.find(v => v.name === nameOrId);
  if (byName) return byName.id;
  const byId = EDGE_VOICES.find(v => v.id === nameOrId);
  if (byId) return byId.id;
  return 'vi-VN-HoaiMyNeural';
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
    this._rate = parseFloat(localStorage.getItem('tts_rate') || '1.0');
    this._voiceId = localStorage.getItem('tts_voice') || 'vi-VN-HoaiMyNeural';

    this.onStart = null;
    this.onEnd = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onProgress = null;

    this._audio.addEventListener('timeupdate', () => {
      if (this._audio.duration > 0) {
        const pct = this._audio.currentTime / this._audio.duration;
        this._progressPct = pct;
        if (this.onProgress) this.onProgress(pct);
      }
    });
    this._audio.addEventListener('loadedmetadata', () => {
      if (this._pendingSeek != null) {
        const pct = this._pendingSeek;
        this._pendingSeek = null;
        this.seekTo(pct);
      }
    });
    this._audio.addEventListener('ended', () => {      if (this._stopRequested) return;
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
    return EDGE_VOICES;
  }

  getVietnameseVoices() {
    return EDGE_VOICES.filter(v => v.lang.startsWith('vi'));
  }

  get hasVietnameseVoice() {
    return this.getVietnameseVoices().length > 0;
  }

  get isFallbackVoice() {
    return false;
  }

  setVoiceByName(name) {
    this._voiceId = name;
    localStorage.setItem('tts_voice', name);
    return true;
  }

  get voice() {
    return EDGE_VOICES.find(v => v.name === this._voiceId) || EDGE_VOICES[0];
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
    // edge-tts sinh lai theo rate moi -> phat tu dau
    if (this._isSpeaking || this._isPaused) {
      const curPct = this._progressPct * 100;
      this.speak(this._fullText);
      // gan sau khi co audio moi (gan cờ để seek)
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
