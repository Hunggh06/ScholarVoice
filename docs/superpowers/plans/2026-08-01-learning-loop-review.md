# Learning loop: Kiểm tra ngay + Ôn tập trang yếu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Feature #6 "Kiểm tra ngay sau giảng" (nút "📝 Kiểm tra ngay" trong voice bar sau khi TTS giảng xong) + Feature #1 "Ôn tập trang yếu" (nút "📚 Ôn tập trang yếu" trong tab Quiz, lần lượt kiểm tra lại các trang có điểm < 60%).

**Architecture:** `AIEngine` thêm setting `teachThenQuiz` (mặc định BẬT). `App.onEnd` + `_updateVoiceStatus` phân biệt state `'done'` do giảng (hiện nút) vs chat (không hiện) qua flag `_justTaught`. `QuizManager` thêm `_reviewMode` guard `onPageChanged`, methods `_getWeakPages`, `_startWeakPageReview`, `_reviewCurrentPage`, `_onReviewPageDone`, `_showReviewReport`, `_closeReviewReport`. Chụp `oldScore` trước khi clear+generate để hiển thị báo cáo cải thiện. KHÔNG tự chuyển tab, không đổi `server.py`, không thêm dependency.

**Tech Stack:** Vanilla JS ES modules, localStorage, Node v20 (unit test `node:assert`), Playwright (QA network interception), Web Speech API (giữ nguyên).

**Spec:** `docs/superpowers/specs/2026-08-01-learning-loop-review-design.md`

---

## Trước khi bắt đầu

- [x] Kiểm tra git status sạch (ngoài `.omo/` và `docs/superpowers/plans/`):
  ```bash
  git status
  ```
- [x] Baseline — tất cả file JS hiện tại parse OK:
  ```bash
  node --check js/ai-engine.js && node --check js/quiz.js && node --check js/app.js && node --check js/chat.js
  ```
  Expected: exit 0
- [x] Chạy regression tests hiện có:
  ```bash
  node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs
  ```
  Expected: `✅ title-detect: tất cả test pass` + `✅ quiz-validate: tất cả test pass`, exit 0

---

### Task 1: `js/ai-engine.js` — thêm setting `teachThenQuiz`

**Files:**
- Modify: `js/ai-engine.js` (constructor ~7-44, saveSettings ~47-83, getSettings ~85-100)

- [x] **Step 1: Constructor — thêm `this.teachThenQuiz` (line 8)**

Hiện tại constructor dòng 8: `const saved = JSON.parse(localStorage.getItem('ai_settings') || '{}');`. Sau các dòng gán biến từ `saved` (lines 10-36), thêm dòng sau line 36 (sau `this.customStyle`):

```javascript
    this.teachThenQuiz = saved.teachThenQuiz !== undefined ? saved.teachThenQuiz : true;
```

- [x] **Step 2: `saveSettings()` — gán biến (lines 47-61)**

Sau line 60 (`if (settings.customStyle !== undefined) this.customStyle = settings.customStyle;`), thêm:

```javascript
    if (settings.teachThenQuiz !== undefined) this.teachThenQuiz = settings.teachThenQuiz;
```

- [x] **Step 3: `saveSettings()` — lưu localStorage (lines 62-75)**

Trong object `JSON.stringify({...})` ở lines 62-75, thêm dòng sau line 74 (`customStyle: this.customStyle,`):

```javascript
      teachThenQuiz: this.teachThenQuiz,
```

- [x] **Step 4: `getSettings()` — export (lines 85-100)**

Trong return object (lines 86-99), thêm dòng sau line 98 (`customStyle: this.customStyle,`):

```javascript
      teachThenQuiz: this.teachThenQuiz,
```

- [x] **Step 5: Verify**

```bash
node --check js/ai-engine.js
```
Expected: exit 0

- [x] **Step 6: Commit**

```bash
git add js/ai-engine.js
git commit -m "feat: add teachThenQuiz setting to AIEngine"
```

---

### Task 2: `index.html` — UI nút + toggle (Feature #6 + #1)

**Files:**
- Modify: `index.html` (voice bar ~240-244, settings modal ~29-89, quiz header ~286-290, quiz body ~317-323)

Kiểm tra vị trí hiện tại để xác nhận số dòng trước khi sửa:

| Insert | Sau dòng | Vị trí cần chèn |
|--------|----------|-----------------|
| `#quiz-now-btn` | 243 (`</div>` của `#voice-controls`) | Sau `<div id="voice-controls">...</div>`, bên trong `.voice-right` (trước dòng 244 `</div>` đóng `.voice-right`) |
| `#teach-then-quiz-toggle` | 82 (`</div>` của `#deepseek-settings`) | Sau `</div>` đóng `#deepseek-settings`, trước dòng 83 `</div>` đóng modal body |
| `#quiz-review-btn` | 289 (`#quiz-best-score`) | Sau `<span id="quiz-best-score" class="hidden"></span>`, trong `#quiz-header` (trước `</div>` dòng 290) |
| `#quiz-review-report` | 323 (`</div>` của `#quiz-result`) | Sau `</div>` đóng `#quiz-result`, trong `#quiz-body` (trước `</div>` dòng 324) |

- [x] **Step 1: Thêm `#quiz-now-btn` trong voice bar (sau line 243)**

Sau `</div>` của `<div id="voice-controls">` (line 243), thêm:

```html
            <button id="quiz-now-btn" class="voice-btn quiz-now-btn hidden" title="Kiểm tra kiến thức trang vừa giảng">📝 Kiểm tra ngay</button>
```

- [x] **Step 2: Thêm `#teach-then-quiz-toggle` trong settings modal (sau line 82)**

Sau `</div>` của `<div id="deepseek-settings">` (line 82), thêm:

```html

      <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;cursor:pointer;">
        <input type="checkbox" id="teach-then-quiz-toggle" checked style="accent-color:var(--accent);"> Tự động đề xuất kiểm tra sau mỗi trang giảng
      </label>
```

- [x] **Step 3: Thêm `#quiz-review-btn` trong quiz header (sau line 289)**

Sau `<span id="quiz-best-score" class="hidden"></span>` (line 289), thêm:

```html
          <button id="quiz-review-btn" class="btn-ghost hidden" style="font-size:0.75rem;padding:4px 10px;" title="Ôn tập các trang có điểm thấp">📚 Ôn tập trang yếu</button>
```

- [x] **Step 4: Thêm `#quiz-review-report` trong quiz body (sau line 323)**

Sau `</div>` đóng `<div id="quiz-result">` (line 323), thêm:

```html
          <div id="quiz-review-report" class="hidden" style="padding:16px;display:flex;flex-direction:column;gap:12px;flex:1;overflow-y:auto;">
            <div id="quiz-review-list"></div>
            <button id="quiz-review-done-btn" class="btn-primary" style="align-self:center;">✅ Đóng báo cáo</button>
          </div>
```

- [x] **Step 5: Verify**

Start server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
```

Kiểm tra các ID mới tồn tại trong HTML:
```bash
curl -s http://localhost:8080/ | grep -c 'quiz-now-btn'   # Expected: >=1
curl -s http://localhost:8080/ | grep -c 'teach-then-quiz-toggle'  # Expected: >=1
curl -s http://localhost:8080/ | grep -c 'quiz-review-btn'  # Expected: >=1
curl -s http://localhost:8080/ | grep -c 'quiz-review-report'  # Expected: >=1
curl -s http://localhost:8080/ | grep -c 'quiz-review-list'  # Expected: >=1
curl -s http://localhost:8080/ | grep -c 'quiz-review-done-btn'  # Expected: >=1
```

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add quiz-now-btn, teach-then-quiz toggle, and review UI elements"
```

---

### Task 3: `css/style.css` — style cho nút mới + review

**Files:**
- Modify: `css/style.css` (sau line 377 `.voice-btn.retry-btn`, sau line 622 cuối block quiz)

- [x] **Step 1: Thêm style `#quiz-now-btn` (sau line 377)**

Sau dòng 377 (`.voice-btn.retry-btn { ... }`), thêm:

```css
#quiz-now-btn { width:auto; padding:0 14px; font-size:0.82rem; font-weight:600; white-space:nowrap; }
#quiz-now-btn:hover:not(:disabled) { background:rgba(0,242,254,0.12); border-color:var(--accent); color:var(--accent); box-shadow:0 0 12px var(--accent-glow); }
```

- [x] **Step 2: Thêm style review (sau line 622 — cuối file)**

Sau dòng 622 (`}` đóng `#quiz-count`), thêm:

```css
#quiz-review-report { flex:1; overflow-y:auto; }
#quiz-review-list { font-size:0.9rem; line-height:1.8; }
.review-item { display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:var(--radius-sm); }
.review-item.pass { border-left:3px solid rgba(52,211,153,0.8); }
.review-item.fail { border-left:3px solid rgba(248,113,113,0.8); }
```

- [x] **Step 3: Verify**

Mở index.html trong browser kiểm tra thủ công hoặc QA Playwright (sẽ cover trong Task 7).
Không có lệnh `node --check` cho CSS.

- [x] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "feat: add styles for quiz-now-btn and review report"
```

---

### Task 4: `js/app.js` — Feature #6 Kiểm tra ngay

**Files:**
- Modify: `js/app.js` (constructor ~12-31, init ~43-62, _showApiKeyModal ~392-409, _setupSettingsBtn ~453-468, _navigatePage ~649-676, ttsEngine.onEnd ~924-941, _updateVoiceStatus ~985-1024)

**Rủi ro cần chú ý:**
- State `'done'` xuất hiện ở 2 nơi: `ttsEngine.onEnd` (line 924-941) và `_handleChatMessage` (lines 1087-1089). Phải phân biệt: chỉ hiện nút "Kiểm tra ngay" khi done do giảng xong.
- Giải pháp: flag `this._justTaught = true` set trong `onEnd` TRƯỚC khi gọi `_updateVoiceStatus`. Trong `_updateVoiceStatus` case `'done'`, kiểm tra `this._justTaught` để hiện nút. Xoá flag ngay sau khi hiển thị hoặc khi chuyển trạng thái khác.

- [x] **Step 1: Constructor — thêm state (lines 12-31)**

Sau line 15 (`this.aiEngine = new AIEngine()`), thêm:

```javascript
    this._teachThenQuiz = true;
```

Sau line 18 (`this.quizManager = new QuizManager(this);`), thêm:

```javascript
    this._justTaught = false;
```

Sau line 19 (`this._lastTaughtWasTitle = false;`), thêm:

```javascript
    this._loadTeachThenQuizSetting();
```

(Lưu ý: Khai báo `_loadTeachThenQuizSetting` là method của class — định nghĩa trong Step 2.)

- [x] **Step 2: Thêm method `_loadTeachThenQuizSetting()`**

Thêm vào class (sau `_cancelPrefetch` ~line 39 hoặc sau constructor):

```javascript
  _loadTeachThenQuizSetting() {
    const raw = localStorage.getItem('ai_settings');
    if (!raw) { this._teachThenQuiz = true; return; }
    try {
      const s = JSON.parse(raw);
      this._teachThenQuiz = s.teachThenQuiz !== undefined ? s.teachThenQuiz : true;
    } catch {
      this._teachThenQuiz = true;
    }
  }
```

- [x] **Step 3: `init()` — thêm `_setupQuizNowBtn()` (sau line 61)**

Sau line 61 (`this._setupLanding();`), thêm:

```javascript
    this._setupQuizNowBtn();
```

- [x] **Step 4: Thêm method `_setupQuizNowBtn()`**

Thêm vào class (gần `_setupQuizEvents` ~line 1044 hoặc sau `_loadTeachThenQuizSetting`):

```javascript
  _setupQuizNowBtn() {
    const btn = document.getElementById('quiz-now-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._onQuizNowClick());
  }
```

- [x] **Step 5: Thêm method `_onQuizNowClick()`**

```javascript
  _onQuizNowClick() {
    if (!this.pdfViewer.isLoaded) return;
    const pageNum = this.pdfViewer.currentPage;
    this.quizManager.switchTab('quiz');
    this.quizManager.questions = [];
    this.quizManager.currentIndex = 0;
    this.quizManager.correctCount = 0;
    this.quizManager.answered = false;
    this.quizManager._generateForCurrentPage();
  }
```

- [x] **Step 6: `ttsEngine.onEnd` — hiện nút khi giảng xong (lines 924-941)**

Sau line 927 (`this._updatePlayPauseBtn(false);`), thêm trước khi gọi `_updateVoiceStatus`:

Sửa: đặt `this._justTaught = true;` NGAY SAU khi `this._isTeaching = false` (line 925), trước `_updateVoiceStatus` ở line 926.

Code hiện tại (lines 924-927):
```javascript
    this.ttsEngine.onEnd = () => {
      this._isTeaching = false;
      this._updateVoiceStatus('done', `Đã giảng xong trang ${this.pdfViewer.currentPage}`);
      this._updatePlayPauseBtn(false);
```

Sửa line 925 thành:
```javascript
      this._isTeaching = false;
```

Và thêm NGAY SAU:
```javascript
      this._justTaught = true;
```

(Rồi mới đến line 926 `this._updateVoiceStatus(...)` — không đổi)

- [x] **Step 7: `_updateVoiceStatus()` — hiện/ẩn `#quiz-now-btn` (lines 985-1024)**

Thêm logic vào đầu method (sau line 990 `textEl.textContent = text;`):

```javascript
    const quizNowBtn = document.getElementById('quiz-now-btn');
```

Trong `switch (state)`:

| Case | Hành động |
|------|-----------|
| `'idle'`, `'loading'`, `'analyzing'`, `'speaking'`, `'paused'`, `'stopped'`, `'error'` | Thêm `if (quizNowBtn) quizNowBtn.classList.add('hidden');` + `this._justTaught = false;` |
| `'done'` | Thêm: `if (quizNowBtn) { if (this._justTaught && this._teachThenQuiz) { quizNowBtn.classList.remove('hidden'); } else { quizNowBtn.classList.add('hidden'); } this._justTaught = false; }` |

Cụ thể cho từng case:

- `'idle'` (line 996-998): thêm sau `iconEl.textContent = '🔇';`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'loading'` (line 999-1001): thêm sau `iconEl.textContent = '📂';`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'analyzing'` (line 1002-1005): thêm sau `textEl.classList.add('active');`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'speaking'` (line 1006-1010): thêm sau `if (waveformEl) waveformEl.classList.remove('hidden');`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'paused'` (line 1011-1013): thêm sau `iconEl.textContent = '⏸️';`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'done'` (line 1014-1016): thêm sau `iconEl.textContent = '✅';`:
  ```javascript
        if (quizNowBtn) {
          if (this._justTaught && this._teachThenQuiz) quizNowBtn.classList.remove('hidden');
          else quizNowBtn.classList.add('hidden');
          this._justTaught = false;
        }
  ```

- `'stopped'` (line 1017-1019): thêm sau `iconEl.textContent = '⏹️';`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- `'error'` (line 1020-1022): thêm sau `iconEl.textContent = '❌';`:
  ```javascript
        if (quizNowBtn) quizNowBtn.classList.add('hidden');
        this._justTaught = false;
  ```

- [x] **Step 8: `_navigatePage()` — ẩn nút khi chuyển trang (lines 649-676)**

Sau line 656 (`this._lastTaughtWasTitle = false;`), thêm:

```javascript
    this._justTaught = false;
    const quizNowBtn = document.getElementById('quiz-now-btn');
    if (quizNowBtn) quizNowBtn.classList.add('hidden');
```

- [x] **Step 9: `_showApiKeyModal()` — đọc toggle (lines 392-409)**

Sau line 406 (`document.getElementById('deepseek-model').value = s.deepseekModel || 'deepseek-chat';`), thêm:

```javascript
    document.getElementById('teach-then-quiz-toggle').checked = s.teachThenQuiz !== undefined ? s.teachThenQuiz : true;
```

- [x] **Step 10: `_setupSettingsBtn()` — lưu toggle (lines 453-468)**

Trong object gửi `this.aiEngine.saveSettings({...})` (lines 456-467), thêm dòng sau line 467 (`deepseekModel: ...,`):

```javascript
        teachThenQuiz: document.getElementById('teach-then-quiz-toggle').checked,
```

Sau `this.aiEngine.clearCache();` (line 468), thêm dòng trước `this._hideApiKeyModal();`:

```javascript
      this._loadTeachThenQuizSetting();
```

- [x] **Step 11: Verify**

```bash
node --check js/app.js
```
Expected: exit 0

- [x] **Step 12: Commit**

```bash
git add js/app.js
git commit -m "feat: add quiz-now button after teaching with teachThenQuiz toggle"
```

---

### Task 5: `js/quiz.js` — Feature #1 Ôn tập trang yếu

**Files:**
- Modify: `js/quiz.js` (constructor ~6-38, _setupEvents ~40-52, onPageChanged ~75-86, onPdfLoaded ~89-93, _syncForPage ~96-105, _resetToEmpty ~108-119, _showResult ~252-260, + new methods)

**Rủi ro cần chú ý:**
- **Chụp oldScore TRƯỚC khi clear+generate**: `_reviewCurrentPage` phải đọc `quiz_scores` và lưu `oldScore` vào `_reviewReport` trước khi gọi `clearQuizForPage` (vì `_saveScore` sẽ đè score sau khi `_showResult`).
- **`onPageChanged` guard**: ĐẦU hàm `onPageChanged` phải có `if (this._reviewMode) return;` — nếu không, `_reviewCurrentPage` gọi `renderPage` sẽ trigger `onPageChanged` và reset quiz vừa sinh.
- **`_reviewCurrentPage` thứ tự**: `renderPage` → `clearQuizForPage` → reset state → `_generateForCurrentPage`.
- **`switchTab('chat')` khi đang review**: Huỷ review mode để tránh state rác.

- [x] **Step 1: Constructor — thêm element refs + review state (lines 6-38)**

Sau line 28 (`this.quizCloseBtn = document.getElementById('quiz-close-btn');`), thêm:

```javascript
    this.quizReviewBtn = document.getElementById('quiz-review-btn');
    this.quizReviewReport = document.getElementById('quiz-review-report');
    this.quizReviewList = document.getElementById('quiz-review-list');
    this.quizReviewDoneBtn = document.getElementById('quiz-review-done-btn');
```

Sau line 35 (`this._genSeq = 0;`), thêm:

```javascript
    this._reviewMode = false;
    this._weakPages = [];
    this._reviewIndex = -1;
    this._reviewReport = {};
```

- [x] **Step 2: `_setupEvents()` — wire review buttons (lines 40-52)**

Sau line 46 (`this.quizCloseBtn.addEventListener...`), thêm:

```javascript
    this.quizReviewBtn.addEventListener('click', () => this._startWeakPageReview());
    this.quizReviewDoneBtn.addEventListener('click', () => this._closeReviewReport());
```

- [x] **Step 3: Thêm method `_getWeakPages()`**

Thêm vào class (sau `_getQuizCount` ~line 125):

```javascript
  /** Trả về mảng pageNum tăng dần của các trang có điểm < 60% */
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
```

- [x] **Step 4: Thêm method `_updateReviewBtn()`**

```javascript
  /** Hiện/ẩn nút "Ôn tập trang yếu" */
  _updateReviewBtn() {
    if (!this.app.pdfViewer.isLoaded) {
      this.quizReviewBtn.classList.add('hidden');
      return;
    }
    const weak = this._getWeakPages();
    this.quizReviewBtn.classList.toggle('hidden', weak.length === 0);
  }
```

- [x] **Step 5: `_syncForPage()` — gọi update (line 96-105)**

Cuối method (sau `if/else` block lines 99-104, trước `}` đóng), thêm:

```javascript
    this._updateReviewBtn();
```

- [x] **Step 6: `onPdfLoaded()` — gọi update (lines 89-93)**

Sau line 92 (`this._syncForPage(...)`), thêm:

```javascript
    this._updateReviewBtn();
```

- [x] **Step 7: `_resetToEmpty()` — gọi update + ẩn report (lines 108-119)**

Sau line 118 (`this.quizEmptyText.textContent = ...;`), thêm:

```javascript
    this.quizReviewReport.classList.add('hidden');
    this._updateReviewBtn();
```

- [x] **Step 8: `onPageChanged()` — guard review mode (lines 75-86)**

**Ở ĐẦU method** (trước line 76 `this._syncForPage(pageNum);`), thêm:

```javascript
    if (this._reviewMode) return;
```

(Lưu ý: guard phải ở trước `_syncForPage` để tránh hiển thị sai điểm/tiêu đề khi đang review. `_reviewCurrentPage` đã tự gọi `_generateForCurrentPage` sau khi navigate.)

- [x] **Step 9: Thêm method `_startWeakPageReview()`**

```javascript
  /** Bắt đầu vòng lặp ôn tập các trang yếu */
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
```

- [x] **Step 10: Thêm method `_reviewCurrentPage()`**

```javascript
  /** Ôn tập trang yếu hiện tại trong danh sách */
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
```

- [x] **Step 11: `_showResult()` — trigger review advance (lines 252-260)**

Sau line 259 (`this._syncForPage(pageNum);`), thêm:

```javascript
    if (this._reviewMode) this._onReviewPageDone(pageNum);
```

- [x] **Step 12: Thêm method `_onReviewPageDone(pageNum)`**

```javascript
  /** Sau khi làm xong quiz cho 1 trang yếu */
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
```

- [x] **Step 13: Thêm method `_showReviewReport()`**

```javascript
  /** Hiển thị báo cáo kết quả ôn tập */
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
```

- [x] **Step 14: Thêm method `_closeReviewReport()`**

```javascript
  /** Đóng báo cáo review, reset về trạng thái trống */
  _closeReviewReport() {
    this._reviewMode = false;
    this._weakPages = [];
    this._reviewIndex = -1;
    this._reviewReport = {};
    this._resetToEmpty();
  }
```

- [x] **Step 15: `switchTab()` — huỷ review khi chuyển tab (lines 54-62)**

Sau line 58 (`const showQuiz = name === 'quiz';`), thêm:

```javascript
    if (!showQuiz && this._reviewMode) {
      this._reviewMode = false;
      this._weakPages = [];
      this._reviewIndex = -1;
      this._reviewReport = {};
    }
```

- [x] **Step 16: Verify**

```bash
node --check js/quiz.js
```
Expected: exit 0

- [x] **Step 17: Commit**

```bash
git add js/quiz.js
git commit -m "feat: add weak-page review loop with progress report"
```

---

### Task 6: Unit test — logic thuần có thể tách

**Files:**
- (Không tạo file mới nếu không tách được)

**Phân tích khả năng test:**
- `_getWeakPages()` — phụ thuộc `this.app._pdfFileName` (DOM/App state) + `localStorage` (browser env). Có thể test nếu export hàm helper `filterWeakPages(scores, threshold = 0.6)`.
- `_saveScore()` — phụ thuộc `this.app._pdfFileName` + `localStorage`. Không test được trong Node thuần.
- Format báo cáo `_showReviewReport` — gắn chặt với DOM (`this.quizReviewList.innerHTML`). Không test được nếu không tách hàm format.
- `onPageChanged` guard — phụ thuộc `this._reviewMode` (state nội bộ) + DOM (`quizArea.classList`). Không test được nếu không mock toàn bộ QuizManager.

**Kết luận:** Toàn bộ logic review gắn chặt với `localStorage` (browser-only), DOM element, và App state. Không có hàm nào thuần đủ để tách ra unit test độc lập trong Node. QA Playwright (Task 7) sẽ đảm nhiệm việc kiểm tra end-to-end.

**Verification:** Không có unit test mới. Regression vẫn phải pass (kiểm tra trong final verification wave).

---

### Task 7: QA Playwright — `tests/qa-weak-review.mjs`

**Files:**
- Create: `tests/qa-weak-review.mjs`

**Chiến lược:** Dùng Playwright `page.route()` chặn request Gemini API, tạo PDF nhiều trang bằng python3 fpdf, seed `quiz_scores` vào localStorage để giả lập 2 trang yếu + 1 trang đạt. Test flow: thấy nút review → click → quiz sinh cho trang yếu 1 → trả lời đúng hết → tự chuyển trang yếu 2 → trả lời đúng hết → báo cáo hiển thị → ẩn nút khi hết trang yếu.

**Các điểm kỹ thuật cần lưu ý:**
- Route pattern `**generativelanguage.googleapis.com/**` khớp URL Gemini thật (giống qa-quiz-count.mjs).
- Response shape: `data.candidates[0].content.parts[0].text` (khớp `_callGeminiAPI` line 900-906).
- `addInitScript` đặt `localStorage` với `provider: 'gemini'` + `apiKey: 'fake-key'` + seed `quiz_scores_qa-weak-review` với 3 trang.
- PDF thật 3 trang qua fpdf: mỗi trang có nội dung đủ để `pdfViewer.isLoaded = true`.
- `#quiz-retry-btn` click dùng `page.evaluate` (nút nằm trong `#quiz-result` hidden → Playwright không click được nếu đang ở question view).
- `page.selectOption` dùng `{ force: true }` cho `#quiz-count` (nằm trong `#quiz-empty` hidden khi đang làm quiz).
- Console error filter: nếu có lỗi PDF loading từ fpdf → lọc ra.
- Không dùng `window.app` (module-scoped — không tồn tại trên `window`).
- Tên file PDF: `/tmp/qa-weak-review.pdf` → filename trong app là `qa-weak-review`.

- [x] **Step 1: Tạo QA test script**

Tạo file `tests/qa-weak-review.mjs`:

```javascript
// QA: weak page review loop — network interception + real 3-page PDF via fpdf
// Chạy: node tests/qa-weak-review.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF 3 trang HỢP LỆ bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF()
# Page 1 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad - bc. Neu dinh thuc khac 0 thi ma tran kha nghich.')
# Page 2 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Khong gian vector', ln=1)
p.multi_cell(0, 8, 'Khong gian vector R^n la tap hop cac bo n so thuc. Co so chinh tac cua R^n gom n vector don vi e1, e2, ..., en.')
# Page 3 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: He phuong trinh', ln=1)
p.multi_cell(0, 8, 'He phuong trinh tuyen tinh Ax = b co nghiem duy nhat khi va chi khi ma tran A kha nghich. Phuong phap Gauss dung bien doi so cap de giai he.')
p.output('/tmp/qa-weak-review.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings + seed quiz_scores TRƯỚC khi page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
  // Seed: page 1 (2/3 = 66% -> >= 60%, NOT weak), page 2 (1/3 = 33% -> WEAK), page 3 (1/5 = 20% -> WEAK)
  localStorage.setItem('quiz_scores_qa-weak-review', JSON.stringify({
    '1': { best: 2, last: 2, lastTime: Date.now(), attempts: 1, total: 3 },
    '2': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 3 },
    '3': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 5 }
  }));
});

// --- Chặn request tới Gemini: trả về 3 câu hỏi (đáp án A) ---
let apiCalls = 0;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push({
      type: 'mcq',
      question: `Cau hoi ${i + 1} ve dai so tuyen tinh`,
      options: ['Dap an dung', 'Dap an sai A', 'Dap an sai B', 'Dap an sai C'],
      correct_index: 0,
      explanation: `Day la giai thich cho cau ${i + 1}`
    });
  }
  const payload = JSON.stringify({ questions });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: payload }] } }] })
  });
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// Upload PDF thật 3 trang
await page.setInputFiles('#pdf-input', '/tmp/qa-weak-review.pdf');
await page.waitForTimeout(2000);

// === TEST 1: Mở tab Quiz → nút "Ôn tập trang yếu" hiển thị ===
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(2000);
const reviewBtnVisible = await page.evaluate(() => {
  const btn = document.querySelector('#quiz-review-btn');
  return btn && !btn.classList.contains('hidden');
});
console.log('Nút Ôn tập trang yếu hiển thị:', reviewBtnVisible);
if (!reviewBtnVisible) throw new Error('TEST 1 FAIL: #quiz-review-btn không hiển thị (mong đợi 2 trang yếu)');

// === TEST 2: Click "Ôn tập trang yếu" → quiz sinh cho trang yếu đầu tiên (page 2) ===
await page.click('#quiz-review-btn', { force: true });
await page.waitForTimeout(2500);
let qText = await page.textContent('#quiz-question-text');
console.log('Review page 2 — question text:', qText);
if (!qText || !qText.includes('Câu 1/')) throw new Error(`TEST 2 FAIL: quiz không sinh cho trang yếu đầu tiên, got "${qText}"`);

// === TEST 3: Trả lời đúng hết 3 câu (đáp án A — index 0) ===
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('.quiz-option:not([disabled])', { timeout: 5000 });
  // Click đáp án A (index 0)
  await page.evaluate(() => {
    const btn = document.querySelector('.quiz-option[data-idx="0"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  if (i < 2) {
    // Click "Câu tiếp" (2 lần đầu)
    await page.click('#quiz-next-btn', { force: true });
    await page.waitForTimeout(300);
  }
}
// Click "Xem kết quả" (câu cuối)
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(2000);

// === TEST 4: Tự chuyển sang trang yếu kế tiếp (page 3) ===
qText = await page.textContent('#quiz-question-text');
console.log('Review page 3 — question text:', qText);
if (!qText || !qText.includes('Câu 1/')) throw new Error(`TEST 4 FAIL: không tự chuyển sang trang yếu kế tiếp, got "${qText}"`);

// === TEST 5: Trả lời đúng hết → báo cáo hiển thị ===
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('.quiz-option:not([disabled])', { timeout: 5000 });
  await page.evaluate(() => {
    const btn = document.querySelector('.quiz-option[data-idx="0"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  if (i < 2) {
    await page.click('#quiz-next-btn', { force: true });
    await page.waitForTimeout(300);
  }
}
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(2000);

// === TEST 6: Báo cáo hiển thị — có "Trang 2" và "Trang 3" với ✅ ===
const reportHtml = await page.evaluate(() => {
  const el = document.querySelector('#quiz-review-list');
  return el ? el.innerHTML : '';
});
console.log('Báo cáo review:', reportHtml);
if (!reportHtml.includes('Trang 2')) throw new Error('TEST 6 FAIL: báo cáo không chứa "Trang 2"');
if (!reportHtml.includes('Trang 3')) throw new Error('TEST 6 FAIL: báo cáo không chứa "Trang 3"');
if (!reportHtml.includes('✅')) throw new Error('TEST 6 FAIL: báo cáo không có ✅ (mong đợi điểm tất cả đạt >= 60%)');

// === TEST 7: Đóng báo cáo → nút "Ôn tập trang yếu" ẩn (vì tất cả đã đạt) ===
await page.click('#quiz-review-done-btn', { force: true });
await page.waitForTimeout(500);
const reviewBtnHidden = await page.evaluate(() => {
  const btn = document.querySelector('#quiz-review-btn');
  return btn && btn.classList.contains('hidden');
});
console.log('Sau review, nút Ôn tập ẩn:', reviewBtnHidden);
if (!reviewBtnHidden) throw new Error('TEST 7 FAIL: #quiz-review-btn vẫn hiển thị sau khi tất cả trang đã đạt');

if (errors.length > 0) {
  console.log('ERRORS TRINH DUYET:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Co loi console/pageerror');
}

console.log('✅ QA weak review PASS');
await browser.close();
```

- [x] **Step 2: Chạy QA test**

Start server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
```

Run:
```bash
node tests/qa-weak-review.mjs
```
Expected: `✅ QA weak review PASS`, exit 0

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **Step 3: Commit**

```bash
git add tests/qa-weak-review.mjs
git commit -m "test: add QA for weak-page review loop"
```

---

### Task 8: README + plan checkboxes

**Files:**
- Modify: `README.md` (dòng quiz features ~15)

- [x] **Step 1: Sửa README**

Line 15 hiện tại:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo câu hỏi trắc nghiệm bám sát nội dung trang (3/5/10 câu tuỳ chọn), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
```

Sửa thành:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo câu hỏi trắc nghiệm bám sát nội dung trang (3/5/10 câu tuỳ chọn), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang, ôn tập trang yếu
- 🔁 **Learning loop** — Kiểm tra ngay sau khi giảng + tự động ôn tập các trang có điểm thấp (< 60%)
```

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with learning loop features"
```

---

## Verification tổng (final wave)

- [x] **1. `node --check` tất cả file JS sửa đổi:**

```bash
node --check js/ai-engine.js && node --check js/app.js && node --check js/quiz.js
```
Expected: exit 0

- [x] **2. Chạy regression tests cũ:**

```bash
node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs
```
Expected: `✅ title-detect: tất cả test pass` + `✅ quiz-validate: tất cả test pass`, exit 0

- [x] **3. Chạy QA quiz count (đảm bảo không regression):**

```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
node tests/qa-quiz-count.mjs
```
Expected: `✅ QA quiz count PASS`, exit 0
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **4. Chạy QA weak review:**

```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
node tests/qa-weak-review.mjs
```
Expected: `✅ QA weak review PASS`, exit 0
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **5. Kiểm tra git status:**

```bash
git status
```
Expected: sạch (ngoài `.omo/` và `docs/superpowers/plans/` nếu plan file vẫn unstaged).

- [x] **6. Liệt kê commits đã tạo:**

```bash
git log --oneline -9
```
Expected: 9 commits theo thứ tự:
1. `docs: update README with learning loop features`
2. `test: add QA for weak-page review loop`
3. (Task 6 skip — no unit test)
4. `feat: add weak-page review loop with progress report`
5. `feat: add quiz-now button after teaching with teachThenQuiz toggle`
6. `feat: add styles for quiz-now-btn and review report`
7. `feat: add quiz-now-btn, teach-then-quiz toggle, and review UI elements`
8. `feat: add teachThenQuiz setting to AIEngine`
9. `docs: add learning loop review plan (Plan A)`

---

## Self-Review

**1. Spec coverage:**

| Yêu cầu | Coverage |
|---------|----------|
| Feature #6.1: Nút "📝 Kiểm tra ngay" sau giảng | ✓ — Task 4 Step 6-7: `_justTaught` flag + `_updateVoiceStatus` 'done' case |
| Feature #6.2: KHÔNG tự chuyển tab | ✓ — `_onQuizNowClick` switch tab chỉ khi user click |
| Feature #6.3: Bấm nút → chuyển tab Quiz + sinh quiz | ✓ — Task 4 Step 5: `switchTab('quiz')` + `_generateForCurrentPage` |
| Feature #6.4: Toggle `teachThenQuiz` mặc định BẬT | ✓ — Task 1: `ai-engine.js`, Task 4 Step 9-10: modal đọc/ghi toggle |
| Feature #1.5: Trang yếu = điểm < 60% | ✓ — Task 5 Step 3: `_getWeakPages` filter `score.best/(score.total \|\| 3) < 0.6` |
| Feature #1.6: Nút "📚 Ôn tập trang yếu" | ✓ — Task 2 Step 3: `#quiz-review-btn` trong `#quiz-header` |
| Feature #1.7: Review lần lượt từng trang yếu | ✓ — Task 5 Step 9-12: `_startWeakPageReview` → `_reviewCurrentPage` → `_onReviewPageDone` |
| Feature #1.8: Báo cáo kết thúc review | ✓ — Task 5 Step 13: `_showReviewReport` render `.review-item` với ✅/❌ |
| Feature #1.9: Điểm review lưu đè quiz_scores | ✓ — `_saveScore` đã có logic lưu đè, không cần sửa |
| Feature #1.10: Bỏ qua title slide | ✓ — không implement (phức tạp async, spec ghi chú "an toàn — vẫn cho review") |
| State 'done' từ chat không hiện nút | ✓ — Task 4 Step 7: `_justTaught` flag, chỉ hiện khi set trong `onEnd` |
| onEnd gọi `_updateVoiceStatus` sau `_justTaught = true` | ✓ — Task 4 Step 6: thứ tự chính xác |

**2. Placeholder scan:** Không có TBD/TODO/"thêm xử lý" — mọi bước đều có code đầy đủ.

**3. Type consistency:**
- `teachThenQuiz` trong `ai_settings` localStorage (Task 1) ↔ `_loadTeachThenQuizSetting` đọc cùng key (Task 4 Step 2) — khớp.
- `#quiz-now-btn` ID trong HTML (Task 2) ↔ `document.getElementById('quiz-now-btn')` (Task 4 Step 4,7,8) — khớp.
- `#quiz-review-btn` ID trong HTML (Task 2) ↔ `this.quizReviewBtn` ref (Task 5 Step 1) — khớp.
- `#quiz-review-report`, `#quiz-review-list`, `#quiz-review-done-btn` — khớp giữa HTML (Task 2) và QuizManager refs (Task 5 Step 1).
- `_getWeakPages` trả về `number[]` → `_startWeakPageReview` gán `this._weakPages` → `_reviewCurrentPage` dùng `this._weakPages[this._reviewIndex]` — khớp.
- `_reviewReport[pageNum]` shape: `{ oldBest, oldTotal }` (Step 10 set, Step 13 read) → `{ newBest, newTotal }` (Step 12 set, Step 13 read) — khớp.
- `_onReviewPageDone` dùng `this.correctCount` và `this.questions.length` — giá trị được set trong `_generateForCurrentPage` flow.

**4. Edge cases handled:**
- **Chat done cũng trigger 'done'**: `_justTaught` chỉ set `true` trong `onEnd`, không set trong `_handleChatMessage` → chat done không hiện nút.
- **onPageChanged trong review mode**: Guard `if (this._reviewMode) return;` ở ĐẦU method (Step 8) → renderPage không reset quiz vừa sinh.
- **oldScore chụp trước clear**: `_reviewCurrentPage` lưu `oldScore` (Step 10) → `clearQuizForPage` → `_generateForCurrentPage`. Score cũ an toàn trong `_reviewReport`.
- **Tắt tab Quiz giữa review**: `switchTab('chat')` huỷ `_reviewMode` và reset state (Step 15).
- **Nút "Làm lại" trong review**: `_retry` vẫn hoạt động bình thường — xoá cache + sinh lại cho trang yếu hiện tại.
- **Quiz count dropdown**: Trong review mode, `_getQuizCount` vẫn đọc dropdown hiện tại — nhất quán với hành vi B (số câu do người dùng chọn).
- **clearQuizForPage xoá prefix**: Hiện tại đã dùng `startsWith(prefix)` (ai-engine.js line 590-594) — không cần sửa.
- **Record cũ không có `total`**: `_getWeakPages` dùng `score.total || 3` — an toàn với record cũ.
- **QA test seed scores**: Dùng filename `qa-weak-review` (từ `/tmp/qa-weak-review.pdf`) — khớp key `quiz_scores_qa-weak-review`.
- **QA test multiple pages**: PDF 3 trang fpdf — mỗi trang có tiêu đề + nội dung đủ để không bị detect là title-only.
- **QA test auto-advance**: Sau `_showResult` → `_onReviewPageDone` → `_reviewIndex++` → `_reviewCurrentPage`. QA test dùng `waitForTimeout` để chờ quiz sinh cho trang tiếp theo.

**Ghi chú triển khai:**
- Không đổi server.py, không thêm dependency.
- `_showResult` đã gọi `_saveScore` (line 254) → điểm review tự động lưu đè `quiz_scores`.
- `switchTab` đã có logic huỷ review mode (Step 15).
- QA test dùng Playwright network interception + PDF thật fpdf — không dùng `window.app` hay dummy PDF.
- Toàn bộ element mới trong HTML sử dụng class CSS có sẵn (`.hidden`, `.voice-btn`, `.btn-ghost`, `.btn-primary`) — không cần thêm class mới ngoài `.quiz-now-btn` và `.review-item`.
