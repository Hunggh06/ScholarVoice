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

    this._sequenceActive = false;
    this._currentChunkIndex = 0;
    this._pauseRequested = false;
    this._resumePos = 0;
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

  _killCurrent() {
    this._cleanup();
    this._synth.cancel();
  }

  async speak(text, { keepFullText = false, seekOffsetPct = 0 } = {}) {
    // When seeking, seekTo already cleaned up — don't fire onProgress(0)
    if (keepFullText) {
      this._killCurrent();
    } else {
      this.stop();
    }

    if (!text || !text.trim()) return;
    this._currentText = text;

    if (keepFullText) {
      this._seekOffsetPct = seekOffsetPct;
    } else {
      this._fullText = text;
      this._seekOffsetPct = 0;
    }

    this._progressPct = this._seekOffsetPct;
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
    this._lastCharIndex = 0;
    this._lastBoundaryTime = performance.now();

    this._utterance.onboundary = (e) => {
      this._lastCharIndex = e.charIndex;
      this._lastBoundaryTime = performance.now();
      this._updateProgress(e.charIndex / this._currentText.length);
    };

    this._utterance.onstart = () => {
      this._isSpeaking = true;
      this._isPaused = false;
      this._lastBoundaryTime = performance.now();
      if (this.onStart) this.onStart();
      this._startProgress();
    };
    this._utterance.onend = () => {
      const wasPaused = this._isPaused;
      this._cleanup(wasPaused);
      if (wasPaused) return;
      const finalPct = this._seekOffsetPct > 0
        ? this._seekOffsetPct + (1 - this._seekOffsetPct)
        : 1;
      if (this.onProgress) this.onProgress(Math.min(finalPct, 1));
      if (this.onEnd) this.onEnd();
    };
    this._utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') { this._cleanup(this._isPaused); return; }
      this._cleanup();
      if (this.onError) this.onError(new Error(e.error));
    };

    this._synth.speak(this._utterance);
  }

  _speakChunk(text, chunkIndex, totalChunks, onChunkProgress) {
    return new Promise((resolve, reject) => {
      if (!text || !text.trim()) return resolve();

      let replayFrom = 0;
      let lastChunkChar = 0;

      const playOnce = (from) => new Promise((done) => {
        const speechText = from > 0 ? text.slice(from) : text;
        const utterance = new SpeechSynthesisUtterance(speechText);
        utterance.rate = this._rate;
        const voices = this._synth.getVoices();
        if (this._voiceURI) {
          const v = voices.find(v => v.voiceURI === this._voiceURI);
          if (v) utterance.voice = v;
        } else if (this._voiceId) {
          const v = voices.find(v => (v.lang + ' - ' + v.name) === this._voiceId);
          if (v) utterance.voice = v;
        }

        const chunkStart = performance.now();
        let lastChunkBoundaryAt = performance.now();
        const baseChar = from;
        const emitProgress = () => {
          if (!onChunkProgress) return;
          let localPct;
          if (lastChunkChar > 0) {
            // Bám theo boundary THẬT từ TTS — tiến trình đúng tốc độ đọc dù rate cao.
            // (Trước đây ràng buộc baseChar > 0 khiến chunk đọc từ đầu luôn rơi vào
            // nhánh ước lượng đồng hồ → sub lag khi tốc độ cao.)
            const est = lastChunkChar + ((performance.now() - lastChunkBoundaryAt) / 1000) * 10 * this._rate;
            localPct = est / Math.max(1, text.length);
          } else {
            // Chưa có boundary nào (khởi đọc <100ms): fallback ước lượng đồng hồ.
            const origLen = Math.max(1, text.length);
            const elapsed = (performance.now() - chunkStart) / 1000;
            const estDur = Math.max(1, (text.length - baseChar) / (12 * this._rate));
            localPct = (baseChar + (elapsed / estDur) * Math.max(0, text.length - baseChar)) / origLen;
          }
          onChunkProgress(Math.min(0.99, Math.max(0, localPct)));
        };
        const timer = setInterval(emitProgress, 100);

        utterance.onstart = () => { this._isSpeaking = true; this._isPaused = false; };
        utterance.onboundary = (e) => {
          lastChunkChar = baseChar + e.charIndex;
          lastChunkBoundaryAt = performance.now();
          emitProgress();
        };
        utterance.onend = () => {
          clearInterval(timer);
          this._isSpeaking = false;
          this._isPaused = false;
          if (onChunkProgress && chunkIndex != null && totalChunks > 0) {
            onChunkProgress(1);
          }
          done('end');
        };
        utterance.onerror = (e) => {
          clearInterval(timer);
          this._isSpeaking = false;
          if (e.error === 'canceled' || e.error === 'interrupted') {
            done(this._isPaused ? 'paused' : 'canceled');
          } else {
            done('error:' + e.error);
          }
        };
        this._synth.speak(utterance);
      });

      const loop = async () => {
        while (true) {
          const result = await playOnce(replayFrom);
          if (result === 'end' || result.startsWith('error')) { resolve(result); return; }
          if (result === 'canceled') { resolve('canceled'); return; }
          if (!this._isPaused) { resolve('resumed'); return; }
          await new Promise(r => { this._resumeChunkResolve = r; });
          this._isPaused = false;
          if (!this._sequenceActive) { resolve('stopped'); return; }
          replayFrom = Math.min(lastChunkChar, text.length);
        }
      };
      loop();
    });
  }

  async speakSequence(chunks, callbacks = {}) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      if (callbacks.onEnd) callbacks.onEnd();
      return;
    }

    this._sequenceActive = true;
    this._resumeChunkResolve = null;
    this._isPaused = false;
    this._currentChunkIndex = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (!this._sequenceActive) return;
      this._currentChunkIndex = i;
      const chunk = chunks[i];
      if (callbacks.onChunkStart) callbacks.onChunkStart(i, chunk);
      try {
        await this._speakChunk(chunk.text, i, chunks.length, callbacks.onChunkProgress);
      } catch (err) {
        this._sequenceActive = false;
        if (callbacks.onError) callbacks.onError(err);
        return;
      }
      if (!this._sequenceActive) return;
      const shouldContinue = callbacks.onChunkEnd ? callbacks.onChunkEnd(i, chunk) : true;
      if (shouldContinue === false) {
        this._sequenceActive = false;
        return false;
      }
      if (i < chunks.length - 1) {
        await sleep(150);
      }
      if (this._isPaused) {
        this._sequenceActive = false;
        return false;
      }
    }

    this._sequenceActive = false;
    if (callbacks.onEnd) callbacks.onEnd();
  }

  _updateProgress(baseLocalPct = null) {
    if (!this._isSpeaking || this._isPaused) return;

    let localPct = baseLocalPct;

    if (localPct === null) {
      if (this._lastCharIndex > 0) {
        // Interpolate since the last boundary for smoothness
        const elapsedSinceBoundary = (performance.now() - this._lastBoundaryTime) / 1000;
        // Conservative fallback: 10 chars per second
        const estimatedChars = this._lastCharIndex + (elapsedSinceBoundary * 10 * this._rate);
        localPct = estimatedChars / this._currentText.length;
      } else {
        // Pure fallback if no boundary ever fires
        const elapsed = (performance.now() - this._startTime - this._totalPaused) / 1000;
        localPct = elapsed / this._estDuration;
      }
    }

    localPct = Math.min(localPct, 0.99);

    // Prevent backwards jumping in the UI
    if (localPct < this._lastCalculatedLocalPct) {
      localPct = this._lastCalculatedLocalPct;
    } else {
      this._lastCalculatedLocalPct = localPct;
    }

    const absPct = this._seekOffsetPct + localPct * (1 - this._seekOffsetPct);
    this._progressPct = absPct;
    if (this.onProgress) this.onProgress(absPct);
  }

  _startProgress() {
    clearInterval(this._progressTimer);
    this._progressTimer = setInterval(() => {
      this._updateProgress();
    }, 100);
  }

  _cleanup(keepPaused = false) {
    clearInterval(this._progressTimer);
    this._progressTimer = null;
    this._isSpeaking = false;
    if (!keepPaused) this._isPaused = false;
    this._totalPaused = 0;
    this._utterance = null;
    this._lastCharIndex = 0;
    this._lastBoundaryTime = 0;
    this._lastCalculatedLocalPct = 0;
  }

pause() {
    if (this._isPaused) return;
    if (!this._isSpeaking && !this._sequenceActive) return;
    this._pausedAt = performance.now();
    this._isPaused = true;
    this._resumePos = this._progressPct;
    this._synth.cancel();
    if (this.onPause) this.onPause();
  }

  resume() {
    if (!this._isPaused) return;
    this._totalPaused += performance.now() - this._pausedAt;
    this._isPaused = false;
    if (this._resumeChunkResolve) {
      const r = this._resumeChunkResolve;
      this._resumeChunkResolve = null;
      r();
      if (this.onResume) this.onResume();
      return;
    }
    const pos = this._resumePos || 0;
    this._resumePos = 0;
    if (pos > 0 && this._fullText && this._fullText.trim()) {
      const startIdx = Math.floor(pos * this._fullText.length);
      const remaining = this._fullText.slice(startIdx);
      if (remaining.trim()) {
        this.speak(remaining, { keepFullText: true, seekOffsetPct: pos });
        if (this.onResume) this.onResume();
        return;
      }
    }
    if (this.onResume) this.onResume();
  }

  stop() {
    this._sequenceActive = false;
    this._currentChunkIndex = 0;
    if (this._resumeChunkResolve) {
      const r = this._resumeChunkResolve;
      this._resumeChunkResolve = null;
      r();
    }
    this._cleanup();
    this._synth.cancel();
    this._progressPct = 0;
    this._seekOffsetPct = 0;
    if (this.onProgress) this.onProgress(0);
  }

  seekTo(pct) {
    if (!this._fullText) return;

    const pctNorm = Math.max(0, Math.min(100, pct)) / 100;
    const pos = Math.floor(pctNorm * this._fullText.length);
    const remaining = this._fullText.slice(pos);

    if (!remaining.trim()) return;

    const wasActive = this._isSpeaking || this._isPaused;
    this._killCurrent();

    if (wasActive) {
      this.speak(remaining, { keepFullText: true, seekOffsetPct: pctNorm });
    } else {
      // Not playing: just update position, don't auto-play
      this._seekOffsetPct = pctNorm;
      this._progressPct = pctNorm;
      if (this.onProgress) this.onProgress(pctNorm);
    }
  }

  applyRate(newRate) {
    if (this._rate === newRate) return;
    this._rate = newRate;
    localStorage.setItem('tts_rate', String(newRate));
    if (this._isSpeaking || this._isPaused) {
      const curPct = this._progressPct;
      const full = this._fullText;
      this._killCurrent();
      // Start from current position so seeking across rate change works
      const pos = Math.floor(curPct * full.length);
      const remaining = full.slice(pos);
      if (remaining.trim()) {
        this.speak(remaining, { keepFullText: true, seekOffsetPct: curPct });
      }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
