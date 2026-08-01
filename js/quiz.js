/**
 * QuizManager - Module quiz trắc nghiệm theo trang
 * Luồng: mở tab → tự sinh câu hỏi (cache) → trả lời từng câu (chấm ngay + giải thích + TTS) → tổng kết → lưu điểm
 */
export class QuizManager {
  constructor(app) {
    this.app = app;

    this.tabChat = document.getElementById('tab-chat');
    this.tabQuiz = document.getElementById('tab-quiz');
    this.chatArea = document.getElementById('chat-area');
    this.quizArea = document.getElementById('quiz-area');
    this.quizTitle = document.getElementById('quiz-title');
    this.quizBestScore = document.getElementById('quiz-best-score');
    this.quizEmpty = document.getElementById('quiz-empty');
    this.quizEmptyText = document.getElementById('quiz-empty-text');
    this.quizStartBtn = document.getElementById('quiz-start-btn');
    this.quizCountSelect = document.getElementById('quiz-count');
    this.quizLoading = document.getElementById('quiz-loading');
    this.quizQuestion = document.getElementById('quiz-question');
    this.quizQuestionText = document.getElementById('quiz-question-text');
    this.quizOptions = document.getElementById('quiz-options');
    this.quizFeedback = document.getElementById('quiz-feedback');
    this.quizNextBtn = document.getElementById('quiz-next-btn');
    this.quizResult = document.getElementById('quiz-result');
    this.quizResultScore = document.getElementById('quiz-result-score');
    this.quizRetryBtn = document.getElementById('quiz-retry-btn');
    this.quizCloseBtn = document.getElementById('quiz-close-btn');
    this.quizReviewBtn = document.getElementById('quiz-review-btn');
    this.quizReviewReport = document.getElementById('quiz-review-report');
    this.quizReviewList = document.getElementById('quiz-review-list');
    this.quizReviewDoneBtn = document.getElementById('quiz-review-done-btn');

    this.questions = [];
    this.currentIndex = 0;
    this.correctCount = 0;
    this.answered = false;
    this._generating = false;
    this._genSeq = 0;

    this._reviewMode = false;
    this._weakPages = [];
    this._reviewIndex = -1;
    this._reviewReport = {};

    this._setupEvents();
  }

  _setupEvents() {
    this.tabChat.addEventListener('click', () => this.switchTab('chat'));
    this.tabQuiz.addEventListener('click', () => this.switchTab('quiz'));
    this.quizStartBtn.addEventListener('click', () => this._generateForCurrentPage());
    this.quizNextBtn.addEventListener('click', () => this._onNext());
    this.quizRetryBtn.addEventListener('click', () => this._retry());
    this.quizCloseBtn.addEventListener('click', () => this._resetToEmpty());
    this.quizReviewBtn.addEventListener('click', () => this._startWeakPageReview());
    this.quizReviewDoneBtn.addEventListener('click', () => this._closeReviewReport());
    this.quizOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('.quiz-option');
      if (!btn) return;
      this._answer(parseInt(btn.dataset.idx, 10));
    });
  }

  /** Chuyển tab chat/quiz */
  switchTab(name) {
    const showQuiz = name === 'quiz';
    if (!showQuiz && this._reviewMode) {
      this._reviewMode = false;
      this._weakPages = [];
      this._reviewIndex = -1;
      this._reviewReport = {};
    }
    this.chatArea.classList.toggle('hidden', showQuiz);
    this.quizArea.classList.toggle('hidden', !showQuiz);
    // Ẩn flash area + reset flash tab (3-way coordination)
    const flashArea = document.getElementById('flash-area');
    if (flashArea) flashArea.classList.add('hidden');
    const tabFlash = document.getElementById('tab-flash');
    if (tabFlash) tabFlash.classList.remove('active');
    this.tabChat.classList.toggle('active', !showQuiz);
    this.tabQuiz.classList.toggle('active', showQuiz);
    if (showQuiz) this._onTabOpened();
  }

  /** Gọi khi tab quiz mở — tự sinh nếu chưa có quiz cho trang hiện tại */
  _onTabOpened() {
    this._syncForPage(this.app.pdfViewer.currentPage);
    this.questions = [];
    this.currentIndex = 0;
    this.correctCount = 0;
    this.answered = false;
    this._generateForCurrentPage();
  }

  /** App gọi khi đổi trang — cập nhật tiêu đề + điểm, tự sinh nếu tab đang mở */
  onPageChanged(pageNum) {
    if (this._reviewMode) return;
    this._syncForPage(pageNum);
    if (!this.quizArea.classList.contains('hidden')) {
      this.questions = [];
      this.currentIndex = 0;
      this.correctCount = 0;
      this.answered = false;
      this._genSeq++;
      this._generating = false;
      this._generateForCurrentPage();
    }
  }

  /** App gọi sau khi tải PDF — bật nút tạo */
  onPdfLoaded() {
    this.quizStartBtn.disabled = false;
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
    this._syncForPage(this.app.pdfViewer.currentPage);
    this._updateReviewBtn();
  }

  /** Cập nhật tiêu đề + điểm cao nhất của trang */
  _syncForPage(pageNum) {
    this.quizTitle.textContent = `📝 Quiz trang ${pageNum}`;
    const score = this._getScore(pageNum);
    if (score && score.attempts > 0) {
      this.quizBestScore.textContent = `Điểm cao nhất: ${score.best}/${score.total || 3}`;
      this.quizBestScore.classList.remove('hidden');
    } else {
      this.quizBestScore.classList.add('hidden');
    }
    this._updateReviewBtn();
  }

  /** Reset về trạng thái trống (chưa làm) */
  _resetToEmpty() {
    this.questions = [];
    this.currentIndex = 0;
    this.correctCount = 0;
    this.answered = false;
    this.quizQuestion.classList.add('hidden');
    this.quizResult.classList.add('hidden');
    this.quizLoading.classList.add('hidden');
    this.quizEmpty.classList.remove('hidden');
    this.quizStartBtn.disabled = !this.app.pdfViewer.isLoaded;
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
    this.quizReviewReport.classList.add('hidden');
    this._updateReviewBtn();
  }

  /** Số câu hỏi từ dropdown (3/5/10, mặc định 3) */
  _getQuizCount() {
    const v = parseInt(this.quizCountSelect?.value, 10);
    return [3, 5, 10].includes(v) ? v : 3;
  }

  _getWeakPages() {
    const filename = this.app._pdfFileName;
    if (!filename) return [];
    try {
      const all = JSON.parse(localStorage.getItem('quiz_scores_' + filename) || '{}');
      return Object.entries(all)
        .filter(([, score]) => {
          const pct = score.best / (score.total || 3);
          return pct < 0.6;
        })
        .map(([k]) => parseInt(k, 10))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  _updateReviewBtn() {
    if (!this.app.pdfViewer.isLoaded) {
      this.quizReviewBtn.classList.add('hidden');
      return;
    }
    const weak = this._getWeakPages();
    this.quizReviewBtn.classList.toggle('hidden', weak.length === 0);
  }

  _startWeakPageReview() {
    this._weakPages = this._getWeakPages();
    if (this._weakPages.length === 0) {
      this.app._showToast('Không có trang yếu nào để ôn tập.', 'error');
      return;
    }
    this._reviewMode = true;
    this._reviewIndex = 0;
    this._reviewReport = {};
    this._reviewCurrentPage();
  }

  async _reviewCurrentPage() {
    const pageNum = this._weakPages[this._reviewIndex];

    const oldScore = this._getScore(pageNum);
    this._reviewReport[pageNum] = {
      oldBest: oldScore ? oldScore.best : 0,
      oldTotal: oldScore ? (oldScore.total || 3) : 3
    };

    this.app.pdfViewer.renderPage(pageNum);
    this._syncForPage(pageNum);

    this.app.aiEngine.clearQuizForPage(pageNum);
    this.questions = [];
    this.currentIndex = 0;
    this.correctCount = 0;
    this.answered = false;

    this.quizEmpty.classList.add('hidden');
    this.quizResult.classList.add('hidden');
    this.quizQuestion.classList.add('hidden');
    this.quizReviewReport.classList.add('hidden');
    this._generateForCurrentPage();
  }

  _onReviewPageDone(pageNum) {
    this._reviewReport[pageNum].newBest = this.correctCount;
    this._reviewReport[pageNum].newTotal = this.questions.length;

    this._reviewIndex++;
    if (this._reviewIndex >= this._weakPages.length) {
      this._showReviewReport();
    } else {
      this._reviewCurrentPage();
    }
  }

  _showReviewReport() {
    this._reviewMode = false;

    this.quizQuestion.classList.add('hidden');
    this.quizResult.classList.add('hidden');
    this.quizLoading.classList.add('hidden');
    this.quizEmpty.classList.add('hidden');

    let html = '<h3 style="margin:0 0 8px 0;">📊 Báo cáo ôn tập</h3>';
    const entries = Object.entries(this._reviewReport).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    for (const [page, r] of entries) {
      const newPct = r.newTotal > 0 ? r.newBest / r.newTotal : 0;
      const pass = newPct >= 0.6;
      html += `<div class="review-item ${pass ? 'pass' : 'fail'}">
        <span><strong>Trang ${page}</strong>: ${r.oldBest}/${r.oldTotal} → ${r.newBest}/${r.newTotal}</span>
        <span>${pass ? '✅' : '❌'}</span>
      </div>`;
    }
    this.quizReviewList.innerHTML = html;
    this.quizReviewReport.classList.remove('hidden');
    this._updateReviewBtn();
  }

  _closeReviewReport() {
    this._reviewMode = false;
    this._weakPages = [];
    this._reviewIndex = -1;
    this._reviewReport = {};
    this._resetToEmpty();
  }

  /** Sinh quiz cho trang hiện tại */
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

    // Không dừng giảng nếu đang giảng (như hành vi chat)
    if (!this.app._isTeaching) {
      this.app.ttsEngine.stop();
    }

    this.quizEmpty.classList.add('hidden');
    this.quizResult.classList.add('hidden');
    this.quizQuestion.classList.add('hidden');
    this.quizLoading.classList.remove('hidden');
    this.app._updateVoiceStatus('analyzing', 'Đang tạo câu hỏi...');

    const pageNum = this.app.pdfViewer.currentPage;

    try {
      const imageBase64 = this.app.pdfViewer.getPageImageBase64();
      const pageText = await this.app.pdfViewer.getPageText();
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64, this._getQuizCount());

      if (this.app.pdfViewer.currentPage !== pageNum || genId !== this._genSeq) {
        if (genId === this._genSeq) {
          this.quizLoading.classList.add('hidden');
          this._resetToEmpty();
        }
        return;
      }

      this.questions = questions;
      this.currentIndex = 0;
      this.correctCount = 0;
      this.answered = false;

      this.quizLoading.classList.add('hidden');
      this.quizQuestion.classList.remove('hidden');
      this._renderQuestion();
    } catch (err) {
      if (err.message === 'Đã hủy yêu cầu.') return;
      if (genId !== this._genSeq) return;
      console.error('Lỗi tạo quiz:', err);
      this.quizLoading.classList.add('hidden');
      this._resetToEmpty();
      this.quizEmptyText.textContent = '⚠️ ' + err.message;
      this.quizStartBtn.disabled = false;
      this.app._showToast('Không tạo được câu hỏi. Bấm 🔄 để thử lại.', 'error');
    } finally {
      if (genId === this._genSeq) this._generating = false;
    }
  }

  /** Hiển thị câu hỏi hiện tại */
  _renderQuestion() {
    const q = this.questions[this.currentIndex];
    this.answered = false;
    this.quizQuestionText.textContent = `Câu ${this.currentIndex + 1}/${this.questions.length}: ${q.question}`;

    this.quizOptions.innerHTML = '';
    const labels = q.type === 'tf' ? ['✅ Đúng', '❌ Sai'] : ['A', 'B', 'C', 'D'];
    labels.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.dataset.idx = i;
      if (q.type === 'mcq') {
        btn.innerHTML = `<span class="quiz-opt-label">${label}</span><span class="quiz-opt-text">${this._escapeHtml(q.options[i])}</span>`;
      } else {
        btn.textContent = label;
      }
      this.quizOptions.appendChild(btn);
    });

    this.quizFeedback.classList.add('hidden');
    this.quizNextBtn.classList.add('hidden');
    this._speak(q.question);
  }

  /** Xử lý chọn đáp án */
  _answer(idx) {
    if (this.answered || this.questions.length === 0) return;
    this.answered = true;

    const q = this.questions[this.currentIndex];
    const correctIdx = q.type === 'tf' ? (q.correct ? 0 : 1) : q.correct_index;

    const buttons = this.quizOptions.querySelectorAll('.quiz-option');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === correctIdx) b.classList.add('correct');
      else if (i === idx && idx !== correctIdx) b.classList.add('wrong');
    });

    const isCorrect = idx === correctIdx;
    if (isCorrect) this.correctCount++;

    this.quizFeedback.className = isCorrect ? 'quiz-feedback correct' : 'quiz-feedback wrong';
    this.quizFeedback.innerHTML = (isCorrect ? '✅ Chính xác! ' : '❌ Chưa đúng. ') + this._escapeHtml(q.explanation || '');
    this.quizFeedback.classList.remove('hidden');

    this.quizNextBtn.textContent = this.currentIndex >= this.questions.length - 1 ? '📊 Xem kết quả' : 'Câu tiếp →';
    this.quizNextBtn.classList.remove('hidden');

    this._speak((isCorrect ? 'Chính xác. ' : 'Chưa đúng. ') + (q.explanation || ''));
  }

  _onNext() {
    if (this.currentIndex >= this.questions.length - 1) {
      this._showResult();
      return;
    }
    this.currentIndex++;
    this._renderQuestion();
  }

  /** Tổng kết + lưu điểm */
  _showResult() {
    const pageNum = this.app.pdfViewer.currentPage;
    this._saveScore(pageNum, this.correctCount, this.questions.length);

    this.quizQuestion.classList.add('hidden');
    this.quizResult.classList.remove('hidden');
    this.quizResultScore.innerHTML = `🎯 Bạn trả lời đúng <strong>${this.correctCount}/${this.questions.length}</strong> câu.`;
    this._syncForPage(pageNum);
    if (this._reviewMode) this._onReviewPageDone(pageNum);
  }

  /** Làm lại: xoá cache quiz trang → sinh câu mới */
  _retry() {
    const pageNum = this.app.pdfViewer.currentPage;
    this.app.aiEngine.clearQuizForPage(pageNum);
    this.questions = [];
    this._generateForCurrentPage();
  }

  /** Đọc bằng giọng (bỏ markdown) */
  _speak(text) {
    if (!text) return;
    this.app.ttsEngine.speak(this.app._cleanVoiceText(text));
  }

  // ============================================================
  //  LƯU ĐIỂM (localStorage theo file PDF)
  // ============================================================

  _getScore(pageNum) {
    const filename = this.app._pdfFileName;
    if (!filename) return null;
    try {
      const all = JSON.parse(localStorage.getItem('quiz_scores_' + filename) || '{}');
      return all[pageNum] || null;
    } catch {
      return null;
    }
  }

  _saveScore(pageNum, score, total = 3) {
    const filename = this.app._pdfFileName;
    if (!filename) return;
    try {
      const key = 'quiz_scores_' + filename;
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      const cur = all[pageNum] || { best: 0, last: 0, lastTime: 0, attempts: 0, total: 0 };
      cur.last = score;
      cur.best = Math.max(cur.best, score);
      cur.lastTime = Date.now();
      cur.attempts += 1;
      cur.total = total;
      all[pageNum] = cur;
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) {
      console.warn('[ScholarVoice] Không lưu được điểm quiz:', e.message);
    }
  }

  _escapeHtml(text) {
    return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
