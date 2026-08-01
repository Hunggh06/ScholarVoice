# Quiz Trắc Nghiệm + Căn Thời Gian Giảng Thông Minh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 2 tính năng vào ScholarVoice: (1) Quiz trắc nghiệm tự động theo trang (3 câu/lần, MCQ + Đúng/Sai, chấm ngay, đọc bằng giọng, lưu điểm theo trang), (2) Giảng thông minh: slide chỉ có tiêu đề được nói ngắn gọn 1-2 câu và tự chuyển trang khi auto-read bật.

**Architecture:** Mọi thứ client-side theo pattern hiện có. Module mới `js/quiz.js` (QuizManager) + `js/title-detect.js` (hàm thuần phát hiện slide tiêu đề). `AIEngine` (js/ai-engine.js) thêm `generateQuiz()` + `quizCache` và cờ `isTitleSlide` cho `teachPage()`. `App` (js/app.js) nối tab "📝 Quiz" ở panel phải (tạo hệ tab mới cạnh chat) và nối auto-advance. Không đổi server.py.

**Tech Stack:** Vanilla JS ES modules, PDF.js (đã có), Web Speech API TTS (đã có), localStorage, Node v20 (chạy unit test không cần framework — dùng `node:assert`), Playwright (smoke test E2E đã có sẵn pattern trong `test_playwright.js`).

**Spec:** `docs/superpowers/specs/2026-08-01-quiz-smart-pacing-design.md`

---

### Task 1: Module phát hiện slide tiêu đề + unit test

**Files:**
- Create: `js/title-detect.js`
- Test: `tests/title-detect.test.mjs` (thư mục `tests/` mới, không cần framework)

- [ ] **Step 1: Viết test trước (failing)**

Tạo file `tests/title-detect.test.mjs`:

```javascript
import assert from 'node:assert';
import { detectTitleSlide } from '../js/title-detect.js';

// Slide tiêu đề: <= 20 từ sau khi làm sạch
assert.strictEqual(detectTitleSlide('Chương 3: Hàm số bậc nhất'), true, 'tiêu đề ngắn');
assert.strictEqual(detectTitleSlide('PHẦN 2 — GIẢI TÍCH'), true, 'tiêu đề phần');
assert.strictEqual(detectTitleSlide('  Chương 1  '), true, 'tiêu đề có khoảng trắng thừa');

// Slide nội dung: > 20 từ
const content = 'Hàm số bậc nhất có dạng y = ax + b với a khác 0. Đồ thị của hàm số bậc nhất là một đường thẳng. Hệ số a quyết định độ dốc của đường thẳng đó.';
assert.strictEqual(detectTitleSlide(content), false, 'nội dung dài');

// Text rỗng / null / undefined → false (an toàn, giảng bình thường)
assert.strictEqual(detectTitleSlide(''), false, 'rỗng');
assert.strictEqual(detectTitleSlide(null), false, 'null');
assert.strictEqual(detectTitleSlide(undefined), false, 'undefined');
assert.strictEqual(detectTitleSlide('   '), false, 'chỉ khoảng trắng');

// Nhiều ký tự đặc biệt (markdown heading) vẫn đếm đúng
assert.strictEqual(detectTitleSlide('## Chương 5: Tích phân'), true, 'heading markdown');

console.log('✅ title-detect: tất cả test pass');
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node tests/title-detect.test.mjs`
Expected: FAIL với lỗi `Cannot find module '../js/title-detect.js'`

- [ ] **Step 3: Tạo module `js/title-detect.js`**

```javascript
/**
 * title-detect.js - Phát hiện slide "chỉ có tiêu đề" (trang bìa, trang mở đầu chương)
 * Dựa trên số lượng từ sau khi làm sạch ký tự markdown/đặc biệt.
 * Thuần (pure) — không dùng DOM/localStorage, test được bằng Node.
 */

export const TITLE_SLIDE_WORD_THRESHOLD = 20;

/**
 * @param {string|null|undefined} pageText - text đã trích xuất từ PDF (getPageText)
 * @returns {boolean} true nếu slide chỉ có tiêu đề (<= threshold từ)
 */
export function detectTitleSlide(pageText) {
  if (!pageText || typeof pageText !== 'string') return false;
  const clean = pageText
    .replace(/[#*`\-_=~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;
  return clean.split(' ').length <= TITLE_SLIDE_WORD_THRESHOLD;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `node tests/title-detect.test.mjs`
Expected: `✅ title-detect: tất cả test pass`, exit code 0

- [ ] **Step 5: Commit**

```bash
git add js/title-detect.js tests/title-detect.test.mjs
git commit -m "feat: add title slide detection util"
```

---

### Task 2: AIEngine — generateQuiz + validateQuizQuestions + quizCache

**Files:**
- Modify: `js/ai-engine.js` (thêm `quizCache` vào constructor, thêm method `generateQuiz`, `clearQuizForPage`, thêm export `validateQuizQuestions`)
- Test: `tests/quiz-validate.test.mjs`

- [ ] **Step 1: Viết test cho `validateQuizQuestions` trước (failing)**

Tạo file `tests/quiz-validate.test.mjs`:

```javascript
import assert from 'node:assert';
import { validateQuizQuestions } from '../js/ai-engine.js';

// JSON hợp lệ: 3 câu trộn MCQ + TF
const good = JSON.stringify({
  questions: [
    { type: 'mcq', question: 'Hàm số bậc nhất có dạng?', options: ['y=ax+b', 'y=ax²', 'y=a/x', 'y=|x|'], correct_index: 0, explanation: 'Vì dạng tổng quát là y=ax+b với a khác 0.' },
    { type: 'tf', question: 'Đồ thị hàm bậc nhất là đường thẳng.', correct: true, explanation: 'Đúng vậy.' },
    { type: 'mcq', question: 'Hệ số a quyết định?', options: ['Độ dốc', 'Màu sắc', 'Kích thước', 'Vị trí'], correct_index: 0, explanation: 'a quyết định độ dốc.' }
  ]
});
let q = validateQuizQuestions(good);
assert.strictEqual(q.length, 3, 'giữ đủ 3 câu');
assert.strictEqual(q[0].type, 'mcq');
assert.strictEqual(q[1].type, 'tf');
assert.strictEqual(q[1].correct, true);
assert.strictEqual(q[0].options.length, 4);

// JSON bị bọc trong markdown ```json ... ```
const wrapped = '```json\n' + good + '\n```';
assert.strictEqual(validateQuizQuestions(wrapped).length, 3, 'parse được JSON trong markdown block');

// JSON lỏng: thiếu trường → câu đó bị loại, câu còn lại giữ
const messy = JSON.stringify({ questions: [
  { type: 'mcq', question: 'Câu hỏi không đủ đáp án', options: ['A'], correct_index: 0, explanation: 'x' },
  { type: 'tf', question: 'Đúng hay sai?', correct: false, explanation: 'y' }
]});
q = validateQuizQuestions(messy);
assert.strictEqual(q.length, 1, 'chỉ giữ câu TF hợp lệ');
assert.strictEqual(q[0].type, 'tf');

// correct_index ngoài phạm vi → loại câu
const badIdx = JSON.stringify({ questions: [
  { type: 'mcq', question: 'x', options: ['A','B','C','D'], correct_index: 9, explanation: 'z' }
]});
assert.strictEqual(validateQuizQuestions(badIdx).length, 0, 'loại câu correct_index sai');

// Không phải JSON → mảng rỗng
assert.strictEqual(validateQuizQuestions('không phải json').length, 0);
assert.strictEqual(validateQuizQuestions(null).length, 0);
assert.strictEqual(validateQuizQuestions(undefined).length, 0);
assert.strictEqual(validateQuizQuestions('').length, 0);

// type không hợp lệ → loại
const badType = JSON.stringify({ questions: [
  { type: 'essay', question: 'x', correct: true, explanation: 'z' }
]});
assert.strictEqual(validateQuizQuestions(badType).length, 0, 'loại câu type lạ');

console.log('✅ quiz-validate: tất cả test pass');
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `node tests/quiz-validate.test.mjs`
Expected: FAIL với lỗi import (chưa có export `validateQuizQuestions`)

- [ ] **Step 3: Thêm `quizCache` vào constructor của AIEngine**

Trong `js/ai-engine.js`, constructor hiện có (sau dòng `this.pageCache = new Map();`, tức sau dòng ~31), thêm:

```javascript
    // Cache quiz theo trang: key `quiz_<page>_<provider>`
    this.quizCache = new Map();
```

- [ ] **Step 4: Thêm `validateQuizQuestions` (export) và `generateQuiz` + `clearQuizForPage`**

Thêm vào cuối file `js/ai-engine.js` (trước dòng `}` cuối cùng của class — đặt methods trong class; export function đặt SAU class):

Trong class (trước `clearCache()`):

```javascript
  /**
   * Tạo quiz 3 câu hỏi cho một trang. Cache theo trang + provider.
   * @param {number} pageNum
   * @param {string} pageText - text đã trích xuất của trang
   * @param {string|null} imageBase64 - ảnh trang (provider có vision thì dùng)
   * @returns {Promise<Array>} mảng câu hỏi đã validate
   */
  async generateQuiz(pageNum, pageText, imageBase64) {
    const cacheKey = `quiz_${pageNum}_${this.provider}`;
    const cached = this.quizCache.get(cacheKey);
    if (cached) return cached;

    if (!pageText || !pageText.trim()) {
      throw new Error('Trang này không có nội dung chữ để tạo câu hỏi.');
    }

    const systemPrompt = `Bạn là giảng viên tạo câu hỏi trắc nghiệm để kiểm tra hiểu bài.
Tạo CHÍNH XÁC 3 câu hỏi từ nội dung trang tài liệu. Độ khó tăng dần.
Câu hỏi phải bám sát nội dung trang, KHÔNG bịa kiến thức ngoài.
Mỗi câu hỏi gồm: type "mcq" (có options 4 đáp án + correct_index từ 0 đến 3) hoặc "tf" (có correct true/false), question, explanation (1-2 câu giải thích vì sao đúng).
Trả về JSON duy nhất, không thêm bất kỳ text nào ngoài JSON:
{
  "questions": [
    {"type":"mcq","question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."},
    {"type":"tf","question":"...","correct":true,"explanation":"..."}
  ]
}
NGÔN NGỮ: Luôn dùng TIẾNG VIỆT.
explanation phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.`;

    const userPrompt = `Nội dung trang tài liệu (dòng bắt đầu bằng ## là tiêu đề, dòng trống ngăn cách các phần):

${pageText}

Hãy tạo quiz theo đúng định dạng JSON yêu cầu ở trên.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    const questions = validateQuizQuestions(rawResponse);
    if (questions.length === 0) {
      throw new Error('AI không tạo được câu hỏi hợp lệ. Bấm 🔁 để thử lại.');
    }

    this.quizCache.set(cacheKey, questions);
    return questions;
  }

  /** Xoá quiz cache của một trang (dùng cho nút "Làm lại" — sinh câu mới) */
  clearQuizForPage(pageNum) {
    this.quizCache.delete(`quiz_${pageNum}_${this.provider}`);
  }
```

Sau dấu `}` đóng class (cuối file), thêm function export:

```javascript

/**
 * Parse + validate phản hồi quiz từ AI (JSON). Thuần — test được bằng Node.
 * @param {string|null|undefined} raw - text thô từ AI
 * @returns {Array} mảng câu hỏi hợp lệ [{type, question, options?, correct_index?, correct?, explanation}]
 */
export function validateQuizQuestions(raw) {
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
    // Fallback cuối: tìm object có "questions"
    const m2 = raw.match(/\{[\s\S]*"questions"[\s\S]*\}/);
    if (m2) {
      try { parsed = JSON.parse(m2[0]); } catch { /* fallback */ }
    }
  }

  const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : [];
  const out = [];
  for (const q of list) {
    if (!q || typeof q !== 'object') continue;
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    if (!question) continue;

    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length !== 4) continue;
      if (!q.options.every(o => typeof o === 'string' && o.trim())) continue;
      const ci = Number(q.correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci > 3) continue;
      out.push({ type: 'mcq', question, options: q.options.map(o => o.trim()), correct_index: ci, explanation });
    } else if (q.type === 'tf') {
      if (typeof q.correct !== 'boolean') continue;
      out.push({ type: 'tf', question, correct: q.correct, explanation });
    }
    // type khác → bỏ qua câu đó
  }
  return out;
}
```

- [ ] **Step 5: Chạy test, xác nhận PASS**

Run: `node tests/quiz-validate.test.mjs`
Expected: `✅ quiz-validate: tất cả test pass`, exit code 0

- [ ] **Step 6: Kiểm tra syntax tổng thể**

Run: `node --check js/ai-engine.js && node --check js/title-detect.js`
Expected: không có output, exit code 0

- [ ] **Step 7: Commit**

```bash
git add js/ai-engine.js tests/quiz-validate.test.mjs
git commit -m "feat: add AI quiz generation with validation and cache"
```

---

### Task 3: teachPage — hỗ trợ cờ isTitleSlide (giảng ngắn cho slide tiêu đề)

**Files:**
- Modify: `js/ai-engine.js` (`teachPage` signature + prompt + result flag)

- [ ] **Step 1: Sửa signature và thêm cờ**

Trong `js/ai-engine.js`, đổi dòng:
```javascript
  async teachPage(imageBase64, pageNum, pageText, onStream) {
```
thành:
```javascript
  async teachPage(imageBase64, pageNum, pageText, onStream, opts = {}) {
    const isTitleSlide = !!opts.isTitleSlide;
```

- [ ] **Step 2: Chọn system prompt theo cờ**

Trong `teachPage`, khối hiện tại:
```javascript
    const systemPrompt = `Bạn là giảng viên đang giảng liên tục toàn bộ tài liệu. Đây là trang ${pageNum}.
```
Sửa thành: tạo biến `systemPrompt` có điều kiện trước khối prompt hiện tại. Chèn NGAY TRƯỚC dòng `const systemPrompt = ...`:

```javascript
    let systemPrompt;
    if (isTitleSlide) {
      systemPrompt = `Bạn là giảng viên đang giảng liên tục toàn bộ tài liệu. Trang ${pageNum} này CHỈ CÓ TIÊU ĐỀ (trang bìa, trang mở đầu chương, trang chia mục).

${contextText}
HÀNH VI BẮT BUỘC:
- Nói NGẮN GỌN 1-2 câu giới thiệu nội dung sắp học, nối mạch tự nhiên với bài giảng trước đó.
- KHÔNG phân tích, KHÔNG bịa nội dung, KHÔNG lặp lại tiêu đề dài dòng.
- Giọng điệu tự nhiên như giảng viên thật.

NGÔN NGỮ: Luôn giảng bằng TIẾNG VIỆT.
KHÔNG dùng markdown hay ký tự đặc biệt nào. Chỉ dùng chữ cái, số, dấu câu cơ bản (. , ? ! : ;).`;
    } else {
      systemPrompt = `Bạn là giảng viên đang giảng liên tục toàn bộ tài liệu. Đây là trang ${pageNum}.
```

(Nội dung cũ của prompt tiếp tục nằm trong nhánh `else`, và đóng nhánh bằng `}` sau phần cuối prompt cũ — tức sau dòng kết thúc backtick của prompt gốc: `KHÔNG dùng ký tự đặc biệt nào cả. Chỉ dùng chữ cái, số, dấu câu cơ bản (. , ? ! : ;).`;)

- [ ] **Step 3: Slide tiêu đề không cần JSON segments**

Trong `teachPage`, khối hiện tại:
```javascript
    let userPrompt;
    let expectJson = false;
    if (hasImage && hasVision) {
      expectJson = true;
```
Sửa thành:
```javascript
    let userPrompt;
    let expectJson = false;
    if (!isTitleSlide && hasImage && hasVision) {
      expectJson = true;
```

- [ ] **Step 4: Thêm isTitleSlide vào kết quả trả về (để cache-hit biết được)**

Trong `teachPage`, khối cuối:
```javascript
    const result = { voice_text: voiceText, segments };
```
Sửa thành:
```javascript
    const result = { voice_text: voiceText, segments, isTitleSlide };
```

- [ ] **Step 5: Verify syntax**

Run: `node --check js/ai-engine.js && node tests/quiz-validate.test.mjs`
Expected: không có output từ --check, test vẫn PASS

- [ ] **Step 6: Commit**

```bash
git add js/ai-engine.js
git commit -m "feat: adapt lecture prompt for title slides"
```

---

### Task 4: UI — tab "📝 Quiz" trong index.html + CSS

**Files:**
- Modify: `index.html` (thêm thanh tab + container quiz giữa `#custom-style-box` và `#chat-area`)
- Modify: `css/style.css` (thêm style tab + quiz)

- [ ] **Step 1: Thêm thanh tab vào index.html**

Trong `index.html`, giữa khối `</div>` đóng `#custom-style-box` (dòng ~262) và `<div id="chat-area">` (dòng ~264), chèn:

```html
      <div id="right-tabs">
        <button id="tab-chat" class="right-tab active" data-tab="chat">💬 Hỏi đáp</button>
        <button id="tab-quiz" class="right-tab" data-tab="quiz">📝 Quiz</button>
      </div>
```

- [ ] **Step 2: Thêm container quiz vào index.html**

NGAY SAU `</div>` đóng `#chat-area` (sau dòng `</div>` chứa `#chat-clear-btn`, trước `<div id="debug-panel">`), chèn:

```html
      <div id="quiz-area" class="hidden">
        <div id="quiz-header">
          <span id="quiz-title">📝 Quiz</span>
          <span id="quiz-best-score" class="hidden"></span>
        </div>
        <div id="quiz-body">
          <div id="quiz-empty" class="welcome-message">
            <div class="welcome-icon">📝</div>
            <p id="quiz-empty-text">Tải PDF lên để tạo câu hỏi trắc nghiệm cho trang đang xem.</p>
            <button id="quiz-start-btn" class="btn-primary" disabled>🔄 Tạo câu hỏi cho trang này</button>
          </div>
          <div id="quiz-loading" class="hidden">
            <div class="spinner"></div>
            <p>Đang tạo 3 câu hỏi...</p>
          </div>
          <div id="quiz-question" class="hidden">
            <div id="quiz-question-text"></div>
            <div id="quiz-options"></div>
            <div id="quiz-feedback" class="hidden"></div>
            <div id="quiz-actions">
              <button id="quiz-next-btn" class="btn-primary hidden">Câu tiếp →</button>
            </div>
          </div>
          <div id="quiz-result" class="hidden">
            <div id="quiz-result-score"></div>
            <div style="display:flex;gap:10px;">
              <button id="quiz-retry-btn" class="btn-primary">🔄 Làm lại (câu hỏi mới)</button>
              <button id="quiz-close-btn" class="btn-ghost">Đóng</button>
            </div>
          </div>
        </div>
      </div>
```

- [ ] **Step 3: Thêm CSS cho tab + quiz**

Thêm vào cuối `css/style.css` (trước phần RESPONSIVE hoặc sau nó — thêm sau cùng để không phá layout cũ):

```css
/* ============================================================
   RIGHT PANEL TABS (Chat / Quiz)
   ============================================================ */
#right-tabs {
  display:flex; gap:8px; padding:10px 20px 0; flex-shrink:0;
  border-bottom:1px solid rgba(255,255,255,0.04);
}
.right-tab {
  padding:8px 14px; background:transparent; border:none; border-bottom:2px solid transparent;
  color:var(--text-secondary); font-size:0.85rem; font-family:inherit; font-weight:500;
  cursor:pointer; transition:all var(--transition); white-space:nowrap;
}
.right-tab:hover { color:var(--text-primary); }
.right-tab.active { color:var(--accent); border-bottom-color:var(--accent); }

/* ============================================================
   QUIZ
   ============================================================ */
#quiz-area { flex:1; display:flex; flex-direction:column; overflow:hidden; position:relative; }
#quiz-header {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 20px; border-bottom:1px solid rgba(255,255,255,0.04); flex-shrink:0;
}
#quiz-title { font-size:0.85rem; font-weight:600; color:var(--text-primary); }
#quiz-best-score { font-size:0.75rem; color:var(--green); white-space:nowrap; }
#quiz-body { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; }
#quiz-body .spinner { margin-bottom:12px; }
#quiz-body #quiz-loading { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; flex:1; color:var(--text-secondary); font-size:0.9rem; }
#quiz-question-text { font-size:1rem; font-weight:600; line-height:1.6; margin-bottom:16px; color:var(--text-primary); }
#quiz-options { display:flex; flex-direction:column; gap:10px; }
.quiz-option {
  display:flex; align-items:center; gap:10px; width:100%; padding:12px 16px;
  background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08);
  border-radius:var(--radius-sm); color:var(--text-primary); font-size:0.9rem;
  font-family:inherit; cursor:pointer; text-align:left; transition:all var(--transition);
}
.quiz-option:hover:not(:disabled) { background:rgba(255,255,255,0.08); border-color:var(--accent); transform:scale(0.99); }
.quiz-option:disabled { cursor:default; }
.quiz-option.correct {
  background:rgba(52,211,153,0.15); border-color:var(--green); color:var(--green);
  box-shadow:0 0 12px rgba(52,211,153,0.2);
}
.quiz-option.wrong {
  background:rgba(248,113,113,0.15); border-color:var(--red); color:var(--red);
  box-shadow:0 0 12px rgba(248,113,113,0.2);
}
.quiz-opt-label {
  display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px;
  border-radius:50%; background:rgba(255,255,255,0.06); font-weight:700; font-size:0.8rem; flex-shrink:0;
}
.quiz-opt-text { flex:1; }
#quiz-feedback { margin-top:16px; padding:12px 16px; border-radius:var(--radius-sm); font-size:0.85rem; line-height:1.6; }
#quiz-feedback.correct { background:rgba(52,211,153,0.1); border:1px solid rgba(52,211,153,0.25); }
#quiz-feedback.wrong { background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.25); }
#quiz-actions { display:flex; justify-content:flex-end; margin-top:16px; }
#quiz-result { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:20px; flex:1; text-align:center; }
#quiz-result-score { font-size:1.15rem; color:var(--text-primary); line-height:1.6; }
#quiz-empty .btn-primary { margin-top:8px; }
```

- [ ] **Step 4: Verify HTML hợp lệ**

Run: `python3 -c "from html.parser import HTMLParser; p=HTMLParser(); p.feed(open('index.html').read()); print('HTML OK')"`
Expected: `HTML OK`

- [ ] **Step 5: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: add quiz tab UI markup and styles"
```

---

### Task 5: Module QuizManager — js/quiz.js

**Files:**
- Create: `js/quiz.js`

- [ ] **Step 1: Tạo file `js/quiz.js`**

```javascript
/**
 * QuizManager - Module quiz trắc nghiệm theo trang
 * Luồng: mở tab → tự sinh 3 câu (cache) → trả lời từng câu (chấm ngay + giải thích + TTS) → tổng kết → lưu điểm
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

    this.questions = [];
    this.currentIndex = 0;
    this.correctCount = 0;
    this.answered = false;
    this._generating = false;

    this._setupEvents();
  }

  _setupEvents() {
    this.tabChat.addEventListener('click', () => this.switchTab('chat'));
    this.tabQuiz.addEventListener('click', () => this.switchTab('quiz'));
    this.quizStartBtn.addEventListener('click', () => this._generateForCurrentPage());
    this.quizNextBtn.addEventListener('click', () => this._onNext());
    this.quizRetryBtn.addEventListener('click', () => this._retry());
    this.quizCloseBtn.addEventListener('click', () => this._resetToEmpty());
    this.quizOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('.quiz-option');
      if (!btn) return;
      this._answer(parseInt(btn.dataset.idx, 10));
    });
  }

  /** Chuyển tab chat/quiz */
  switchTab(name) {
    const showQuiz = name === 'quiz';
    this.chatArea.classList.toggle('hidden', showQuiz);
    this.quizArea.classList.toggle('hidden', !showQuiz);
    this.tabChat.classList.toggle('active', !showQuiz);
    this.tabQuiz.classList.toggle('active', showQuiz);
    if (showQuiz) this._onTabOpened();
  }

  /** Gọi khi tab quiz mở — tự sinh nếu chưa có quiz cho trang hiện tại */
  _onTabOpened() {
    this._syncForPage(this.app.pdfViewer.currentPage);
    if (!this.questions || this.questions.length === 0) {
      this._generateForCurrentPage();
    }
  }

  /** App gọi khi đổi trang — cập nhật tiêu đề + điểm, tự sinh nếu tab đang mở */
  onPageChanged(pageNum) {
    this._syncForPage(pageNum);
    if (!this.quizArea.classList.contains('hidden')) {
      if (!this.questions || this.questions.length === 0) {
        this._generateForCurrentPage();
      }
    }
  }

  /** App gọi sau khi tải PDF — bật nút tạo */
  onPdfLoaded() {
    this.quizStartBtn.disabled = false;
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
    this._syncForPage(this.app.pdfViewer.currentPage);
  }

  /** Cập nhật tiêu đề + điểm cao nhất của trang */
  _syncForPage(pageNum) {
    this.quizTitle.textContent = `📝 Quiz trang ${pageNum}`;
    const score = this._getScore(pageNum);
    if (score && score.attempts > 0) {
      this.quizBestScore.textContent = `Điểm cao nhất: ${score.best}/3`;
      this.quizBestScore.classList.remove('hidden');
    } else {
      this.quizBestScore.classList.add('hidden');
    }
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
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
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
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64);

      if (this.app.pdfViewer.currentPage !== pageNum) return; // user đã đổi trang

      this.questions = questions;
      this.currentIndex = 0;
      this.correctCount = 0;
      this.answered = false;

      this.quizLoading.classList.add('hidden');
      this.quizQuestion.classList.remove('hidden');
      this._renderQuestion();
    } catch (err) {
      if (err.message === 'Đã hủy yêu cầu.') return;
      console.error('Lỗi tạo quiz:', err);
      this.quizLoading.classList.add('hidden');
      this._resetToEmpty();
      this.quizEmptyText.textContent = '⚠️ ' + err.message;
      this.quizStartBtn.disabled = false;
      this.app._showToast('Không tạo được câu hỏi. Bấm 🔄 để thử lại.', 'error');
    } finally {
      this._generating = false;
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
    this._saveScore(pageNum, this.correctCount);

    this.quizQuestion.classList.add('hidden');
    this.quizResult.classList.remove('hidden');
    this.quizResultScore.innerHTML = `🎯 Bạn trả lời đúng <strong>${this.correctCount}/${this.questions.length}</strong> câu.`;
    this._syncForPage(pageNum);
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

  _saveScore(pageNum, score) {
    const filename = this.app._pdfFileName;
    if (!filename) return;
    try {
      const key = 'quiz_scores_' + filename;
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      const cur = all[pageNum] || { best: 0, last: 0, lastTime: 0, attempts: 0 };
      cur.last = score;
      cur.best = Math.max(cur.best, score);
      cur.lastTime = Date.now();
      cur.attempts += 1;
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
```

- [ ] **Step 2: Verify syntax**

Run: `node --check js/quiz.js`
Expected: không có output, exit code 0

- [ ] **Step 3: Commit**

```bash
git add js/quiz.js
git commit -m "feat: add QuizManager module"
```

---

### Task 6: Tích hợp vào App — tab, quiz wiring, smart pacing

**Files:**
- Modify: `js/app.js` (imports, constructor, init, `_teachCurrentPage`, `_prefetchNextPages`, `onEnd`, stop button)

- [ ] **Step 1: Thêm imports**

Trong `js/app.js`, khối import hiện có (dòng 5-8), thêm:

```javascript
import { QuizManager } from './quiz.js';
import { detectTitleSlide } from './title-detect.js';
```

- [ ] **Step 2: Khởi tạo QuizManager trong constructor**

Trong `js/app.js`, sau dòng `this.chatManager = new ChatManager();`, thêm:

```javascript
    this.quizManager = new QuizManager(this);
    this._lastTaughtWasTitle = false;
```

- [ ] **Step 3: Gọi setup tab + sự kiện quiz trong init()**

Trong `init()`, sau dòng `this._setupChat();`, thêm:

```javascript
    this._setupQuizEvents();
```

- [ ] **Step 4: Thêm method `_setupQuizEvents`**

Thêm method mới vào class App (đặt sau `_setupChat`):

```javascript
  _setupQuizEvents() {
    // ChatManager dùng chung các nút chat; QuizManager tự xử lý tab riêng.
    // Không cần thêm gì — QuizManager đã wire trong constructor.
  }
```

- [ ] **Step 5: Thông báo cho QuizManager khi tải PDF**

Trong `_loadPDFFile`, sau dòng `this.chatManager.setEnabled(true);`, thêm:

```javascript
      this.quizManager.onPdfLoaded();
```

- [ ] **Step 6: Thông báo đổi trang**

Trong `_navigatePage`, sau khối `if (success) { this._updatePageInfo(); this._updatePageCacheBar();`, thêm (trong khối success):

```javascript
      this.quizManager.onPageChanged(this.pdfViewer.currentPage);
```

- [ ] **Step 7: Smart pacing — `_teachCurrentPage` phát hiện slide tiêu đề**

Trong `_teachCurrentPage`, nhánh cache-hit (khối `if (entry) {`), sau dòng `this.currentSegments = entry.segments || null;`, thêm:

```javascript
      this._lastTaughtWasTitle = !!entry.isTitleSlide;
```

Trong cùng method, khối try (dòng `const pageText = await this.pdfViewer.getPageText();`), sửa 2 dòng:

```javascript
      const pageText = await this.pdfViewer.getPageText();
      const result = await this.aiEngine.teachPage(imageBase64, targetPage, pageText);
```
thành:
```javascript
      const pageText = await this.pdfViewer.getPageText();
      this._lastTaughtWasTitle = detectTitleSlide(pageText);
      const result = await this.aiEngine.teachPage(imageBase64, targetPage, pageText, null, { isTitleSlide: this._lastTaughtWasTitle });
```

- [ ] **Step 8: Smart pacing — prefetch cũng áp dụng phát hiện**

Trong `_prefetchNextPages`, khối:
```javascript
        const pageText = await this.pdfViewer.getTextForPage(pageNum);
        let imageBase64 = null;
        if (hasVision) {
          imageBase64 = await this.pdfViewer.getPageImageForPage(pageNum);
        }
        await this.aiEngine.teachPage(imageBase64, pageNum, pageText);
```
sửa thành:
```javascript
        const pageText = await this.pdfViewer.getTextForPage(pageNum);
        const isTitleSlide = detectTitleSlide(pageText);
        let imageBase64 = null;
        if (hasVision) {
          imageBase64 = await this.pdfViewer.getPageImageForPage(pageNum);
        }
        await this.aiEngine.teachPage(imageBase64, pageNum, pageText, null, { isTitleSlide });
```

- [ ] **Step 9: Smart pacing — auto-advance khi hết slide tiêu đề**

Trong `_setupTTSCallbacks`, handler `onEnd` hiện tại (khối `this.ttsEngine.onEnd = () => {`), sau dòng `this._clearSubtitle();` và trước dấu `};` đóng, thêm:

```javascript
      // Slide tiêu đề + auto-read: tự chuyển trang sau ~2.5s để bài giảng liền mạch
      if (this.autoRead && this._lastTaughtWasTitle) {
        setTimeout(() => {
          if (!this.ttsEngine.isSpeaking && this.pdfViewer.isLoaded) {
            this._navigatePage('next');
          }
        }, 2500);
      }
```

- [ ] **Step 10: Reset cờ khi dừng thủ công**

Trong `_setupVoiceControls`, handler nút `btn-stop` (khối `document.getElementById('btn-stop').addEventListener('click', () => {`), sau dòng `this._isTeaching = false;`, thêm:

```javascript
      this._lastTaughtWasTitle = false;
```

Cũng reset khi đổi trang — trong `_navigatePage`, sau dòng `this.currentSegments = null;` (đầu method), thêm:

```javascript
    this._lastTaughtWasTitle = false;
```

- [ ] **Step 11: Verify syntax**

Run: `node --check js/app.js && node --check js/quiz.js && node --check js/ai-engine.js && node --check js/title-detect.js`
Expected: không có output, exit code 0

- [ ] **Step 12: Chạy lại toàn bộ unit test**

Run: `node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs`
Expected: cả 2 đều `✅ ... tất cả test pass`

- [ ] **Step 13: Commit**

```bash
git add js/app.js
git commit -m "feat: integrate quiz tab and smart lecture pacing"
```

---

### Task 7: E2E — chạy server + smoke test + QA checklist

**Files:**
- Create: `tests/smoke-quiz.mjs` (Playwright smoke — pattern theo `test_playwright.js` hiện có)
- Modify: README.md (cập nhật danh sách tính năng — 2 dòng mới)

- [ ] **Step 1: Tạo smoke test Playwright**

Tạo file `tests/smoke-quiz.mjs`:

```javascript
// Smoke test: mở app, kiểm tra tab Quiz tồn tại và tương tác cơ bản
// Chạy: node tests/smoke-quiz.mjs  (cần server đang chạy ở localhost:8080)
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://localhost:8080/');
await page.click('#start-btn');
await page.waitForTimeout(500);

// Kiểm tra tab Quiz hiển thị
await page.waitForSelector('#tab-quiz', { timeout: 5000 });
const tabQuizVisible = await page.isVisible('#tab-quiz');
console.log('Tab Quiz hiển thị:', tabQuizVisible);
if (!tabQuizVisible) throw new Error('Thiếu tab #tab-quiz');

// Bấm tab Quiz → quiz-area hiện, chat ẩn
await page.click('#tab-quiz');
await page.waitForTimeout(300);
const quizAreaVisible = await page.isVisible('#quiz-area');
const chatAreaHidden = await page.isHidden('#chat-area');
console.log('Quiz area hiện:', quizAreaVisible, '| Chat ẩn:', chatAreaHidden);
if (!quizAreaVisible || !chatAreaHidden) throw new Error('Chuyển tab Quiz lỗi');

// Bấm lại tab Chat
await page.click('#tab-chat');
await page.waitForTimeout(300);
if (await page.isHidden('#quiz-area') === false) throw new Error('Chuyển lại tab Chat lỗi');

// Upload PDF thật (file dummy vẫn mở được upload area)
const fs = await import('node:fs');
fs.writeFileSync('/tmp/dummy.pdf', '%PDF-1.4\n%EOF');
await page.setInputFiles('#pdf-input', '/tmp/dummy.pdf');
await page.waitForTimeout(2000);
const startBtnEnabled = await page.isEnabled('#quiz-start-btn');
console.log('Nút tạo quiz enabled sau khi load PDF:', startBtnEnabled);

if (errors.length > 0) {
  console.log('LỖI TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ Smoke test quiz PASS');
await browser.close();
```

- [ ] **Step 2: Chạy server**

Run: `python3 server.py &` (hoặc terminal riêng) — server chạy ở `http://localhost:8080`
Expected: log `Server chay tai http://localhost:8080`

- [ ] **Step 3: Chạy smoke test**

Run: `node tests/smoke-quiz.mjs`
Expected: `✅ Smoke test quiz PASS`, không có lỗi trình duyệt

- [ ] **Step 4: QA thủ công (cần API key đã cấu hình sẵn trong localStorage của trình duyệt)**

Mở `http://localhost:8080` trong Chrome và kiểm tra checklist:
- [ ] Mở PDF bất kỳ → bấm tab 📝 Quiz → hiện loading "Đang tạo 3 câu hỏi..." → 3 câu hiện ra, TTS đọc câu hỏi
- [ ] Trả lời MCQ: đáp án đúng xanh, sai đỏ, feedback + giải thích hiện, TTS đọc giải thích
- [ ] Câu Đúng/Sai: 2 nút ✅/❌ hoạt động đúng
- [ ] Câu cuối → "📊 Xem kết quả" → điểm + nút Làm lại/Đóng
- [ ] Làm lại → 3 câu MỚI khác câu trước
- [ ] Đổi trang → quiz tự sinh cho trang mới; quay lại trang cũ → quiz cũ (cache, không gọi lại API — kiểm tra debug panel chỉ 1 request)
- [ ] Đóng tab → mở lại → điểm cao nhất hiện trên header quiz
- [ ] Xoá cache (🗑️ Làm mới) → điểm quiz KHÔNG bị mất
- [ ] **Smart pacing**: mở PDF có trang bìa/tiêu đề → bật "Tự động" → bấm 🎓 Đọc → slide tiêu đề nói 1-2 câu rồi TỰ chuyển trang; slide nội dung giảng đầy đủ và DỪNG
- [ ] Bấm ⏹ giữa chừng slide tiêu đề → KHÔNG tự chuyển trang
- [ ] Chat, giảng bài thường, seek, subtitle vẫn hoạt động bình thường (không vỡ luồng cũ)

- [ ] **Step 5: Cập nhật README.md**

Trong README.md, phần `## Features`, thêm 2 dòng:

```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo 3 câu hỏi/trang (trắc nghiệm + đúng/sai), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
- ⏱️ **Giảng thông minh** — slide chỉ có tiêu đề được giới thiệu ngắn gọn và tự động chuyển trang khi bật auto-read
```

- [ ] **Step 6: Dọn server + commit**

```bash
# Dừng server (Ctrl+C hoặc kill %1)
git add tests/smoke-quiz.mjs README.md
git commit -m "test: add quiz smoke test and update README"
```

---

## Self-Review

**1. Spec coverage:**
- Quiz (spec 3.2): tab mở → tự sinh ✓ (Task 5 `_onTabOpened`), chấm ngay + giải thích + TTS ✓ (Task 5 `_answer`), 3 câu ✓ (Task 2 prompt), lưu điểm best/last/attempts ✓ (Task 5 `_saveScore`), Làm lại sinh câu mới ✓ (`_retry` + `clearQuizForPage`), đổi trang không gọi lại API (cache) ✓ (Task 2 `quizCache`)
- API contract (spec 3.3): prompt + JSON schema ✓ (Task 2), parse/validate fallback ✓ (`validateQuizQuestions`)
- Lỗi & fallback (spec 3.7): toast + retry ✓ (Task 5 catch), PDF chưa tải / chưa cấu hình ✓
- Pacing (spec 4.1): `detectTitleSlide` ≤ 20 từ, rỗng → false ✓ (Task 1)
- Pacing (spec 4.2): prompt ngắn, không segments ✓ (Task 3), cache key giữ nguyên + `isTitleSlide` trong result ✓ (Task 3 Step 4)
- Pacing (spec 4.3): onEnd + autoRead + title → 2.5s → navigate next ✓ (Task 6 Step 9); stop reset cờ ✓ (Step 10); prefetch áp dụng ✓ (Step 8)

**2. Placeholder scan:** Không có TBD/TODO/"thêm xử lý lỗi" — mọi bước đều có code đầy đủ.

**3. Type consistency:**
- `detectTitleSlide(pageText)` — Task 1 định nghĩa, Task 6 dùng đúng signature.
- `teachPage(imageBase64, pageNum, pageText, onStream, opts)` — Task 3 đổi signature, Task 6 gọi `teachPage(imageBase64, targetPage, pageText, null, { isTitleSlide })` — khớp.
- `generateQuiz(pageNum, pageText, imageBase64)` — Task 2 định nghĩa, Task 5 gọi đúng.
- `clearQuizForPage(pageNum)` — Task 2 định nghĩa, Task 5 `_retry` dùng đúng.
- `validateQuizQuestions(raw)` — Task 2 export, test dùng đúng.
- IDs trong HTML (Task 4) ↔ QuizManager (Task 5): `tab-chat`, `tab-quiz`, `chat-area`, `quiz-area`, `quiz-title`, `quiz-best-score`, `quiz-empty`, `quiz-empty-text`, `quiz-start-btn`, `quiz-loading`, `quiz-question`, `quiz-question-text`, `quiz-options`, `quiz-feedback`, `quiz-next-btn`, `quiz-result`, `quiz-result-score`, `quiz-retry-btn`, `quiz-close-btn` — tất cả khớp.
- App API dùng từ QuizManager: `app.pdfViewer.currentPage/getPageImageBase64/getPageText/isLoaded`, `app.aiEngine.isConfigured/generateQuiz/clearQuizForPage`, `app.ttsEngine.stop/speak`, `app._isTeaching`, `app._showToast`, `app._showApiKeyModal`, `app._updateVoiceStatus`, `app._cleanVoiceText`, `app._pdfFileName` — tất cả tồn tại trong code hiện tại (đã verify khi đọc app.js).

**Ghi chú triển khai:** server.py không đổi; không thêm dependency; cache export/import (JSON) không chứa quiz cache (đúng spec YAGNI).
