# Quiz bám nội dung + số câu tuỳ chọn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câu hỏi quiz bám sát kiến thức môn học trong trang (cấm câu hỏi meta/số trang/ngoài lề) + dropdown chọn số câu 3/5/10, điểm số hiển thị động /N.

**Architecture:** Sửa `AIEngine.generateQuiz()` thêm tham số `count`, cache key thêm `_${count}`, `clearQuizForPage()` xoá theo prefix. `QuizManager` đọc dropdown `#quiz-count`, truyền count, lưu `total` trong điểm. Dropdown đặt trong `#quiz-empty` cạnh nút "Tạo câu hỏi" — đổi số không tự sinh lại (phương án B). Không đổi server.py, không thêm dependency.

**Tech Stack:** Vanilla JS ES modules, localStorage, Node v20 (unit test `node:assert`), Playwright (QA stub), Web Speech API (giữ nguyên).

**Spec:** `docs/superpowers/specs/2026-08-01-quiz-content-bound-count-design.md`

---

### Task 1: `js/ai-engine.js` — count param + prompt chống meta + cache key mới

**Files:**
- Modify: `js/ai-engine.js` (generateQuiz ~534-583, clearQuizForPage ~585-588)

- [ ] **Step 1: Sửa signature + cache key + systemPrompt của `generateQuiz()`**

Hiện tại `generateQuiz` (lines 534-583) có signature `generateQuiz(pageNum, pageText, imageBase64)`, cache key `quiz_${pageNum}_${this.provider}`, systemPrompt `Tạo CHÍNH XÁC 3 câu hỏi`. Thay bằng:

```javascript
  /**
   * Tạo quiz câu hỏi cho một trang. Cache theo trang + provider + số câu.
   * @param {number} pageNum
   * @param {string} pageText - text đã trích xuất của trang
   * @param {string|null} imageBase64 - ảnh trang (provider có vision thì dùng)
   * @param {number} [count=3] - số câu hỏi (3/5/10)
   * @returns {Promise<Array>} mảng câu hỏi đã validate
   */
  async generateQuiz(pageNum, pageText, imageBase64, count = 3) {
    const n = [3, 5, 10].includes(count) ? count : 3;
    const cacheKey = `quiz_${pageNum}_${this.provider}_${n}`;
    const cached = this.quizCache.get(cacheKey);
    if (cached) return cached;

    if (!pageText || !pageText.trim()) {
      throw new Error('Trang này không có nội dung chữ để tạo câu hỏi.');
    }

    const systemPrompt = `Bạn là giảng viên tạo câu hỏi trắc nghiệm để kiểm tra hiểu bài.
Tạo CHÍNH XÁC ${n} câu hỏi từ nội dung trang tài liệu. Độ khó tăng dần.
Câu hỏi PHẢI về kiến thức môn học có trong nội dung trang (khái niệm, công thức, định nghĩa, số liệu, ví dụ).
TUYỆT ĐỐI KHÔNG hỏi về số trang, layout, định dạng, tiêu đề, hoặc kiến thức không có trong nội dung trang.
Ví dụ: ❌ Sai: "Trang này là trang số mấy?" / ✅ Đúng: "Theo công thức trong trang, giá trị của X là bao nhiêu?"
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
```

**Chi tiết các điểm đổi so với code hiện tại (534-583):**
1. Signature: `generateQuiz(pageNum, pageText, imageBase64)` → `generateQuiz(pageNum, pageText, imageBase64, count = 3)`
2. Dòng đầu method thêm: `const n = [3, 5, 10].includes(count) ? count : 3;`
3. Cache key: `quiz_${pageNum}_${this.provider}` → `quiz_${pageNum}_${this.provider}_${n}`
4. Cache lookup: `const cached = this.quizCache.get(cacheKey);` giữ nguyên (cacheKey mới)
5. SystemPrompt: `Tạo CHÍNH XÁC 3 câu hỏi` → `Tạo CHÍNH XÁC ${n} câu hỏi` + thêm nội dung chống meta/ví dụ đúng sai
6. Cache set: `this.quizCache.set(cacheKey, questions)` — đã dùng cacheKey mới
7. userPrompt, _callAPI, validateQuizQuestions: giữ nguyên

- [ ] **Step 2: Sửa `clearQuizForPage(pageNum)` (lines 585-588)**

Hiện tại xoá MỘT key cụ thể. Sửa thành xoá THEO PREFIX (mọi số câu):

```javascript
  /** Xoá quiz cache của một trang theo prefix (mọi số câu) — dùng cho nút "Làm lại" */
  clearQuizForPage(pageNum) {
    const prefix = `quiz_${pageNum}_${this.provider}_`;
    for (const key of this.quizCache.keys()) {
      if (key.startsWith(prefix)) this.quizCache.delete(key);
    }
  }
```

Thay thế hoàn toàn block hiện tại (lines 585-588):
```javascript
  /** Xoá quiz cache của một trang (dùng cho nút "Làm lại" — sinh câu mới) */
  clearQuizForPage(pageNum) {
    this.quizCache.delete(`quiz_${pageNum}_${this.provider}`);
  }
```

- [ ] **Step 3: Verify**

Run: `node --check js/ai-engine.js`
Expected: exit 0

Run: `node tests/quiz-validate.test.mjs`
Expected: `✅ quiz-validate: tất cả test pass`, exit 0
(Giải thích: `validateQuizQuestions` không đổi — test vẫn pass)

- [ ] **Step 4: Commit**

```bash
GIT_MASTER=1 git add js/ai-engine.js
GIT_MASTER=1 git commit -m "feat: add count param and content-bound prompt to generateQuiz" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 2: `index.html` + `css/style.css` — dropdown số câu

**Files:**
- Modify: `index.html` (quiz empty area ~292-296)
- Modify: `css/style.css` (cuối block quiz, ~615)

- [ ] **Step 1: Thêm dropdown vào `#quiz-empty` trong `index.html`**

Hiện tại `#quiz-empty` (lines 292-296):
```html
          <div id="quiz-empty" class="welcome-message">
            <div class="welcome-icon">📝</div>
            <p id="quiz-empty-text">Tải PDF lên để tạo câu hỏi trắc nghiệm cho trang đang xem.</p>
            <button id="quiz-start-btn" class="btn-primary" disabled>🔄 Tạo câu hỏi cho trang này</button>
          </div>
```

Sửa thành (wrap nút + dropdown trong `.quiz-start-controls`, GIỮ NGUYÊN `id="quiz-start-btn"` và class `btn-primary`):
```html
          <div id="quiz-empty" class="welcome-message">
            <div class="welcome-icon">📝</div>
            <p id="quiz-empty-text">Tải PDF lên để tạo câu hỏi trắc nghiệm cho trang đang xem.</p>
            <div class="quiz-start-controls">
              <label class="quiz-count-label" for="quiz-count">Số câu</label>
              <select id="quiz-count">
                <option value="3" selected>3</option>
                <option value="5">5</option>
                <option value="10">10</option>
              </select>
              <button id="quiz-start-btn" class="btn-primary" disabled>🔄 Tạo câu hỏi cho trang này</button>
            </div>
          </div>
```

- [ ] **Step 2: Thêm CSS vào cuối block quiz trong `style.css`**

Thêm vào sau dòng 615 (`#quiz-empty .btn-primary { margin-top:8px; }`) trong `css/style.css`:

```css
.quiz-start-controls { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.quiz-count-label { font-size: 0.8rem; color: var(--text-secondary); }
#quiz-count {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-sm); color: var(--text-primary);
  font-family: inherit; font-size: 0.85rem; padding: 8px 12px; cursor: pointer;
}
```

(Lưu ý: các biến CSS `--text-secondary`, `--text-primary`, `--radius-sm` đều đã tồn tại trong `:root` — xác nhận tại `style.css:24,25,29`.)

- [ ] **Step 3: Verify**

Start server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
```

Kiểm tra dropdown tồn tại trong HTML:
```bash
curl -s http://localhost:8080/ | grep quiz-count
```
Expected: thấy dòng chứa `<select id="quiz-count">` và các option 3/5/10.

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [ ] **Step 4: Commit**

```bash
GIT_MASTER=1 git add index.html css/style.css
GIT_MASTER=1 git commit -m "feat: add quiz question count dropdown (3/5/10)" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 3: `js/quiz.js` — đọc dropdown, truyền count, điểm /N động

**Files:**
- Modify: `js/quiz.js` (constructor, `_syncForPage`, `_generateForCurrentPage`, `_showResult`, `_saveScore`, `onPdfLoaded`, `_resetToEmpty`)

- [ ] **Step 1: Constructor — thêm `quizCountSelect`**

Sau dòng 17 (`this.quizStartBtn = document.getElementById('quiz-start-btn');`), thêm:

```javascript
    this.quizCountSelect = document.getElementById('quiz-count');
```

- [ ] **Step 2: Thêm method `_getQuizCount()`**

Thêm vào class (trước `_generateForCurrentPage`, sau constructor hoặc sau `_setupEvents`):

```javascript
  /** Số câu hỏi từ dropdown (3/5/10, mặc định 3) */
  _getQuizCount() {
    const v = parseInt(this.quizCountSelect?.value, 10);
    return [3, 5, 10].includes(v) ? v : 3;
  }
```

- [ ] **Step 3: `_generateForCurrentPage()` — truyền count**

Line 150 hiện tại:
```javascript
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64);
```

Sửa thành:
```javascript
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64, this._getQuizCount());
```

- [ ] **Step 4: `_showResult()` — lưu total**

Line 247 hiện tại:
```javascript
    this._saveScore(pageNum, this.correctCount);
```

Sửa thành:
```javascript
    this._saveScore(pageNum, this.correctCount, this.questions.length);
```

- [ ] **Step 5: `_saveScore()` — thêm field `total`**

Sửa signature (line 284) và logic lưu:

```javascript
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
```

Các điểm thay đổi so với hiện tại (lines 284-300):
1. Signature: `_saveScore(pageNum, score)` → `_saveScore(pageNum, score, total = 3)`
2. Default record: `{ best: 0, last: 0, lastTime: 0, attempts: 0 }` → `{ best: 0, last: 0, lastTime: 0, attempts: 0, total: 0 }`
3. Sau `cur.attempts += 1;` thêm: `cur.total = total;`

- [ ] **Step 6: `_syncForPage()` — hiển thị điểm /N động**

Line 99 hiện tại:
```javascript
      this.quizBestScore.textContent = `Điểm cao nhất: ${score.best}/3`;
```

Sửa thành:
```javascript
      this.quizBestScore.textContent = `Điểm cao nhất: ${score.best}/${score.total || 3}`;
```

> **Lý do fallback `|| 3` (không dùng `this.questions.length`):**
> `_syncForPage(pageNum)` chạy Ở DÒNG 75 trong `onPageChanged`, **trước khi** `this.questions = []` được gán ở dòng 77. Nếu dùng `this.questions.length` làm fallback, có thể hiển thị sai số câu của trang cũ. Record cũ (không có trường `total`) luôn là quiz 3 câu — fallback 3 là chính xác.

- [ ] **Step 7: `onPdfLoaded()` — bỏ số "3" trong text**

Line 90 hiện tại:
```javascript
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
```

Sửa thành:
```javascript
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
```

- [ ] **Step 8: `_resetToEmpty()` — bỏ số "3" trong text**

Line 117 hiện tại:
```javascript
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
```

Sửa thành:
```javascript
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
```

- [ ] **Step 9: Verify**

Run: `node --check js/quiz.js`
Expected: exit 0

- [ ] **Step 10: Commit**

```bash
GIT_MASTER=1 git add js/quiz.js
GIT_MASTER=1 git commit -m "feat: wire quiz count dropdown and dynamic score display" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 4: QA stub — count 5/10 render đúng

**Files:**
- Create: `tests/qa-quiz-count.mjs` (theo pattern `tests/smoke-quiz.mjs`)

- [ ] **Step 1: Tạo QA test script**

Tạo file `tests/qa-quiz-count.mjs`:

```javascript
// QA: kiểm tra quiz count dropdown — chọn 5/10 → render đúng N câu, stub nhận count
// Chạy: node tests/qa-quiz-count.mjs  (cần server đang chạy ở localhost:8080)
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const SKIP_ERRS = ['InvalidPDFException', 'Lỗi tải PDF'];
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') {
    const txt = m.text();
    if (!SKIP_ERRS.some(pat => txt.includes(pat))) errors.push('console: ' + txt);
  }
});

const stubCalls = []; // ghi log mỗi lần generateQuiz được gọi
const expectedCounts = []; // để assert sau

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

const modalVisible = await page.isVisible('#api-modal');
if (modalVisible) {
  await page.click('#close-modal');
  await page.waitForTimeout(300);
}

// Inject stub generateQuiz — trả về N câu MCQ giả dựa trên count nhận được
await page.evaluate(() => {
  // Đợi app khởi tạo xong (window.app có sau khi module load)
  // Smoke test chạy được nghĩa là app đã sẵn sàng, ta stub trong evaluate
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  const origGenerateQuiz = window.app.aiEngine.generateQuiz.bind(window.app.aiEngine);
  window.app.aiEngine.generateQuiz = async function(pageNum, pageText, imageBase64, count) {
    window.__qa_stub_calls = window.__qa_stub_calls || [];
    window.__qa_stub_calls.push({ pageNum, count: count || 3 });
    // Sinh N câu MCQ giả
    const questions = [];
    for (let i = 0; i < (count || 3); i++) {
      questions.push({
        type: 'mcq',
        question: `Câu hỏi ${i + 1} của trang ${pageNum}`,
        options: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
        correct_index: 0,
        explanation: 'Giải thích câu ' + (i + 1)
      });
    }
    // Lưu vào cache thật để quiz.js lấy được
    const n = [3, 5, 10].includes(count) ? count : 3;
    const cacheKey = `quiz_${pageNum}_${window.app.aiEngine.provider}_${n}`;
    window.app.aiEngine.quizCache.set(cacheKey, questions);
    return questions;
  };
});

// Upload dummy PDF
const fs = await import('node:fs');
fs.writeFileSync('/tmp/dummy-qa.pdf', '%PDF-1.4\n%EOF');
await page.setInputFiles('#pdf-input', '/tmp/dummy-qa.pdf');
await page.waitForTimeout(1500);

// === TEST 1: dropdown 3 (mặc định) → chọn 5 → bấm tạo → assert 5 câu ===

// Chọn dropdown 5
await page.selectOption('#quiz-count', '5');
await page.waitForTimeout(200);

// Mở tab quiz
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(500);

// Bấm nút tạo quiz
await page.click('#quiz-start-btn', { force: true });
await page.waitForTimeout(2000);

// Assert: câu hỏi hiển thị "Câu 1/5"
const qText1 = await page.textContent('#quiz-question-text');
console.log('Dropdown 5 → question text:', qText1);
if (!qText1.includes('Câu 1/5')) throw new Error(`TEST 1 FAIL: expected "Câu 1/5", got "${qText1}"`);

// Assert: 4 options
const optCount1 = await page.evaluate(() => document.querySelectorAll('.quiz-option').length);
console.log('Dropdown 5 → options count:', optCount1);
if (optCount1 !== 4) throw new Error(`TEST 1 FAIL: expected 4 options, got ${optCount1}`);

// === TEST 2: chọn 10 → làm lại → assert 10 câu ===

// Quay về empty state (bấm "Làm lại")
await page.click('#quiz-retry-btn', { force: true });
await page.waitForTimeout(500);

// Chọn dropdown 10
await page.selectOption('#quiz-count', '10');
await page.waitForTimeout(200);

// Bấm nút tạo quiz (đang ở empty state sau retry)
await page.click('#quiz-start-btn', { force: true });
await page.waitForTimeout(2000);

const qText2 = await page.textContent('#quiz-question-text');
console.log('Dropdown 10 → question text:', qText2);
if (!qText2.includes('Câu 1/10')) throw new Error(`TEST 2 FAIL: expected "Câu 1/10", got "${qText2}"`);

// === TEST 3: assert stub nhận đúng count ===
const calls = await page.evaluate(() => window.__qa_stub_calls || []);
console.log('Stub calls:', JSON.stringify(calls));
const count5call = calls.find(c => c.count === 5);
const count10call = calls.find(c => c.count === 10);
if (!count5call) throw new Error('TEST 3 FAIL: stub không nhận được count=5');
if (!count10call) throw new Error('TEST 3 FAIL: stub không nhận được count=10');

// === TEST 4: đổi dropdown khi đang xem quiz KHÔNG tự sinh lại ===
// Đang xem quiz 10 câu → đổi dropdown → kiểm tra stub không bị gọi thêm
const callsBefore = calls.length;
await page.selectOption('#quiz-count', '3');
await page.waitForTimeout(1000);
const callsAfter = await page.evaluate(() => (window.__qa_stub_calls || []).length);
console.log('Stub calls before dropdown change:', callsBefore, 'after:', callsAfter);
if (callsAfter !== callsBefore) {
  throw new Error(`TEST 4 FAIL: đổi dropdown tự sinh lại quiz (stub gọi thêm ${callsAfter - callsBefore} lần)`);
}

// === Final ===
if (errors.length > 0) {
  console.log('LỖI TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA quiz count PASS');
await browser.close();
```

- [ ] **Step 2: Chạy QA test**

Start server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
```

Run:
```bash
node tests/qa-quiz-count.mjs
```
Expected: `✅ QA quiz count PASS`, exit 0

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [ ] **Step 3: Commit**

```bash
GIT_MASTER=1 git add tests/qa-quiz-count.mjs
GIT_MASTER=1 git commit -m "test: add QA for quiz count dropdown" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 5: README + regression

**Files:**
- Modify: `README.md` (dòng quiz features ~16)

- [ ] **Step 1: Sửa README**

Line 16 hiện tại:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo 3 câu hỏi/trang (trắc nghiệm + đúng/sai), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
```

Sửa thành:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo câu hỏi trắc nghiệm bám sát nội dung trang (3/5/10 câu tuỳ chọn), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
```

- [ ] **Step 2: Chạy regression test**

```bash
node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs
```
Expected: `✅ title-detect: tất cả test pass` + `✅ quiz-validate: tất cả test pass`, exit 0

- [ ] **Step 3: Chạy smoke test**

```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
python3 server.py &
sleep 2
node tests/smoke-quiz.mjs
```
Expected: `✅ Smoke test quiz PASS`, exit 0

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [ ] **Step 4: Commit**

```bash
GIT_MASTER=1 git add README.md
GIT_MASTER=1 git commit -m "docs: update README quiz feature description" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"
```

---

### Task 6: Tổng kiểm tra + kết thúc

- [ ] **Step 1: Kiểm tra git status**

```bash
GIT_MASTER=1 git status
```
Expected: sạch (ngoài `.omo/` và `docs/superpowers/plans/` nếu plan file vẫn unstaged).

- [ ] **Step 2: Liệt kê commits tạo ra**

```bash
GIT_MASTER=1 git log --oneline $(GIT_MASTER=1 git merge-base HEAD main 2>/dev/null || GIT_MASTER=1 git merge-base HEAD master)..HEAD
```
Expected: 5 commits hiện ra (Task 1-5), sắp xếp theo dependency:
1. `feat: add count param and content-bound prompt to generateQuiz`
2. `feat: add quiz question count dropdown (3/5/10)`
3. `feat: wire quiz count dropdown and dynamic score display`
4. `test: add QA for quiz count dropdown`
5. `docs: update README quiz feature description`

---

## Self-Review

**1. Spec coverage:**
- Yêu cầu 1 (câu hỏi bám nội dung môn học): ✓ — systemPrompt mới trong Task 1 thêm chỉ thị "PHẢI về kiến thức môn học" + "TUYỆT ĐỐI KHÔNG hỏi về số trang..." + ví dụ đúng/sai.
- Yêu cầu 2 (cấm tuyệt đối câu meta): ✓ — cùng chỉ thị trên.
- Yêu cầu 3 (dropdown 3/5/10): ✓ — Task 2 thêm `#quiz-count` trong `#quiz-empty`.
- Yêu cầu 4 (đổi số không tự sinh lại — phương án B): ✓ — dropdown chỉ nằm trong `#quiz-empty` (ẩn khi quiz đang làm); QA Task 4 bước 4 assert stub không bị gọi thêm khi đổi dropdown.
- Yêu cầu 5 (cache key mới): ✓ — `quiz_${pageNum}_${this.provider}_${n}` trong Task 1.
- Yêu cầu 6 (Làm lại xoá prefix): ✓ — `clearQuizForPage` dùng vòng lặp `startsWith(prefix)` trong Task 1.
- Yêu cầu 7 (điểm /N động): ✓ — `_saveScore` thêm `total`, `_syncForPage` dùng `score.total || 3`.

**2. Placeholder scan:** Không có TBD/TODO/"thêm xử lý" — mọi bước đều có code đầy đủ.

**3. Type consistency:**
- `generateQuiz(pageNum, pageText, imageBase64, count)` — Task 1 định nghĩa, Task 3 `_generateForCurrentPage` gọi `generateQuiz(pageNum, pageText, imageBase64, this._getQuizCount())` — khớp.
- `clearQuizForPage(pageNum)` — Task 1 sửa, Task `_retry` (quiz.js line 258) vẫn gọi đúng signature — không đổi.
- `_saveScore(pageNum, score, total)` — Task 3 Step 5 sửa signature, Step 4 gọi `_saveScore(pageNum, this.correctCount, this.questions.length)` — khớp.
- `_syncForPage(pageNum)` — dùng `score.total || 3`, record cũ không có `total` → fallback 3 (luôn đúng với quiz 3 câu cũ).
- `#quiz-count` ID trong HTML (Task 2) ↔ `document.getElementById('quiz-count')` trong QuizManager constructor (Task 3 Step 1) — khớp.
- `_getQuizCount()` — trả về `[3, 5, 10].includes(v) ? v : 3`, an toàn với giá trị không hợp lệ.

**4. Edge cases handled:**
- Dropdown value không hợp lệ → `_getQuizCount` fallback về 3.
- QuizManager constructor gọi `document.getElementById('quiz-count')` — nếu DOM chưa có (không thể vì HTML load trước JS module), `_getQuizCount` dùng `?.value` → fallback 3.
- Record cũ không có `total` → `score.total || 3` trong `_syncForPage`.
- `_saveScore` mặc định `total = 3` trong signature — gọi cũ không có total vẫn lưu đúng.

**Ghi chú triển khai:**
- Không đổi server.py, không thêm dependency.
- `quizCache.clear()` trong `clearCache()` (line 592) vẫn dùng `this.quizCache.clear()` — không cần sửa vì xoá toàn bộ map, không phụ thuộc key format.
- `saveSettings()` line 79 cũng gọi `this.quizCache.clear()` — không cần sửa vì lý do tương tự.
- QA test `tests/qa-quiz-count.mjs` viết theo pattern `tests/smoke-quiz.mjs`: Playwright, stub `generateQuiz`, skip console errors từ dummy PDF, assert qua DOM text/options count.
