/**
 * FlashcardsManager - Module thẻ học thuật ngữ theo trang
 * Luồng: mở tab → tự sinh thẻ (cache) → lật term/definition → TTS → tự đánh giá ✅ Biết / 🔄 Ôn lại
 * Ôn lại → thẻ quay lại xoay vòng → hết → màn hình hoàn thành
 */
export class FlashcardsManager {
  constructor(app) {
    this.app = app;

    // Tab elements
    this.tabFlash = document.getElementById('tab-flash');
    this.flashArea = document.getElementById('flash-area');

    // Empty state
    this.flashEmpty = document.getElementById('flash-empty');
    this.flashEmptyText = document.getElementById('flash-empty-text');
    this.flashCountSelect = document.getElementById('flash-count');
    this.flashStartBtn = document.getElementById('flash-start-btn');

    // Loading
    this.flashLoading = document.getElementById('flash-loading');

    // Card view
    this.flashCardView = document.getElementById('flash-card-view');
    this.flashProgress = document.getElementById('flash-progress');
    this.flashCard = document.getElementById('flash-card');
    this.flashCardFront = document.getElementById('flash-card-front');
    this.flashCardBack = document.getElementById('flash-card-back');
    this.flashSpeakBtn = document.getElementById('flash-speak-btn');
    this.flashKnowBtn = document.getElementById('flash-know-btn');
    this.flashReviewBtn = document.getElementById('flash-review-btn');

    // Result
    this.flashResult = document.getElementById('flash-result');
    this.flashResultText = document.getElementById('flash-result-text');
    this.flashRetryBtn = document.getElementById('flash-retry-btn');
    this.flashRefreshBtn = document.getElementById('flash-refresh-btn');

    // State
    this.cards = [];
    this.mainQueue = [];
    this.reviewQueue = [];
    this.currentCard = null;
    this.flipped = false;
    this._genSeq = 0;
    this._generating = false;

    this._setupEvents();
  }

  _setupEvents() {
    this.tabFlash.addEventListener('click', () => this.switchTab('flash'));
    this.flashStartBtn.addEventListener('click', () => this._generateForCurrentPage());
    this.flashCard.addEventListener('click', () => this._flipCard());
    this.flashSpeakBtn.addEventListener('click', () => this._speakCurrent());
    this.flashKnowBtn.addEventListener('click', () => this._markKnow());
    this.flashReviewBtn.addEventListener('click', () => this._markReview());
    this.flashRetryBtn.addEventListener('click', () => this._retry());
    this.flashRefreshBtn.addEventListener('click', () => this._refresh());
  }

  /** 3-way switch tab: chat / flash / quiz — chỉ một tab active */
  switchTab(name) {
    const showFlash = name === 'flash';
    // Ẩn chat + quiz area (dùng document.getElementById trực tiếp — tránh import vòng)
    const chatArea = document.getElementById('chat-area');
    const quizArea = document.getElementById('quiz-area');
    const tabChat = document.getElementById('tab-chat');
    const tabQuiz = document.getElementById('tab-quiz');

    if (chatArea) chatArea.classList.toggle('hidden', showFlash);
    if (quizArea) quizArea.classList.toggle('hidden', showFlash);
    this.flashArea.classList.toggle('hidden', !showFlash);

    if (tabChat) tabChat.classList.toggle('active', !showFlash && name === 'chat');
    if (tabQuiz) tabQuiz.classList.toggle('active', !showFlash && name === 'quiz');
    this.tabFlash.classList.toggle('active', showFlash);

    if (showFlash) this._onTabOpened();
  }

  /** Gọi khi tab flash mở — tự sinh nếu chưa có thẻ cho trang hiện tại */
  _onTabOpened() {
    this.cards = [];
    this.mainQueue = [];
    this.reviewQueue = [];
    this.currentCard = null;
    this.flipped = false;
    this._generateForCurrentPage();
  }

  /** App gọi khi đổi trang — reset, sinh mới nếu tab flash đang mở */
  onPageChanged(pageNum) {
    if (!this.flashArea.classList.contains('hidden')) {
      this.cards = [];
      this.mainQueue = [];
      this.reviewQueue = [];
      this.currentCard = null;
      this.flipped = false;
      this._genSeq++;
      this._generating = false;
      this._generateForCurrentPage();
    }
  }

  /** App gọi sau khi tải PDF — bật nút tạo */
  onPdfLoaded() {
    this.flashStartBtn.disabled = false;
    this.flashEmptyText.textContent = 'Tạo thẻ học cho trang đang xem.';
  }

  /** Số thẻ từ dropdown (3/5/10, mặc định 5) */
  _getFlashCount() {
    const v = parseInt(this.flashCountSelect?.value, 10);
    return [3, 5, 10].includes(v) ? v : 5;
  }

  /** Reset về trạng thái trống (chưa có thẻ) */
  _resetToEmpty() {
    this.cards = [];
    this.mainQueue = [];
    this.reviewQueue = [];
    this.currentCard = null;
    this.flipped = false;
    this.flashCardView.classList.add('hidden');
    this.flashResult.classList.add('hidden');
    this.flashLoading.classList.add('hidden');
    this.flashEmpty.classList.remove('hidden');
    this.flashStartBtn.disabled = !this.app.pdfViewer.isLoaded;
    this.flashEmptyText.textContent = 'Tạo thẻ học cho trang đang xem.';
  }

  /** Sinh thẻ cho trang hiện tại */
  async _generateForCurrentPage() {
    if (!this.app.pdfViewer.isLoaded) {
      this.app._showToast('Vui lòng tải file PDF trước', 'error');
      return;
    }
    if (!this.app.aiEngine.isConfigured) {
      this.app._showApiKeyModal();
      return;
    }
    if (this._generating) return;
    this._generating = true;
    const genId = ++this._genSeq;

    if (!this.app._isTeaching) {
      this.app.ttsEngine.stop();
    }

    this.flashEmpty.classList.add('hidden');
    this.flashResult.classList.add('hidden');
    this.flashCardView.classList.add('hidden');
    this.flashLoading.classList.remove('hidden');
    this.app._updateVoiceStatus('analyzing', 'Đang tạo thẻ học...');

    const pageNum = this.app.pdfViewer.currentPage;

    try {
      const imageBase64 = this.app.pdfViewer.getPageImageBase64();
      const pageText = await this.app.pdfViewer.getPageText();
      const cards = await this.app.aiEngine.generateFlashcards(pageNum, pageText, imageBase64, this._getFlashCount());

      if (this.app.pdfViewer.currentPage !== pageNum || genId !== this._genSeq) {
        if (genId === this._genSeq) {
          this.flashLoading.classList.add('hidden');
          this._resetToEmpty();
        }
        return;
      }

      this.cards = cards;
      this.mainQueue = [...cards];
      this.reviewQueue = [];

      this.flashLoading.classList.add('hidden');
      this.flashCardView.classList.remove('hidden');
      this._renderCard();
    } catch (err) {
      if (err.message === 'Đã hủy yêu cầu.') return;
      if (genId !== this._genSeq) return;
      console.error('Lỗi tạo flashcards:', err);
      this.flashLoading.classList.add('hidden');
      this._resetToEmpty();
      this.flashEmptyText.textContent = '⚠️ ' + err.message;
      this.flashStartBtn.disabled = false;
      this.app._showToast('Không tạo được thẻ học. Bấm 🔄 để thử lại.', 'error');
    } finally {
      if (genId === this._genSeq) this._generating = false;
    }
  }

  /** Hiển thị thẻ hiện tại (mặt trước = term) */
  _renderCard() {
    this.flipped = false;
    this.flashCard.classList.remove('flipped');
    this.flashCardFront.classList.remove('hidden');
    this.flashCardBack.classList.add('hidden');

    if (this.mainQueue.length > 0) {
      this.currentCard = this.mainQueue[0];
      this.flashCardFront.textContent = this.currentCard.term;
      this.flashCardBack.textContent = this.currentCard.definition;
      const total = this.mainQueue.length + this.reviewQueue.length;
      if (total > 1) {
        this.flashProgress.textContent = `Thẻ 1/${this.mainQueue.length + this.reviewQueue.length}`;
      } else {
        this.flashProgress.textContent = '';
      }
    }
  }

  /** Click vào thẻ → lật xem definition */
  _flipCard() {
    if (!this.currentCard || this.flipped) return;
    this.flipped = true;
    this.flashCard.classList.add('flipped');
    this.flashCardFront.classList.add('hidden');
    this.flashCardBack.classList.remove('hidden');
  }

  /** Đọc bằng giọng */
  _speak(text) {
    if (!text) return;
    this.app.ttsEngine.speak(this.app._cleanVoiceText(text));
  }

  /** Đọc term (chưa flip) hoặc definition (đã flip) */
  _speakCurrent() {
    if (!this.currentCard) return;
    this._speak(this.flipped ? this.currentCard.definition : this.currentCard.term);
  }

  /** ✅ Biết — thẻ qua, không quay lại */
  _markKnow() {
    if (!this.currentCard) return;
    this.mainQueue.shift();
    this._nextCard();
  }

  /** 🔄 Ôn lại — thẻ quay lại cuối hàng đợi */
  _markReview() {
    if (!this.currentCard) return;
    this.mainQueue.shift();
    this.reviewQueue.push(this.currentCard);
    this._nextCard();
  }

  /** Chuyển sang thẻ tiếp theo */
  _nextCard() {
    if (this.mainQueue.length > 0) {
      this._renderCard();
      return;
    }
    if (this.reviewQueue.length > 0) {
      this.mainQueue = [...this.reviewQueue];
      this.reviewQueue = [];
      this._renderCard();
      return;
    }
    this._showResult();
  }

  /** Tất cả thẻ đã học xong */
  _showResult() {
    this.flashCardView.classList.add('hidden');
    this.flashResult.classList.remove('hidden');
    this.flashResultText.textContent = '🎉 Hoàn thành! Bạn đã học xong tất cả thẻ.';
  }

  /** Học lại: dùng lại cards hiện có (KHÔNG gọi AI) */
  _retry() {
    this.mainQueue = [...this.cards];
    this.reviewQueue = [];
    this.currentCard = null;
    this.flipped = false;
    this.flashResult.classList.add('hidden');
    this.flashCardView.classList.remove('hidden');
    this._renderCard();
  }

  /** Làm mới: xoá cache → sinh thẻ mới (GỌI AI) */
  _refresh() {
    const pageNum = this.app.pdfViewer.currentPage;
    this.app.aiEngine.clearFlashcardsForPage(pageNum);
    this.cards = [];
    this.mainQueue = [];
    this.reviewQueue = [];
    this.currentCard = null;
    this.flipped = false;
    this.flashResult.classList.add('hidden');
    this._generateForCurrentPage();
  }
}
