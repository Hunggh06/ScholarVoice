# Flashcards: thẻ học thuật ngữ AI (Plan B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Tab mới "🃏 Thẻ học" trong right panel, giữa Chat và Quiz. AI trích thuật ngữ → định nghĩa từ nội dung trang hiện tại. Người dùng lật thẻ, nghe đọc bằng TTS, tự đánh giá ✅ Biết / 🔄 Ôn lại. Ôn lại → thẻ quay lại xoay vòng; hết thẻ → màn hình hoàn thành. Cache theo trang + provider + số thẻ. Nút "Làm mới" xoá cache và sinh thẻ mới.

**Architecture:** `AIEngine` thêm `flashcardCache` (Map mới), `generateFlashcards(pageNum, pageText, imageBase64, count=5)` (cache key `flash_<page>_<provider>_<count>`), `validateFlashcards(raw)` (export), `clearFlashcardsForPage(pageNum)`. Sửa `clearCache()` + `saveSettings()` để clear `flashcardCache`. File mới `js/flashcards.js` — class `FlashcardsManager` pattern theo `QuizManager`: constructor nhận `app`, query DOM, state (cards, mainQueue, reviewQueue, currentCard, flipped, _genSeq, _generating), race guard `_genSeq`/`genId`, switchTab 3-way. `app.js` import + khởi tạo. HTML: `#tab-flash` giữa `#tab-chat` và `#tab-quiz` + `#flash-area` block sau `#quiz-area`. CSS: tái sử dụng quiz styles + thêm flash-card, front/back, speak-btn, actions, progress. **3-way switchTab:** QuizManager.switchTab thêm 1 dòng ẩn `#flash-area`; FlashcardsManager.switchTab ẩn `chatArea` + `quizArea` (dùng `document.getElementById` trực tiếp — không import vòng). KHÔNG đổi `server.py`, không thêm dependency.

**Tech Stack:** Vanilla JS ES modules, localStorage (ai_settings), Node v20 (unit test `node:assert`), Playwright (QA network interception), Web Speech API (giữ nguyên).

**Spec:** `docs/superpowers/specs/2026-08-01-flashcards-design.md` (commit `550ba81`)

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

### Task 1: `js/ai-engine.js` — `flashcardCache`, `generateFlashcards`, `validateFlashcards`, `clearFlashcardsForPage`

**Files:**
- Modify: `js/ai-engine.js` (constructor ~7-44, clearCache ~601-606, saveSettings ~48-86)

**Rủi ro cần chú ý:**
- `flashcardCache` phải là Map mới, KHÔNG dùng chung `quizCache` — cache key dùng prefix `flash_` khác với `quiz_` để tránh xung đột và dễ clear riêng.
- `clearCache()` và `saveSettings()` (khi đổi provider) phải clear cả `flashcardCache`.
- `validateFlashcards` là export function (giống `validateQuizQuestions`), test được trong Node.

- [x] **Step 1: Constructor — thêm `this.flashcardCache` (sau line 33)**

Hiện tại line 32-33:
```javascript
    // Cache quiz theo trang: key `quiz_<page>_<provider>`
    this.quizCache = new Map();
```

Sau line 33, thêm:
```javascript
    this.flashcardCache = new Map();
```

- [x] **Step 2: Thêm method `generateFlashcards(pageNum, pageText, imageBase64, count = 5)`**

Thêm vào class (sau `generateQuiz` ~line 591, trước `clearQuizForPage` ~line 593):

```javascript
  /**
   * Tạo flashcards cho trang hiện tại
   * @param {number} pageNum
   * @param {string} pageText - text đã trích xuất của trang
   * @param {string|null} imageBase64 - ảnh trang (provider có vision thì dùng)
   * @param {number} [count=5] - số thẻ (3/5/10)
   * @returns {Promise<Array>} mảng [{term, definition}]
   */
  async generateFlashcards(pageNum, pageText, imageBase64, count = 5) {
    const n = [3, 5, 10].includes(count) ? count : 5;
    const cacheKey = `flash_${pageNum}_${this.provider}_${n}`;
    const cached = this.flashcardCache.get(cacheKey);
    if (cached) return cached;

    if (!pageText || !pageText.trim()) {
      throw new Error('Trang này không có nội dung chữ để tạo thẻ học.');
    }

    const systemPrompt = `Bạn là giảng viên tạo thẻ học (flashcards) để giúp sinh viên ôn tập.
Trích CHÍNH XÁC ${n} thuật ngữ hoặc khái niệm quan trọng từ nội dung trang tài liệu.
Với mỗi thuật ngữ, viết định nghĩa ngắn gọn (1-2 câu), dễ hiểu.
TUYỆT ĐỐI CHỈ dùng kiến thức có trong nội dung trang, không bịa thêm.
Trả về JSON duy nhất, không thêm bất kỳ text nào ngoài JSON:
{
  "cards": [
    {"term": "Thuật ngữ 1", "definition": "Định nghĩa ngắn gọn bằng tiếng Việt."},
    {"term": "Thuật ngữ 2", "definition": "Định nghĩa ngắn gọn bằng tiếng Việt."}
  ]
}
NGÔN NGỮ: Luôn dùng TIẾNG VIỆT.
definition phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.`;

    const userPrompt = `Nội dung trang tài liệu (dòng bắt đầu bằng ## là tiêu đề, dòng trống ngăn cách các phần):

${pageText}

Hãy tạo flashcards theo đúng định dạng JSON yêu cầu ở trên.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    const cards = validateFlashcards(rawResponse);
    if (cards.length === 0) {
      throw new Error('AI không tạo được thẻ học hợp lệ. Bấm 🔄 để thử lại.');
    }

    this.flashcardCache.set(cacheKey, cards);
    return cards;
  }
```

- [x] **Step 3: Thêm export function `validateFlashcards(raw)`**

Thêm vào cuối file (sau `validateQuizQuestions` ~line 980, trước dòng kết thúc):

```javascript
/**
 * Validate JSON response từ AI → mảng [{term, definition}]
 * Pattern theo validateQuizQuestions
 */
export function validateFlashcards(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Thử lấy block JSON từ markdown ```json ... ```
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try { parsed = JSON.parse(m[1]); } catch { /* fallback */ }
    }
  }
  if (!parsed) {
    // Fallback cuối: tìm object có "cards"
    const m2 = raw.match(/\{[\s\S]*"cards"[\s\S]*\}/);
    if (m2) {
      try { parsed = JSON.parse(m2[0]); } catch { /* fallback */ }
    }
  }

  const list = parsed && Array.isArray(parsed.cards) ? parsed.cards : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const term = typeof c.term === 'string' ? c.term.trim() : '';
    const definition = typeof c.definition === 'string' ? c.definition.trim() : '';
    if (!term || !definition) continue;
    out.push({
      term,
      definition: definition.length > 200 ? definition.substring(0, 200) : definition
    });
  }
  return out;
}
```

- [x] **Step 4: Thêm method `clearFlashcardsForPage(pageNum)`**

Thêm vào class (sau `clearQuizForPage` ~line 598):

```javascript
  /** Xoá flashcard cache của một trang theo prefix (mọi số thẻ) — dùng cho nút "Làm mới" */
  clearFlashcardsForPage(pageNum) {
    const prefix = `flash_${pageNum}_${this.provider}_`;
    for (const key of this.flashcardCache.keys()) {
      if (key.startsWith(prefix)) this.flashcardCache.delete(key);
    }
  }
```

- [x] **Step 5: Sửa `clearCache()` — clear `flashcardCache` (line 601-606)**

Sửa — thêm dòng `this.flashcardCache.clear();` sau `this.quizCache.clear();`:

Sau dòng `this.quizCache.clear();`, thêm:
```javascript
    this.flashcardCache.clear();
```

Code kết quả:
```javascript
  clearCache() {
    this.pageCache.clear();
    this.quizCache.clear();
    this.flashcardCache.clear();
    this.docContext = [];
    this.clearChatHistory();
  }
```

- [x] **Step 6: Sửa `saveSettings()` — clear `flashcardCache` khi đổi provider (lines 79-85)**

Sau dòng `this.quizCache.clear();` (line 82), thêm:
```javascript
      this.flashcardCache.clear();
```

Code kết quả (block `if (oldProvider !== this.provider)`):
```javascript
    if (oldProvider !== this.provider) {
      this.pageCache.clear();
      this.quizCache.clear();
      this.flashcardCache.clear();
      this.docContext = [];
      this.clearChatHistory();
    }
```

- [x] **Step 7: Verify**

```bash
node --check js/ai-engine.js
```
Expected: exit 0

- [x] **Step 8: Commit**

```bash
git add js/ai-engine.js
git commit -m "feat: add generateFlashcards, validateFlashcards, and flashcardCache to AIEngine"
```

---

### Task 2: `index.html` — Tab thứ 3 + flashcard area

**Files:**
- Modify: `index.html` (right-tabs ~269-272, quiz-area ~291-334, quiz-area close ~334-335)

Kiểm tra vị trí hiện tại:
| Insert | Sau dòng | Vị trí cần chèn |
|--------|----------|-----------------|
| `#tab-flash` | 270 (`#tab-chat`) | Giữa `<button id="tab-chat" ...>` và `<button id="tab-quiz" ...>` |
| `#flash-area` | 334 (`</div>` của `#quiz-body`) | Sau `</div>` đóng `#quiz-body`, trước `</div>` đóng `#right-panel` |

- [x] **Step 1: Thêm `#tab-flash` trong `#right-tabs` (giữa line 270 và 271)**

Sau dòng 270 (`<button id="tab-chat" class="right-tab active" data-tab="chat">💬 Hỏi đáp</button>`), thêm:

```html
        <button id="tab-flash" class="right-tab" data-tab="flash">🃏 Thẻ học</button>
```

- [x] **Step 2: Thêm `#flash-area` block (sau line 334)**

Sau dòng 334 (`</div>` đóng `#quiz-body`), thêm:

```html

      <div id="flash-area" class="hidden">
        <div id="flash-header">
          <span id="flash-title">🃏 Thẻ học</span>
        </div>
        <div id="flash-body">
          <div id="flash-empty" class="welcome-message">
            <div class="welcome-icon">🃏</div>
            <p id="flash-empty-text">Tải PDF lên để tạo thẻ học cho trang đang xem.</p>
            <div class="quiz-start-controls">
              <label class="quiz-count-label" for="flash-count">Số thẻ</label>
              <select id="flash-count">
                <option value="3">3</option>
                <option value="5" selected>5</option>
                <option value="10">10</option>
              </select>
              <button id="flash-start-btn" class="btn-primary" disabled>🔄 Tạo thẻ học cho trang này</button>
            </div>
          </div>
          <div id="flash-loading" class="hidden">
            <div class="spinner"></div>
            <p>Đang tạo thẻ học...</p>
          </div>
          <div id="flash-card-view" class="hidden">
            <div id="flash-progress"></div>
            <div id="flash-card">
              <div id="flash-card-front"></div>
              <div id="flash-card-back" class="hidden"></div>
            </div>
            <button id="flash-speak-btn" class="btn-ghost" title="Nghe đọc">🔊</button>
            <div id="flash-card-actions">
              <button id="flash-know-btn" class="btn-primary">✅ Biết</button>
              <button id="flash-review-btn" class="btn-ghost">🔄 Ôn lại</button>
            </div>
          </div>
          <div id="flash-result" class="hidden">
            <div id="flash-result-text">🎉 Hoàn thành!</div>
            <div style="display:flex;gap:10px;">
              <button id="flash-retry-btn" class="btn-primary">🔄 Học lại</button>
              <button id="flash-refresh-btn" class="btn-ghost">🆕 Làm mới (thẻ mới)</button>
            </div>
          </div>
        </div>
      </div>
```

- [x] **Step 3: Verify**

Start server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
```

Kiểm tra các ID mới tồn tại trong HTML:
```bash
curl -s http://localhost:8080/ | grep -c 'id="tab-flash"'          # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-area"'         # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-header"'       # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-body"'         # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-empty"'        # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-count"'        # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-start-btn"'    # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-loading"'      # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-card-view"'    # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-progress"'     # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-card"'         # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-speak-btn"'    # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-know-btn"'     # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-review-btn"'   # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-result"'       # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-retry-btn"'    # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-refresh-btn"'  # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-card-front"'   # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-card-back"'    # Expected: 1
curl -s http://localhost:8080/ | grep -c 'id="flash-card-actions"' # Expected: 1
```

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add flash tab and flashcard area HTML elements"
```

---

### Task 3: `css/style.css` — Style cho flashcards

**Files:**
- Modify: `css/style.css` (sau line 631 — cuối file)

- [x] **Step 1: Thêm style flashcards vào cuối file (sau line 631)**

Sau dòng 631 (`.review-item.fail { ... }`), thêm:

```css

/* ============================================================
   FLASHCARDS
   ============================================================ */
#flash-area { flex:1; display:flex; flex-direction:column; overflow:hidden; position:relative; }
#flash-header {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 20px; border-bottom:1px solid rgba(255,255,255,0.04); flex-shrink:0;
}
#flash-title { font-size:0.85rem; font-weight:600; color:var(--text-primary); }
#flash-body { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; }
#flash-body .spinner { margin-bottom:12px; }
#flash-body #flash-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; flex:1; color:var(--text-secondary); font-size:0.9rem; }

#flash-card-view { display:flex; flex-direction:column; align-items:center; gap:16px; flex:1; }
#flash-progress { font-size:0.8rem; color:var(--text-secondary); text-align:center; margin-bottom:4px; }

#flash-card {
  width:100%; min-height:200px;
  background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);
  border-radius:var(--radius-sm); padding:24px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  cursor:pointer; transition:all var(--transition); text-align:center;
}
#flash-card:hover { background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.15); }

#flash-card-front { font-size:1.3rem; font-weight:600; color:var(--text-primary); line-height:1.5; }
#flash-card-back {
  font-size:0.95rem; color:var(--text-secondary); line-height:1.6;
}
#flash-card.flipped #flash-card-front { display:none; }
#flash-card.flipped #flash-card-back { display:block; }

#flash-card-back { display:none; }

#flash-speak-btn {
  width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
  color:var(--text-primary); font-size:1rem; cursor:pointer; transition:all var(--transition);
}
#flash-speak-btn:hover { background:rgba(0,242,254,0.12); border-color:var(--accent); color:var(--accent); box-shadow:0 0 12px var(--accent-glow); }

#flash-card-actions { display:flex; gap:10px; justify-content:center; margin-top:8px; }

#flash-result { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; flex:1; text-align:center; }
#flash-result-text { font-size:1.15rem; color:var(--text-primary); line-height:1.6; }

#flash-empty .btn-primary { margin-top:8px; }
```

- [x] **Step 2: Verify**

Mở index.html trong browser kiểm tra thủ công hoặc QA Playwright (sẽ cover trong Task 7).
Không có lệnh `node --check` cho CSS.

- [x] **Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: add flashcards styles (card, flip, actions, progress)"
```

---

### Task 4: `js/flashcards.js` (FILE MỚI) — Class `FlashcardsManager`

**Files:**
- Create: `js/flashcards.js`

**Rủi ro cần chú ý:**
- **3-way switchTab:** Hiện tại `QuizManager.switchTab` chỉ toggle chat/quiz (binary). Cần thêm 1 dòng trong `QuizManager.switchTab` để ẩn `#flash-area` khi chuyển sang chat/quiz (Task 4 Step 13). `FlashcardsManager.switchTab` ẩn `chatArea` + `quizArea` (dùng `document.getElementById` trực tiếp — không import vòng).
- **Race guard:** Dùng pattern `_genSeq`/`genId` đã chứng minh trong QuizManager — không dùng naive `_generating = false` trong `onPageChanged`.
- **TTS:** Gọi `this.app.ttsEngine.speak(this.app._cleanVoiceText(text))` — pattern QuizManager `_speak` (quiz.js:401-403).
- **Review queue xoay vòng:** Thẻ 🔄 push vào `reviewQueue`; khi `mainQueue` hết → `mainQueue = [...reviewQueue]`, `reviewQueue = []`, render lại.
- **`_retry` KHÔNG gọi AI** (dùng cards cũ), **`_refresh` GỌI AI** (clear cache trước).

- [x] **Step 1: Tạo file `js/flashcards.js`**

```javascript
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
```

- [x] **Step 2: Verify**

```bash
node --check js/flashcards.js
```
Expected: exit 0

- [x] **Step 3: Commit**

```bash
git add js/flashcards.js
git commit -m "feat: add FlashcardsManager with 3-way tab switch, race guard, review queue"
```

- [x] **Step 4: Sửa `QuizManager.switchTab` — ẩn `#flash-area` khi chuyển sang chat/quiz**

**Files:**
- Modify: `js/quiz.js` (switchTab ~66-79)

**Lý do:** Khi FlashcardsManager hiển thị `#flash-area`, nếu user click tab Chat/Quiz, QuizManager.switchTab cần ẩn `#flash-area` để không hiển thị 2 area cùng lúc.

Trong `QuizManager.switchTab`, sau line 74 (`this.chatArea.classList.toggle('hidden', showQuiz);`), thêm:

```javascript
    const flashArea = document.getElementById('flash-area');
    if (flashArea) flashArea.classList.add('hidden');
    const tabFlash = document.getElementById('tab-flash');
    if (tabFlash) tabFlash.classList.remove('active');
```

Code kết quả (switchTab method):
```javascript
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
```

- [x] **Step 5: Verify sau khi sửa QuizManager**

```bash
node --check js/quiz.js
```
Expected: exit 0

- [x] **Step 6: Commit (gộp vào commit của Task 4)**

```bash
git add js/quiz.js
git commit -m "feat: add 3-way tab switch coordination in QuizManager.switchTab"
```

---

### Task 5: `js/app.js` — Import + khởi tạo FlashcardsManager + wire lifecycle

**Files:**
- Modify: `js/app.js` (imports ~5-10, constructor ~12-19, onPdfLoaded ~563, onPageChanged ~689)

- [x] **Step 1: Import FlashcardsManager (sau line 9)**

Sau dòng 9 (`import { QuizManager } from './quiz.js';`), thêm:

```javascript
import { FlashcardsManager } from './flashcards.js';
```

- [x] **Step 2: Constructor — khởi tạo (sau line 18)**

Sau dòng 18 (`this.quizManager = new QuizManager(this);`), thêm:

```javascript
    this.flashcardsManager = new FlashcardsManager(this);
```

- [x] **Step 3: `onPdfLoaded` — gọi `flashcardsManager.onPdfLoaded()` (sau line 563)**

Sau dòng 563 (`this.quizManager.onPdfLoaded();`), thêm:

```javascript
      this.flashcardsManager.onPdfLoaded();
```

- [x] **Step 4: `_navigatePage` — gọi `flashcardsManager.onPageChanged()` (sau line 689)**

Sau dòng 689 (`this.quizManager.onPageChanged(this.pdfViewer.currentPage);`), thêm:

```javascript
      this.flashcardsManager.onPageChanged(this.pdfViewer.currentPage);
```

- [x] **Step 5: Verify**

```bash
node --check js/app.js
```
Expected: exit 0

- [x] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: integrate FlashcardsManager into App lifecycle"
```

---

### Task 6: Unit test `tests/flashcards-validate.test.mjs`

**Files:**
- Create: `tests/flashcards-validate.test.mjs`

- [x] **Step 1: Tạo unit test**

```javascript
import assert from 'node:assert';
import { validateFlashcards } from '../js/ai-engine.js';

// JSON hợp lệ: 5 cặp term-definition
const good = JSON.stringify({
  cards: [
    { term: 'Định thức', definition: 'Định thức của ma trận vuông cấp 2 A = [[a,b],[c,d]] được tính là ad - bc.' },
    { term: 'Ma trận đơn vị', definition: 'Ma trận vuông có các phần tử trên đường chéo chính bằng 1, còn lại bằng 0.' },
    { term: 'Vector', definition: 'Đại lượng có hướng và độ lớn.' },
    { term: 'Hàm số', definition: 'Quy tắc gán mỗi phần tử của tập A với duy nhất một phần tử của tập B.' },
    { term: 'Đạo hàm', definition: 'Giới hạn của tỉ số giữa số gia của hàm số và số gia của đối số.' }
  ]
});
let cards = validateFlashcards(good);
assert.strictEqual(cards.length, 5, 'giữ đủ 5 thẻ');
assert.strictEqual(cards[0].term, 'Định thức');
assert.strictEqual(cards[0].definition.startsWith('Định thức của'), true);
assert.strictEqual(cards[1].term, 'Ma trận đơn vị');

// JSON bị bọc trong markdown ```json ... ```
const wrapped = '```json\n' + good + '\n```';
assert.strictEqual(validateFlashcards(wrapped).length, 5, 'parse được JSON trong markdown block');

// JSON lỏng: thiếu term → câu đó bị loại
const missingTerm = JSON.stringify({ cards: [
  { term: '', definition: 'Không có term.' },
  { term: 'Hợp lệ', definition: 'Có term và definition.' }
]});
cards = validateFlashcards(missingTerm);
assert.strictEqual(cards.length, 1, 'loại thẻ không có term');
assert.strictEqual(cards[0].term, 'Hợp lệ');

// JSON lỏng: thiếu definition → câu đó bị loại
const missingDef = JSON.stringify({ cards: [
  { term: 'Không có def', definition: '' },
  { term: 'Có đủ', definition: 'Định nghĩa đầy đủ.' }
]});
cards = validateFlashcards(missingDef);
assert.strictEqual(cards.length, 1, 'loại thẻ không có definition');

// Definition > 200 ký tự → bị cắt
const longDef = JSON.stringify({ cards: [
  { term: 'Dài', definition: 'A'.repeat(250) }
]});
cards = validateFlashcards(longDef);
assert.strictEqual(cards.length, 1, 'giữ thẻ có definition dài (đã cắt)');
assert.strictEqual(cards[0].definition.length, 200, 'definition bị cắt về 200 ký tự');

// Trim term và definition
const hasWhitespace = JSON.stringify({ cards: [
  { term: '  Thuật ngữ   ', definition: '   Định nghĩa có khoảng trắng.   ' }
]});
cards = validateFlashcards(hasWhitespace);
assert.strictEqual(cards[0].term, 'Thuật ngữ', 'trim term');
assert.strictEqual(cards[0].definition, 'Định nghĩa có khoảng trắng.', 'trim definition');

// Không phải JSON → mảng rỗng
assert.strictEqual(validateFlashcards('không phải json').length, 0);
assert.strictEqual(validateFlashcards(null).length, 0);
assert.strictEqual(validateFlashcards(undefined).length, 0);
assert.strictEqual(validateFlashcards('').length, 0);

// Fallback regex block JSON
const regexBlock = 'Đây là text bên ngoài {"cards": [{"term": "X", "definition": "Y"}]} và text khác';
cards = validateFlashcards(regexBlock);
assert.strictEqual(cards.length, 1, 'fallback regex JSON block có "cards"');
assert.strictEqual(cards[0].term, 'X');

console.log('✅ flashcards-validate: tất cả test pass');
```

- [x] **Step 2: Chạy test**

```bash
node tests/flashcards-validate.test.mjs
```
Expected: `✅ flashcards-validate: tất cả test pass`, exit 0

- [x] **Step 3: Commit**

```bash
git add tests/flashcards-validate.test.mjs
git commit -m "test: add unit tests for validateFlashcards"
```

---

### Task 7: QA Playwright — `tests/qa-flashcards.mjs`

**Files:**
- Create: `tests/qa-flashcards.mjs`

**Chiến lược:** Dùng Playwright `page.route()` chặn request Gemini API, trả về 5 cards JSON `{cards:[{term,definition}]}`. PDF thật 1 trang qua fpdf. Test flow: upload PDF → tab flash → start → 5 thẻ render → flip → speak → review → know hết → hoàn thành → retry không gọi API → refresh gọi API.

**Các điểm kỹ thuật cần lưu ý (kế thừa từ qa-quiz-count.mjs + qa-weak-review.mjs):**
- Route pattern `**generativelanguage.googleapis.com/**` khớp URL Gemini thật.
- Response shape: `data.candidates[0].content.parts[0].text` (khớp `_callGeminiAPI`).
- `addInitScript` đặt `localStorage` với `provider: 'gemini'` + `apiKey: 'fake-key'`.
- PDF thật qua fpdf 2.8.7: 1 trang có nội dung đầy đủ.
- Click nút dùng `page.evaluate` khi nút nằm trong element hidden (Playwright không click được).
- `page.selectOption` dùng `{ force: true }` cho dropdown trong area hidden.
- Không dùng `window.app` (module-scoped — không tồn tại trên `window`).
- Tên file PDF: `/tmp/qa-flashcards.pdf` → filename trong app là `qa-flashcards.pdf` (app dùng `file.name`).

- [x] **Step 1: Tạo QA test script**

```javascript
// QA: flashcards flow — network interception + real 1-page PDF via fpdf
// Chạy: node tests/qa-flashcards.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF 1 trang thật bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF(); p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Co ban', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad-bc. Neu dinh thuc khac 0 thi ma tran kha nghich. Vector la dai luong co huong va do lon.')
p.output('/tmp/qa-flashcards.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings TRƯỚC khi page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
});

// --- Chặn request tới Gemini: trả về 5 cards ---
let apiCalls = 0;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const cards = [];
  const terms = ['Định thức', 'Ma trận khả nghịch', 'Vector', 'Hàm số', 'Đạo hàm'];
  for (let i = 0; i < 5; i++) {
    cards.push({
      term: terms[i],
      definition: `Định nghĩa của ${terms[i]} trong đại số tuyến tính.`
    });
  }
  const payload = JSON.stringify({ cards });
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

// Upload PDF thật
await page.setInputFiles('#pdf-input', '/tmp/qa-flashcards.pdf');
await page.waitForTimeout(2000);

// === TEST (a): Mở tab flash → nút "Tạo thẻ học" enabled ===
await page.click('#tab-flash', { force: true, timeout: 10000 });
await page.waitForTimeout(1000);
const startEnabled = await page.evaluate(() => {
  const btn = document.querySelector('#flash-start-btn');
  return btn && !btn.disabled;
});
console.log('Nút Tạo thẻ học enabled:', startEnabled);
if (!startEnabled) throw new Error('TEST (a) FAIL: #flash-start-btn không enabled sau khi load PDF');

// === TEST (b): Click start → 5 thẻ render ===
await page.click('#flash-start-btn', { force: true });
await page.waitForTimeout(2000);
const cardFront = await page.textContent('#flash-card-front');
console.log('Thẻ đầu tiên (front):', cardFront);
if (!cardFront || cardFront.length === 0) throw new Error('TEST (b) FAIL: không có term trên mặt trước thẻ');

// === TEST (c): Click thẻ → flip hiện definition ===
await page.click('#flash-card', { force: true });
await page.waitForTimeout(300);
const cardBack = await page.textContent('#flash-card-back');
console.log('Thẻ sau flip (back):', cardBack);
if (!cardBack || !cardBack.includes('Định nghĩa')) throw new Error('TEST (c) FAIL: definition không hiển thị sau khi flip');

// === TEST (d): Click 🔊 không lỗi ===
await page.click('#flash-speak-btn', { force: true });
await page.waitForTimeout(500);
console.log('TEST (d) PASS: nút 🔊 không gây lỗi');

// === TEST (e): Click 🔄 Ôn lại → thẻ quay lại cuối (kiểm tra counter) ===
await page.evaluate(() => document.querySelector('#flash-review-btn').click());
await page.waitForTimeout(500);
const progressAfterReview = await page.textContent('#flash-progress');
console.log('Progress sau khi Ôn lại 1 thẻ:', progressAfterReview);
// Vẫn còn 4 thẻ trong mainQueue + 1 trong reviewQueue = 5 total
// "Thẻ 1/5" (thẻ kế tiếp vẫn là thẻ thứ 2 của 5)

// === TEST (f): Click ✅ hết (5 thẻ + 1 review) → màn hình Hoàn thành ===
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#flash-know-btn').click());
}
await page.waitForTimeout(500);
const resultText = await page.textContent('#flash-result-text');
console.log('Result:', resultText);
if (!resultText || !resultText.includes('Hoàn thành')) throw new Error('TEST (f) FAIL: không hiển thị màn hình Hoàn thành');

// === TEST (g): Học lại → thẻ render lại không gọi API mới ===
const callsBeforeRetry = apiCalls;
await page.evaluate(() => document.querySelector('#flash-retry-btn').click());
await page.waitForTimeout(500);
const retryTerm = await page.textContent('#flash-card-front');
console.log('Thẻ sau Học lại:', retryTerm);
if (apiCalls !== callsBeforeRetry) throw new Error(`TEST (g) FAIL: _retry gọi API thêm (${apiCalls - callsBeforeRetry} lần), mong đợi 0`);
console.log('TEST (g) PASS: _retry không gọi API');

// === TEST (h): Làm mới → gọi API mới + thẻ mới ===
// Cần vào result trước: click know 5 lần để hết thẻ
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#flash-know-btn').click());
}
await page.waitForTimeout(500);
const callsBeforeRefresh = apiCalls;
await page.evaluate(() => document.querySelector('#flash-refresh-btn').click());
await page.waitForTimeout(2000);
const refreshTerm = await page.textContent('#flash-card-front');
console.log('Thẻ sau Làm mới:', refreshTerm);
if (apiCalls <= callsBeforeRefresh) throw new Error(`TEST (h) FAIL: _refresh không gọi API mới (apiCalls=${apiCalls}, before=${callsBeforeRefresh})`);
console.log('TEST (h) PASS: _refresh gọi API mới');

if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA flashcards PASS');
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
node tests/qa-flashcards.mjs
```
Expected: `✅ QA flashcards PASS`, exit 0

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **Step 3: Commit**

```bash
git add tests/qa-flashcards.mjs
git commit -m "test: add QA for flashcards flow"
```

---

### Task 8: README + plan checkboxes

**Files:**
- Modify: `README.md` (dòng quiz features ~16)

- [x] **Step 1: Sửa README**

Line 16-17 hiện tại:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo câu hỏi trắc nghiệm bám sát nội dung trang (3/5/10 câu tuỳ chọn), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang, ôn tập trang yếu
- 🔁 **Learning loop** — Kiểm tra ngay sau khi giảng + tự động ôn tập các trang có điểm thấp (< 60%)
```

Thêm dòng sau line 17 (sau dòng Learning loop):
```markdown
- 🃏 **Flashcards** — AI trích thuật ngữ → định nghĩa từ nội dung trang, lật thẻ học, nghe đọc bằng giọng, tự đánh giá biết/ôn lại, xoay vòng ôn tập
```

- [x] **Step 2: Mark all plan checkboxes as [x]**

Sau khi tất cả các task đã hoàn thành và verify pass, đánh dấu tất cả checkbox trong plan này thành `[x]`.

- [x] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add flashcards feature to README and finalize plan"
```

---

## Verification tổng (final wave)

- [x] **1. `node --check` tất cả file JS sửa đổi + mới:**

```bash
node --check js/ai-engine.js && node --check js/app.js && node --check js/quiz.js && node --check js/flashcards.js
```
Expected: exit 0

- [x] **2. Chạy regression tests cũ:**

```bash
node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs
```
Expected: `✅ title-detect: tất cả test pass` + `✅ quiz-validate: tất cả test pass`, exit 0

- [x] **3. Chạy unit test mới:**

```bash
node tests/flashcards-validate.test.mjs
```
Expected: `✅ flashcards-validate: tất cả test pass`, exit 0

- [x] **4. Chạy QA quiz count (đảm bảo không regression):**

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

- [x] **5. Chạy QA weak review (đảm bảo không regression):**

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

- [x] **6. Chạy QA flashcards:**

```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
node tests/qa-flashcards.mjs
```
Expected: `✅ QA flashcards PASS`, exit 0
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **7. Smoke test nhanh (đảm bảo app load không lỗi):**

```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
curl -s http://localhost:8080/ | head -5
```
Expected: HTML hợp lệ, exit 0
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **8. Kiểm tra git status:**

```bash
git status
```
Expected: sạch (ngoài `.omo/` và `docs/superpowers/plans/` nếu plan file vẫn unstaged).

- [x] **9. Liệt kê commits đã tạo:**

```bash
git log --oneline -10
```
Expected: ít nhất 9 commits theo thứ tự:
1. `docs: add flashcards feature to README and finalize plan`
2. `test: add QA for flashcards flow`
3. `test: add unit tests for validateFlashcards`
4. `feat: integrate FlashcardsManager into App lifecycle`
5. `feat: add 3-way tab switch coordination in QuizManager.switchTab`
6. `feat: add FlashcardsManager with 3-way tab switch, race guard, review queue`
7. `feat: add flashcards styles (card, flip, actions, progress)`
8. `feat: add flash tab and flashcard area HTML elements`
9. `feat: add generateFlashcards, validateFlashcards, and flashcardCache to AIEngine`

---

## Self-Review

**1. Spec coverage:**

| Yêu cầu | Coverage |
|---------|----------|
| Tab mới "🃏 Thẻ học" giữa Chat và Quiz | ✓ — Task 2 Step 1: `#tab-flash` chèn giữa `#tab-chat` và `#tab-quiz` |
| AI trích thuật ngữ → định nghĩa | ✓ — Task 1 Step 2: `generateFlashcards()` với system prompt tiếng Việt |
| Dropdown số thẻ 3/5/10, mặc định 5 | ✓ — Task 2 Step 2: `#flash-count` select (3/5/10, selected 5); Task 4 `_getFlashCount()` whitelist |
| Luồng học: term → lật → definition + 🔊 + ✅ Biết / 🔄 Ôn lại | ✓ — Task 4: `_renderCard`, `_flipCard`, `_speakCurrent`, `_markKnow`, `_markReview` |
| Cache key `flash_<trang>_<provider>_<sốthẻ>` | ✓ — Task 1 Step 2: `cacheKey = \`flash_${pageNum}_${this.provider}_${n}\`` |
| Cache riêng `flashcardCache` (Map mới) | ✓ — Task 1 Step 1: `this.flashcardCache = new Map()` |
| `clearCache()` + `saveSettings()` clear `flashcardCache` | ✓ — Task 1 Step 5-6 |
| `clearFlashcardsForPage(pageNum)` | ✓ — Task 1 Step 4 |
| `validateFlashcards(raw)` export | ✓ — Task 1 Step 3: parse JSON, fallback regex, term/definition non-empty, definition ≤ 200, trim |
| Class `FlashcardsManager` trong `js/flashcards.js` | ✓ — Task 4 Step 1: file mới, pattern theo QuizManager |
| Race guard `_genSeq`/`genId` | ✓ — Task 4: `const genId = ++this._genSeq`, stale check `genId !== this._genSeq` |
| 3-way switchTab: chat/flash/quiz | ✓ — Task 4 Step 4 (QuizManager ẩn flashArea) + Task 4 Step 1 (FlashcardsManager ẩn chatArea+quizArea) |
| Review queue xoay vòng: 🔄 quay lại, ✅ qua | ✓ — Task 4: `_markReview` push reviewQueue, `_nextCard` xoay vòng main→review |
| `_retry` KHÔNG gọi AI (dùng cards cũ) | ✓ — Task 4: `_retry()` dùng `this.cards` hiện có |
| `_refresh` GỌI AI (clear cache trước) | ✓ — Task 4: `_refresh()` gọi `clearFlashcardsForPage` + `_generateForCurrentPage` |
| TTS: `this.app.ttsEngine.speak(this.app._cleanVoiceText(text))` | ✓ — Task 4: `_speak()` pattern quiz.js:401-403 |
| Import + khởi tạo trong `app.js` | ✓ — Task 5: import line 10, constructor line 19, lifecycle calls |
| HTML: `#flash-area` block sau `#quiz-area` | ✓ — Task 2 Step 2: 20 ID, tái sử dụng CSS class `.quiz-start-controls`, `.quiz-count-label` |
| CSS: tái sử dụng quiz styles + flash-card đặc thù | ✓ — Task 3: `#flash-area`/`#flash-header`/`#flash-body` reuse quiz, `#flash-card` glass style, `.flipped` toggle display |
| Unit test `validateFlashcards` | ✓ — Task 6: 9 test cases (valid, markdown wrap, missing term/def, >200 chars trim, whitespace, non-JSON, regex fallback) |
| QA Playwright | ✓ — Task 7: 8 tests (a-h), fpdf real PDF, route Gemini, addInitScript, retry no API, refresh API call |
| README update | ✓ — Task 8 Step 1: thêm bullet 🃏 Flashcards |
| Không đổi `server.py` / thêm dependency | ✓ — không file nào sửa server.py, không package.json mới |

**2. Placeholder scan:** Không có TBD/TODO/"thêm xử lý" — mọi bước đều có code đầy đủ.

**3. Type consistency:**
- `flashcardCache` (Map) trong constructor (Task 1 Step 1) ↔ `this.flashcardCache.get/set/clear` trong `generateFlashcards`, `clearFlashcardsForPage`, `clearCache`, `saveSettings` — khớp.
- `validateFlashcards(raw)` signature: `(raw)` → export function (Task 1 Step 3) ↔ `import { validateFlashcards }` trong unit test (Task 6) — khớp.
- `generateFlashcards(pageNum, pageText, imageBase64, count = 5)` signature (Task 1 Step 2) ↔ `this.app.aiEngine.generateFlashcards(pageNum, pageText, imageBase64, this._getFlashCount())` (Task 4) — khớp.
- `#flash-count` select ID (Task 2) ↔ `this.flashCountSelect` ref (Task 4) — khớp.
- `#flash-card-front` ID (Task 2) ↔ `this.flashCardFront` ref (Task 4) — khớp.
- `#flash-start-btn` ID (Task 2) ↔ `this.flashStartBtn` ref + `onPdfLoaded` enable (Task 4) — khớp.
- `#flash-speak-btn` ID (Task 2) ↔ `this.flashSpeakBtn` ref + `_speakCurrent` (Task 4) — khớp.
- `#flash-know-btn` / `#flash-review-btn` ID (Task 2) ↔ `this.flashKnowBtn` / `this.flashReviewBtn` ref (Task 4) — khớp.
- `#flash-retry-btn` / `#flash-refresh-btn` ID (Task 2) ↔ `this.flashRetryBtn` / `this.flashRefreshBtn` ref (Task 4) — khớp.
- `{cards: [{term, definition}]}` JSON shape (Task 1 system prompt) ↔ `validateFlashcards` parse (Task 1 Step 3) ↔ QA route response (Task 7) — khớp.
- QA route response shape `{candidates: [{content: {parts: [{text: payload}]}}]}` — khớp với `_callGeminiAPI` pattern (qa-quiz-count.mjs, qa-weak-review.mjs).
- TTS call `this.app.ttsEngine.speak(this.app._cleanVoiceText(text))` — khớp với QuizManager `_speak` (quiz.js:401-403).

**4. Edge cases handled:**
- **AI không trả đúng count**: `validateFlashcards` chỉ giữ thẻ hợp lệ, có thể ít hơn yêu cầu. Chỉ throw nếu 0 thẻ (Task 1 Step 3: `cards.length === 0`).
- **Definition > 200 ký tự**: Cắt ở 200 trong `validateFlashcards` — `definition.substring(0, 200)` (Task 1 Step 3).
- **Cache map riêng**: `flashcardCache` tách biệt `quizCache` — prefix không xung đột (Task 1 Step 1).
- **Đổi provider**: `saveSettings()` clear cả `quizCache` + `flashcardCache` (Task 1 Step 6).
- **3-way switchTab race**: QuizManager.switchTab ẩn flashArea (Task 4 Step 4), FlashcardsManager.switchTab ẩn chatArea+quizArea (Task 4 Step 1) — dùng `document.getElementById` trực tiếp, không import vòng.
- **Race condition rapid page change**: Dùng `_genSeq`/`genId` pattern (Task 4 Step 1: `const genId = ++this._genSeq`) — stale gen return silently, only current gen touches UI.
- **`onPageChanged` mid-generation**: `_generating = false` + `_genSeq++` reset guard, stale gen's finally won't clear new gen's cards (Task 4: `if (genId === this._genSeq)` gate in finally).
- **`_onTabOpened` stale cards**: Reset all state before `_generateForCurrentPage` (Task 4).
- **`_retry` trong review queue đã xoay vòng**: `_retry` reset `mainQueue = [...this.cards]` — từ cards gốc, không phụ thuộc reviewQueue hiện tại.
- **`_refresh` xoá cache đúng prefix**: `clearFlashcardsForPage` xoá mọi key `flash_${pageNum}_${this.provider}_` (mọi số thẻ) (Task 1 Step 4: `startsWith(prefix)`).
- **QA test filename**: `/tmp/qa-flashcards.pdf` → `file.name` = `qa-flashcards.pdf` — nhất quán với pattern hiện có (app dùng `file.name` cho `quiz_scores` key).

**Ghi chú triển khai:**
- Không đổi server.py, không thêm dependency.
- `flashcardCache` là Map mới (không share `quizCache`).
- `validateFlashcards` là export function (giống `validateQuizQuestions`) — test được trong Node không cần browser.
- 3-way switchTab phối hợp qua `document.getElementById` trực tiếp — không import vòng.
- QA test dùng Playwright network interception + PDF thật fpdf — pattern giống qa-quiz-count.mjs và qa-weak-review.mjs.
- Toàn bộ element mới trong HTML sử dụng class CSS có sẵn (`.hidden`, `.welcome-message`, `.welcome-icon`, `.btn-primary`, `.btn-ghost`, `.spinner`, `.quiz-start-controls`, `.quiz-count-label`) — không cần thêm class mới ngoài `#flash-*` ID selectors.
