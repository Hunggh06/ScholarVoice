/**
 * App - Entry point chính
 * Kết nối tất cả modules: PDFViewer, AIEngine, TTSEngine, ChatManager
 */
import { PDFViewer } from './pdf-viewer.js';
import { AIEngine } from './ai-engine.js';
import { TTSEngine } from './tts-engine.js';
import { ChatManager } from './chat.js';

class App {
  constructor() {
    this.pdfViewer = new PDFViewer();
    this.aiEngine = new AIEngine();
    this.ttsEngine = new TTSEngine();
    this.chatManager = new ChatManager();

    this.isProcessing = false;
    this.currentVoiceText = '';
    this.currentSegments = null;
    this.autoRead = false;
    this._prefetchRunning = false;
    this._prefetchTimer = null;
    this._pendingPages = new Set();
  }

  /** Khởi tạo ứng dụng */
  init() {
    this._setupUpload();
    this._setupNavigation();
    this._setupVoiceControls();
    this._setupChat();
    this._setupTTSCallbacks();
    this._setupKeyboardShortcuts();
    this._setupClearCacheBtn();
    this._setupSettingsBtn();
    this._setupSpeedControl();
    this._setupVoiceSelect();
    this._setupPanelResize();
    this._setupAutoReadToggle();
    this._setupSeekBar();
    this._setupTeachingStyle();
    this._setupDebugPanel();
    this._setupCacheIO();
    this._setupLanding();
  }

  // ============================================================
  //  LANDING PAGE
  // ============================================================

  _setupLanding() {
    const startBtn = document.getElementById('start-btn');
    const landing = document.getElementById('landing-page');
    const appMain = document.getElementById('app-main');

    if (!startBtn || !landing || !appMain) return;

    startBtn.addEventListener('click', () => {
      landing.classList.add('hidden');
      appMain.classList.remove('hidden');
      document.body.style.overflow = 'hidden';

      if (!this.aiEngine.hasApiKey) {
        setTimeout(() => this._showApiKeyModal(), 500);
      }
    });
  }

  // ============================================================
  //  AUTO-READ TOGGLE
  // ============================================================

  _setupAutoReadToggle() {
    const toggle = document.getElementById('auto-read-toggle');
    if (!toggle) return;

    const saved = localStorage.getItem('auto_read');
    this.autoRead = saved === 'true';
    toggle.checked = this.autoRead;

    toggle.addEventListener('change', () => {
      this.autoRead = toggle.checked;
      localStorage.setItem('auto_read', toggle.checked);
    });
  }

  // ============================================================
  //  SEEK BAR
  // ============================================================

  _setupSeekBar() {
    const slider = document.getElementById('seek-slider');
    if (!slider) return;

    this._seekDragging = false;
    this._seekSlider = slider;

    slider.addEventListener('input', () => {
      this._seekDragging = true;
      const pct = parseInt(slider.value);
      document.getElementById('seek-time').textContent = this._formatTime(pct / 100);
    });

    slider.addEventListener('change', () => {
      this._seekDragging = false;
      const pct = parseInt(slider.value);
      this.ttsEngine.seekTo(pct);
    });
  }

  _updateSeekSlider(enabled) {
    const slider = document.getElementById('seek-slider');
    if (!slider) return;
    slider.disabled = !enabled;
    if (!enabled) {
      slider.value = 0;
      document.getElementById('seek-time').textContent = '00:00';
    }
  }

  _updateSeekProgress(pct) {
    if (this._seekDragging) return;
    const slider = document.getElementById('seek-slider');
    if (!slider) return;
    slider.value = Math.round(pct * 100);
    document.getElementById('seek-time').textContent = this._formatTime(pct);
  }

  _formatTime(pct) {
    const totalSec = this.ttsEngine.totalChunks > 0 ? this.ttsEngine.totalChunks * 8 : 0;
    const sec = Math.round(totalSec * pct);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================
  //  TEACHING STYLE
  // ============================================================

  _setupTeachingStyle() {
    const buttons = document.querySelectorAll('.style-btn');
    if (buttons.length === 0) return;

    const savedStyle = this.aiEngine.teachingStyle || 'medium';

    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === savedStyle);
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.aiEngine.saveSettings({ teachingStyle: btn.dataset.style });
        this.aiEngine.clearCache();
        this._showToast(`Chế độ: ${btn.textContent.trim()}`, 'info');
      });
    });

    const customInput = document.getElementById('custom-style-input');
    if (customInput) {
      customInput.value = this.aiEngine.customStyle || '';
      customInput.addEventListener('input', () => {
        this.aiEngine.saveSettings({ customStyle: customInput.value });
      });
    }
  }

  _setupPanelResize() {
    const divider = document.getElementById('panel-divider');
    const pdfPanel = document.getElementById('pdf-panel');
    const rightPanel = document.getElementById('right-panel');
    const main = document.getElementById('app-main');

    const savedRatio = localStorage.getItem('panel_ratio');
    if (savedRatio) {
      const ratio = parseFloat(savedRatio);
      pdfPanel.style.width = `${ratio}%`;
      rightPanel.style.width = `${100 - ratio}%`;
    }

    let isDragging = false;

    divider.addEventListener('mousedown', (e) => {
      isDragging = true;
      divider.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const mainRect = main.getBoundingClientRect();
      const x = e.clientX - mainRect.left;
      const totalWidth = mainRect.width;

      let ratio = (x / totalWidth) * 100;
      ratio = Math.max(25, Math.min(80, ratio));

      pdfPanel.style.width = `${ratio}%`;
      rightPanel.style.width = `${100 - ratio}%`;
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const ratio = (pdfPanel.offsetWidth / main.offsetWidth) * 100;
      localStorage.setItem('panel_ratio', ratio.toFixed(1));

      if (this.pdfViewer?.isLoaded) {
        this.pdfViewer.renderPage(this.pdfViewer.currentPage);
      }
    });
  }

  // ============================================================
  //  SPEED CONTROL
  // ============================================================

  _setupSpeedControl() {
    const slider = document.getElementById('speed-slider');
    const label = document.getElementById('speed-label');
    if (!slider || !label) return;

    const savedRate = localStorage.getItem('tts_rate') || '1.0';
    slider.value = savedRate;
    label.textContent = `${parseFloat(savedRate).toFixed(1)}x`;
    this.ttsEngine.rate = parseFloat(savedRate);

    slider.addEventListener('input', () => {
      const rate = parseFloat(slider.value);
      label.textContent = `${rate.toFixed(1)}x`;
    });

    slider.addEventListener('change', () => {
      const rate = parseFloat(slider.value);
      this.ttsEngine.rate = rate;
    });
  }

  // ============================================================
  //  VOICE SELECTION
  // ============================================================

  _setupVoiceSelect() {
    const sel = document.getElementById('voice-select');
    if (!sel) return;

    const populate = () => {
      const voices = this.ttsEngine.getAllVoices();
      const current = sel.value;
      sel.innerHTML = '';

      const groups = {};
      for (const v of voices) {
        const lang = v.lang || 'unknown';
        if (!groups[lang]) groups[lang] = [];
        groups[lang].push(v);
      }

      const sortedLangs = Object.keys(groups).sort();
      for (const lang of sortedLangs) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = lang;
        const items = groups[lang];
        for (const v of items) {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = v.name.replace(/(Microsoft|Online|Natural|Windows|Mozilla|Google|Apple)\s*/g, '').trim() || v.name;
          if (v.name === this.ttsEngine._voiceName) opt.selected = true;
          optgroup.appendChild(opt);
        }
        sel.appendChild(optgroup);
      }

      if (!sel.value && voices.length > 0) {
        sel.value = voices[0].name;
        this.ttsEngine.setVoiceByName(voices[0].name);
      }
    };

    sel.addEventListener('change', () => {
      this.ttsEngine.setVoiceByName(sel.value);
    });

    this.ttsEngine.synth.addEventListener('voiceschanged', () => populate());
    // Retry populate if voices load async
    setTimeout(() => { if (sel.options.length === 0) populate(); }, 500);
    populate();
  }

  // ============================================================
  //  SETTINGS MODAL
  // ============================================================

  _showApiKeyModal() {
    const modal = document.getElementById('api-modal');
    modal.classList.remove('hidden');

    const s = this.aiEngine.getSettings();
    document.getElementById('ai-provider').value = s.provider;
    document.getElementById('api-key-input').value = s.apiKey;
    document.getElementById('gemini-model').value = s.geminiModel;
    document.getElementById('nvidia-key-input').value = s.nvidiaKey;
    document.getElementById('nvidia-model').value = s.nvidiaModel;
    document.getElementById('nvidia-vision').checked = s.nvidiaVision || false;
    document.getElementById('cf-account-id').value = s.cfAccountId || '';
    document.getElementById('cf-api-token').value = s.cfApiToken || '';
    document.getElementById('cf-model').value = s.cfModel;
    document.getElementById('openrouter-key-input').value = s.openrouterKey || '';
    document.getElementById('openrouter-model').value = s.openrouterModel;
    document.getElementById('openrouter-vision').checked = s.openrouterVision || true;
    document.getElementById('ollama-model').value = s.ollamaModel;
    document.getElementById('ollama-url').value = s.ollamaUrl;
    document.getElementById('ollama-vision').checked = s.ollamaVision;

    this._toggleProviderUI(s.provider);
  }

  _hideApiKeyModal() {
    document.getElementById('api-modal').classList.add('hidden');
  }

  _toggleProviderUI(provider) {
    document.getElementById('gemini-settings').classList.toggle('hidden', provider !== 'gemini');
    document.getElementById('nvidia-settings').classList.toggle('hidden', provider !== 'nvidia');
    document.getElementById('openrouter-settings').classList.toggle('hidden', provider !== 'openrouter');
    document.getElementById('cloudflare-settings').classList.toggle('hidden', provider !== 'cloudflare');
    document.getElementById('ollama-settings').classList.toggle('hidden', provider !== 'ollama');
  }

  _setupClearCacheBtn() {
    document.getElementById('clear-cache-btn').addEventListener('click', () => {
      if (!this.pdfViewer.isLoaded) {
        this._showToast('Chưa tải PDF', 'error');
        return;
      }
      this.aiEngine.abort();
      this.isProcessing = false;
      clearTimeout(this._prefetchTimer);
      this._prefetchRunning = false;
      this._pendingPages.clear();
      this.ttsEngine.stop();
      this.currentVoiceText = '';
      this.currentSegments = null;
      this.pdfViewer.clearHighlight();
      this.aiEngine.clearCache();
      this._updatePageCacheBar();
      this._updateVoiceStatus('idle', 'Đã xoá cache, nhấn 🎓 Đọc để giảng lại');
      this._updatePlayPauseBtn(false);
      this._updateSeekSlider(false);
      this._showToast('Đã xoá toàn bộ cache', 'success');
    });
  }

  _setupSettingsBtn() {
    document.getElementById('settings-btn').addEventListener('click', () => {
      this._showApiKeyModal();
    });

    document.getElementById('ai-provider').addEventListener('change', (e) => {
      this._toggleProviderUI(e.target.value);
    });

    document.getElementById('save-api-key').addEventListener('click', () => {
      const provider = document.getElementById('ai-provider').value;

      this.aiEngine.saveSettings({
        provider,
        apiKey: document.getElementById('api-key-input').value,
        geminiModel: document.getElementById('gemini-model').value,
        nvidiaKey: document.getElementById('nvidia-key-input').value,
        nvidiaModel: document.getElementById('nvidia-model').value,
        nvidiaVision: document.getElementById('nvidia-vision').checked,
        cfAccountId: document.getElementById('cf-account-id').value,
        cfApiToken: document.getElementById('cf-api-token').value,
        cfModel: document.getElementById('cf-model').value,
        openrouterKey: document.getElementById('openrouter-key-input').value,
        openrouterModel: document.getElementById('openrouter-model').value,
        openrouterVision: document.getElementById('openrouter-vision').checked,
        ollamaModel: document.getElementById('ollama-model').value,
        ollamaUrl: document.getElementById('ollama-url').value,
        ollamaVision: document.getElementById('ollama-vision').checked,
      });
      this.aiEngine.clearCache();

      this._hideApiKeyModal();
      const labels = {
        gemini: 'Gemini API',
        nvidia: `NVIDIA (${this.aiEngine.nvidiaModel})`,
        openrouter: `OpenRouter (${this.aiEngine.openrouterModel})`,
        cloudflare: `Cloudflare (${this.aiEngine.cfModel})`,
        ollama: `Ollama (${this.aiEngine.ollamaModel})`
      };
      this._showToast(`Đã lưu: ${labels[provider]}`, 'success');
    });

    document.getElementById('api-key-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('save-api-key').click();
    });

    document.getElementById('close-modal')?.addEventListener('click', () => {
      this._hideApiKeyModal();
    });
  }

  // ============================================================
  //  PDF UPLOAD
  // ============================================================

  _setupUpload() {
    const uploadArea = document.getElementById('upload-area');
    const pdfInput = document.getElementById('pdf-input');

    uploadArea.addEventListener('click', () => {
      pdfInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        this._loadPDFFile(file);
      } else {
        this._showToast('Vui lòng chọn file PDF', 'error');
      }
    });

    pdfInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this._loadPDFFile(file);
      }
    });
  }

  async _loadPDFFile(file) {
    try {
      this._updateVoiceStatus('loading', 'Đang tải PDF...');
      this._pdfFileName = file.name;

      const totalPages = await this.pdfViewer.loadPDF(file);

      document.getElementById('upload-area').classList.add('hidden');
      document.getElementById('pdf-viewer').classList.remove('hidden');
      document.getElementById('export-cache-btn').disabled = false;

      this._updatePageInfo();
      this._updatePageCacheBar();

      this.chatManager.setEnabled(true);

      // Tự động khôi phục cache nếu đã lưu trước đó
      const restored = this._autoRestoreCache(file.name);
      const msg = restored
        ? `Đã tải PDF: ${totalPages} trang (cache đã khôi phục)`
        : `Đã tải PDF: ${totalPages} trang`;
      this._showToast(msg, 'success');

      this._updateVoiceStatus('idle', 'Sẵn sàng. Nhấn "🎓 Đọc" để nghe giảng.');

    } catch (err) {
      console.error('Lỗi tải PDF:', err);
      this._showToast('Không thể đọc file PDF. Vui lòng thử file khác.', 'error');
      this._updateVoiceStatus('idle', 'Lỗi tải PDF');
    }
  }

  // ============================================================
  //  PAGE NAVIGATION
  // ============================================================

  _setupNavigation() {
    document.getElementById('prev-page').addEventListener('click', () => {
      this._navigatePage('prev');
    });

    document.getElementById('next-page').addEventListener('click', () => {
      this._navigatePage('next');
    });

    document.getElementById('teach-now').addEventListener('click', () => {
      this._teachCurrentPage();
    });

    document.getElementById('teach-now').addEventListener('dblclick', (e) => {
      if (this.pdfViewer.isLoaded) {
        this._forceTeachCurrentPage();
      }
    });

    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    const zoomReset = document.getElementById('zoom-reset');
    if (zoomIn && zoomOut && zoomReset) {
      zoomIn.addEventListener('click', () => {
        this.pdfViewer.zoomIn();
        this._updateZoomDisplay();
      });
      zoomOut.addEventListener('click', () => {
        this.pdfViewer.zoomOut();
        this._updateZoomDisplay();
      });
      zoomReset.addEventListener('click', () => {
        this.pdfViewer.resetZoom();
        this._updateZoomDisplay();
      });
    }
  }

  _updateZoomDisplay() {
    const el = document.getElementById('zoom-level');
    if (el) {
      const pct = Math.round(this.pdfViewer.zoom * 100);
      el.textContent = pct + '%';
    }
  }

  /**
   * Buộc đọc trang đang xem ngay lập tức
   */
  async _forceTeachCurrentPage() {
    if (!this.pdfViewer.isLoaded) return;

    if (this.isProcessing) {
      this.aiEngine.abort();
      this.isProcessing = false;
    }
    this.ttsEngine.stop();
    this.currentSegments = null;
    this.pdfViewer.clearHighlight();

    const cp = this.pdfViewer.currentPage;
    this._pendingPages.delete(cp);
    const cacheKey = `page_${cp}_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`;
    this.aiEngine.pageCache.delete(cacheKey);

    await this._teachCurrentPage();
  }

  _getCurrentSegment(pct) {
    if (!this.currentSegments || this.currentSegments.length === 0) return null;
    const totalLen = this.currentSegments.reduce((sum, s) => sum + s.text.length, 0);
    if (totalLen === 0) return this.currentSegments[0];
    let accumulated = 0;
    for (const seg of this.currentSegments) {
      const segRatio = seg.text.length / totalLen;
      if (pct >= accumulated && pct < accumulated + segRatio) return seg;
      accumulated += segRatio;
    }
    return this.currentSegments[this.currentSegments.length - 1];
  }

  async _navigatePage(direction) {
    if (!this.pdfViewer.isLoaded) return;

    this.aiEngine.abort();
    this.isProcessing = false;

    this.ttsEngine.stop();
    this.currentSegments = null;
    this.pdfViewer.clearHighlight();

    const success = direction === 'next'
      ? await this.pdfViewer.nextPage()
      : await this.pdfViewer.prevPage();

    if (success) {
      this._updatePageInfo();
      this._updatePageCacheBar();

      if (this.autoRead) {
        await this._teachCurrentPage();
      } else {
        this._updateVoiceStatus('idle', 'Sẵn sàng. Nhấn "🎓 Đọc" để nghe giảng.');
      }
    }
  }

  _updatePageInfo() {
    const { currentPage, totalPages } = this.pdfViewer;
    document.getElementById('page-info').textContent = `${currentPage} / ${totalPages}`;

    document.getElementById('prev-page').disabled = currentPage <= 1;
    document.getElementById('next-page').disabled = currentPage >= totalPages;
    document.getElementById('teach-now').disabled = false;
    this._updateZoomDisplay();
  }

  // ============================================================
  //  AI TEACHING (Voice only)
  // ============================================================

  async _teachCurrentPage() {
    if (!this.aiEngine.isConfigured) {
      this._showApiKeyModal();
      return;
    }

    const targetPage = this.pdfViewer.currentPage;

    const entry = this.aiEngine._getPageCache(targetPage);
    if (entry) {
      if (this.pdfViewer.currentPage !== targetPage) return;

      this.currentVoiceText = entry.voice_text;
      this.currentSegments = entry.segments || null;
      this.ttsEngine.speak(entry.voice_text);
      this._setVoiceButtonsEnabled(true);
      this._updateVoiceStatus('speaking', 'Đang giảng bài...');
      this._autoPrefetch();
      return;
    }

    if (this._pendingPages.has(targetPage)) {
      this.aiEngine.abort();
    }
    this._pendingPages.add(targetPage);
    this.aiEngine.abort();
    this.isProcessing = true;
    this._setVoiceButtonsEnabled(false);
    this._updateVoiceStatus('analyzing', 'Đang phân tích trang...');
    document.getElementById('btn-retry').classList.add('hidden');

    try {
      const imageBase64 = this.pdfViewer.getPageImageBase64();
      const pageText = await this.pdfViewer.getPageText();
      const result = await this.aiEngine.teachPage(imageBase64, targetPage, pageText);

      if (this.pdfViewer.currentPage !== targetPage) {
        return;
      }

      this.currentVoiceText = result.voice_text;
      this.currentSegments = result.segments || null;

      this.ttsEngine.speak(result.voice_text);
      this._setVoiceButtonsEnabled(true);
      this._autoPrefetch();

    } catch (err) {
      if (err.message === 'Đã hủy yêu cầu.') return;

      if (this.pdfViewer.currentPage !== targetPage) return;

      console.error('Lỗi AI:', err);
      this._updateVoiceStatus('error', err.message);
      this._showToast('Lỗi. Nhấn 🔁 để thử lại', 'error');

      document.getElementById('btn-retry').classList.remove('hidden');
    } finally {
      this._pendingPages.delete(targetPage);
      if (this.pdfViewer.currentPage === targetPage) {
        this.isProcessing = false;
      }
    }
  }

  /**
   * Pre-fetch dần dần các trang phía sau, mỗi lần 1 trang
   * Dừng khi gặp trang đã có cache hoặc hết file
   */
  async _prefetchNextPages() {
    const current = this.pdfViewer.currentPage;
    const total = this.pdfViewer.totalPages;
    const hasVision = this.aiEngine.hasVision();

    for (let pageNum = current + 1; pageNum <= total; pageNum++) {
      const cacheKey = `page_${pageNum}_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`;
      if (this.aiEngine.pageCache.has(cacheKey)) continue;
      if (this._pendingPages.has(pageNum)) continue;

      this._pendingPages.add(pageNum);
      try {
        console.log(`[Prefetch] Đang đọc ngầm trang ${pageNum}...`);
        const pageText = await this.pdfViewer.getTextForPage(pageNum);
        let imageBase64 = null;
        if (hasVision) {
          imageBase64 = await this.pdfViewer.getPageImageForPage(pageNum);
        }
        await this.aiEngine.teachPage(imageBase64, pageNum, pageText);
        console.log(`[Prefetch] Đã cache trang ${pageNum}`);
        break;
      } catch (err) {
        console.log(`[Prefetch] Trang ${pageNum} thất bại:`, err.message);
        break;
      } finally {
        this._pendingPages.delete(pageNum);
      }
    }
  }

  _autoPrefetch(delay = 1500) {
    clearTimeout(this._prefetchTimer);
    const anchorPage = this.pdfViewer.currentPage;
    this._prefetchTimer = setTimeout(() => {
      if (this._prefetchRunning) return;
      if (this.pdfViewer.currentPage !== anchorPage) return;

      this._prefetchRunning = true;
      this._prefetchNextPages()
        .finally(() => {
          this._prefetchRunning = false;
          this._updatePageCacheBar();
          if (this.pdfViewer.currentPage === anchorPage) {
            this._autoPrefetch(2000);
          }
        });
    }, delay);
  }

  /**
   * Cập nhật thanh trạng thái cache (trang nào đã có âm thanh)
   */
  _updatePageCacheBar() {
    const bar = document.getElementById('page-cache-bar');
    if (!bar || !this.pdfViewer.isLoaded) return;

    const total = this.pdfViewer.totalPages;
    const current = this.pdfViewer.currentPage;
    bar.innerHTML = '';

    for (let p = 1; p <= total; p++) {
      const dot = document.createElement('span');
      dot.className = 'cache-dot';
      const cacheKey = `page_${p}_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`;
      if (this.aiEngine.pageCache.has(cacheKey)) {
        dot.classList.add('cached');
      }
      if (p === current) {
        dot.classList.add('current');
      }
      dot.title = p === current
        ? `Trang ${p} (đang xem)`
        : this.aiEngine.pageCache.has(cacheKey)
          ? `Trang ${p} - Đã có âm thanh`
          : `Trang ${p} - Chưa có âm thanh`;
      dot.addEventListener('click', () => {
        this.pdfViewer.renderPage(p);
        this._updatePageInfo();
        this._updatePageCacheBar();
        this.ttsEngine.stop();
        this.currentSegments = null;
        this.pdfViewer.clearHighlight();
        this._updateVoiceStatus('idle', 'Sẵn sàng. Nhấn "🎓 Đọc" để nghe giảng.');
        this._updatePlayPauseBtn(false);
        this._updateSeekSlider(false);
      });
      bar.appendChild(dot);
    }

    // Auto scroll to current page dot
    if (bar.children[current - 1]) {
      bar.children[current - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  // ============================================================
  //  VOICE CONTROLS
  // ============================================================

  _setupVoiceControls() {
    document.getElementById('btn-play-pause').addEventListener('click', () => {
      if (this.ttsEngine.isSpeaking && !this.ttsEngine.isPaused) {
        this.ttsEngine.pause();
      } else if (this.ttsEngine.isPaused) {
        this.ttsEngine.resume();
      } else if (this.currentVoiceText) {
        this.ttsEngine.speak(this.currentVoiceText);
      }
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
      this.ttsEngine.stop();
      this.currentSegments = null;
      this.pdfViewer.clearHighlight();
      this._updateVoiceStatus('stopped', 'Đã dừng');
      this._updatePlayPauseBtn(false);
      this._updateSeekSlider(false);
    });



    document.getElementById('btn-retry').addEventListener('click', () => {
      document.getElementById('btn-retry').classList.add('hidden');
      this.currentSegments = null;
      this.pdfViewer.clearHighlight();
      this._teachCurrentPage();
    });
  }

  _setupTTSCallbacks() {
    this.ttsEngine.onStart = () => {
      this._updateVoiceStatus('speaking', 'Đang giảng bài...');
      this._updatePlayPauseBtn(true);
      this._updateSeekSlider(true);
      const totalSec = this.ttsEngine.totalChunks * 8;
      document.getElementById('seek-duration').textContent = this._formatTime(1);
      document.getElementById('seek-slider').max = 100;
    };

    this.ttsEngine.onEnd = () => {
      this._updateVoiceStatus('done', `Đã giảng xong trang ${this.pdfViewer.currentPage}`);
      this._updatePlayPauseBtn(false);
      this._updateSeekSlider(false);
      this.currentSegments = null;
      this.pdfViewer.clearHighlight();
    };

    this.ttsEngine.onPause = () => {
      this._updateVoiceStatus('paused', 'Đã tạm dừng');
      this._updatePlayPauseBtn(false);
    };

    this.ttsEngine.onResume = () => {
      this._updateVoiceStatus('speaking', 'Đang giảng bài...');
      this._updatePlayPauseBtn(true);
    };

    this.ttsEngine.onError = (err) => {
      this._updateVoiceStatus('error', err.message);
      this._updateSeekSlider(false);
      this.currentSegments = null;
      this.pdfViewer.clearHighlight();
    };

    this.ttsEngine.onProgress = (pct) => {
      this._updateSeekProgress(pct);
      if (this.currentSegments && this.currentSegments.length > 0) {
        const seg = this._getCurrentSegment(pct);
        if (seg) this.pdfViewer.setHighlightRegion(seg.regionVert);
      }
    };
  }

  _setVoiceButtonsEnabled(enabled) {
    document.getElementById('btn-play-pause').disabled = !enabled;
    document.getElementById('btn-stop').disabled = !enabled;
  }

  _updatePlayPauseBtn(isPlaying) {
    const btn = document.getElementById('btn-play-pause');
    btn.textContent = isPlaying ? '⏸' : '▶';
    btn.title = isPlaying ? 'Tạm dừng' : 'Phát';
    btn.classList.toggle('active', isPlaying);
  }

  _updateVoiceStatus(state, text) {
    const iconEl = document.getElementById('voice-icon');
    const textEl = document.getElementById('voice-text');
    const waveformEl = document.getElementById('waveform');

    textEl.textContent = text;

    textEl.classList.remove('active');
    if (waveformEl) waveformEl.classList.add('hidden');

    switch (state) {
      case 'idle':
        iconEl.textContent = '🔇';
        break;
      case 'loading':
        iconEl.textContent = '📂';
        break;
      case 'analyzing':
        iconEl.textContent = '🤔';
        textEl.classList.add('active');
        break;
      case 'speaking':
        iconEl.textContent = '🔊';
        textEl.classList.add('active');
        if (waveformEl) waveformEl.classList.remove('hidden');
        break;
      case 'paused':
        iconEl.textContent = '⏸️';
        break;
      case 'done':
        iconEl.textContent = '✅';
        break;
      case 'stopped':
        iconEl.textContent = '⏹️';
        break;
      case 'error':
        iconEl.textContent = '❌';
        break;
    }
  }

  // ============================================================
  //  CHAT
  // ============================================================

  _setupChat() {
    this.chatManager.onSend = async (text) => {
      await this._handleChatMessage(text);
    };
  }

  async _handleChatMessage(question) {
    if (!this.pdfViewer.isLoaded) {
      this._showToast('Vui lòng tải file PDF trước', 'error');
      return;
    }

    if (!this.aiEngine.hasApiKey) {
      this._showApiKeyModal();
      return;
    }

    this.chatManager.addUserMessage(question);

    this.ttsEngine.stop();
    this._updateVoiceStatus('analyzing', 'Đang suy nghĩ...');

    this.chatManager.showLoading();
    this.chatManager.setEnabled(false);

    try {
      const imageBase64 = this.pdfViewer.getPageImageBase64();
      const pageText = await this.pdfViewer.getPageText();

      const result = await this.aiEngine.askQuestion(question, imageBase64, pageText);

      this.chatManager.hideLoading();

      this.chatManager.addAIMessage(result.display_text);

      if (result.voice_text && result.voice_text.trim().length > 0) {
        this.currentVoiceText = result.voice_text;
        this.ttsEngine.speak(result.voice_text);
        this._setVoiceButtonsEnabled(true);
      } else {
        this._updateVoiceStatus('done', 'Đã trả lời xong (không có giọng đọc)');
      }

    } catch (err) {
      this.chatManager.hideLoading();

      if (err.message === 'Đã hủy yêu cầu.') return;

      console.error('Lỗi chat:', err);
      this.chatManager.addErrorMessage(err.message);
      this._updateVoiceStatus('error', 'Lỗi: ' + err.message);
    } finally {
      this.chatManager.setEnabled(true);
    }
  }

  // ============================================================
  //  KEYBOARD SHORTCUTS
  // ============================================================

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this._navigatePage('prev');
          break;
        case 'ArrowRight':
          e.preventDefault();
          this._navigatePage('next');
          break;
        case ' ':
          e.preventDefault();
          document.getElementById('btn-play-pause').click();
          break;
      }
    });
  }

  // ============================================================
  //  CACHE IMPORT/EXPORT
  // ============================================================

  _setupCacheIO() {
    const exportBtn = document.getElementById('export-cache-btn');
    const importBtn = document.getElementById('import-cache-btn');
    const fileInput = document.getElementById('cache-file-input');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => this._exportCache());
    }
    if (importBtn) {
      importBtn.addEventListener('click', () => fileInput.click());
    }
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this._importCache(file);
        fileInput.value = '';
      });
    }
  }

  _exportCache() {
    if (!this.pdfViewer.isLoaded || !this._pdfFileName) {
      this._showToast('Chưa tải PDF', 'error');
      return;
    }

    const data = {
      version: 1,
      filename: this._pdfFileName,
      provider: this.aiEngine.provider,
      style: this.aiEngine.teachingStyle,
      customStyle: this.aiEngine.customStyle || '',
      totalPages: this.pdfViewer.totalPages,
      exportedAt: new Date().toISOString(),
      context: this.aiEngine.docContext,
      pages: {}
    };

    for (const [key, text] of this.aiEngine.pageCache.entries()) {
      if (key.includes(`_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`)) {
        const pageMatch = key.match(/^page_(\d+)_/);
        if (pageMatch) {
          data.pages[pageMatch[1]] = text;
        }
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._pdfFileName.replace(/\.pdf$/i, '') + '.cache.json';
    a.click();
    URL.revokeObjectURL(url);

    const count = Object.keys(data.pages).length;
    this._showToast(`Đã lưu ${count}/${this.pdfViewer.totalPages} trang`, 'success');

    // Also save to localStorage for auto-restore
    try {
      localStorage.setItem('cache_' + this._pdfFileName, JSON.stringify(data));
    } catch (e) {
      // Quota exceeded - skip localStorage
    }
  }

  async _importCache(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.pages || !data.filename) {
        throw new Error('File cache không hợp lệ');
      }

      // If PDF is loaded and filename matches, restore immediately
      if (this._pdfFileName && this._pdfFileName === data.filename && this.pdfViewer.isLoaded) {
        this.aiEngine.pageCache.clear();
        this.aiEngine.docContext = data.context || [];

        for (const [pageNum, voiceText] of Object.entries(data.pages)) {
          const key = `page_${pageNum}_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`;
          this.aiEngine.pageCache.set(key, voiceText);
        }

        this._updatePageCacheBar();
        this._showToast(`Đã tải cache: ${Object.keys(data.pages).length} trang`, 'success');

        // Save for later
        try {
          localStorage.setItem('cache_' + data.filename, JSON.stringify(data));
        } catch (e) {}
      } else {
        // Store for when the matching PDF is loaded
        try {
          localStorage.setItem('cache_' + data.filename, JSON.stringify(data));
          this._showToast(`Đã lưu cache cho "${data.filename}". Sẽ tự động áp dụng khi mở PDF.`, 'success');
        } catch (e) {
          this._showToast('Không thể lưu cache: bộ nhớ đầy', 'error');
        }
      }
    } catch (e) {
      this._showToast('File cache không hợp lệ: ' + e.message, 'error');
    }
  }

  /** Tự động khôi phục cache từ localStorage khi mở PDF */
  _autoRestoreCache(filename) {
    try {
      const saved = localStorage.getItem('cache_' + filename);
      if (!saved) return false;

      const data = JSON.parse(saved);
      if (!data.pages || data.provider !== this.aiEngine.provider) return false;

      this.aiEngine.pageCache.clear();
      this.aiEngine.docContext = data.context || [];

      let count = 0;
      for (const [pageNum, voiceText] of Object.entries(data.pages)) {
        const key = `page_${pageNum}_${this.aiEngine.provider}_${this.aiEngine.teachingStyle}`;
        this.aiEngine.pageCache.set(key, voiceText);
        count++;
      }

      this._updatePageCacheBar();
      this._showToast(`Đã khôi phục cache: ${count} trang`, 'success');
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  //  DEBUG PANEL
  // ============================================================

  _setupDebugPanel() {
    const toggle = document.getElementById('debug-toggle');
    const log = document.getElementById('debug-log');
    if (!toggle || !log) return;

    this._debugEntries = [];

    toggle.addEventListener('click', () => {
      log.classList.toggle('hidden');
    });

    this.aiEngine.onDebug = (entry) => {
      this._debugEntries.push(entry);
      if (this._debugEntries.length > 50) this._debugEntries.shift();
      this._renderDebugLog(log);
    };
  }

  _renderDebugLog(logEl) {
    let html = '';
    for (let i = this._debugEntries.length - 1; i >= 0; i--) {
      const e = this._debugEntries[i];
      const time = new Date(e.time).toLocaleTimeString('vi');
      if (e.type === 'request') {
        html += `<div class="debug-entry">
          <span class="debug-time">${time}</span>
          <span class="debug-label">📤 ${e.provider}/${e.model}</span>
          <span class="debug-content">vision=${e.vision} img=${e.hasImage} json=${e.jsonMode}</span>
          <div class="debug-content">${this._escapeHtml(e.promptPreview || '')}...</div>
        </div>`;
      } else if (e.type === 'response') {
        html += `<div class="debug-entry">
          <span class="debug-time">${time}</span>
          <span class="debug-label">📥 ${e.provider}/${e.model}</span>
          <span class="debug-content">${e.duration} | ${e.length} chars</span>
          <div class="debug-response">${this._escapeHtml(e.preview || '')}...</div>
        </div>`;
      } else if (e.type === 'error') {
        html += `<div class="debug-entry">
          <span class="debug-time">${time}</span>
          <span class="debug-label">❌ ${e.provider}/${e.model}</span>
          <span class="debug-content">${e.duration}</span>
          <div class="debug-error">${this._escapeHtml(e.message || '')}</div>
        </div>`;
      }
    }
    logEl.innerHTML = html || '<span class="debug-content">Chưa có request nào.</span>';
    logEl.scrollTop = 0;
  }

  _escapeHtml(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  //  TOAST NOTIFICATION
  // ============================================================

  _showToast(message, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 3500);
    }
  }

  // ============================================================
  //  KHỞI TẠO
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
  });
