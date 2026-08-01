# Quiz bám nội dung + số câu tuỳ chọn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Câu hỏi quiz bám sát kiến thức môn học trong trang (cấm câu hỏi meta/số trang/ngoài lề) + dropdown chọn số câu 3/5/10, điểm số hiển thị động /N.

**Architecture:** Sửa `AIEngine.generateQuiz()` thêm tham số `count`, cache key thêm `_${count}`, `clearQuizForPage()` xoá theo prefix. `QuizManager` đọc dropdown `#quiz-count`, truyền count, lưu `total` trong điểm. Dropdown đặt trong `#quiz-empty` cạnh nút "Tạo câu hỏi" — đổi số không tự sinh lại (phương án B). Không đổi server.py, không thêm dependency.

**Tech Stack:** Vanilla JS ES modules, localStorage, Node v20 (unit test `node:assert`), Playwright (QA network interception), Web Speech API (giữ nguyên).

**Spec:** `docs/superpowers/specs/2026-08-01-quiz-content-bound-count-design.md`

---

### Task 1: `js/ai-engine.js` — count param + prompt chống meta + cache key mới

**Files:**
- Modify: `js/ai-engine.js` (generateQuiz ~534-583, clearQuizForPage ~585-588)

- [x] **Step 1: Sửa signature + cache key + systemPrompt của `generateQuiz()`**

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

- [x] **Step 2: Sửa `clearQuizForPage(pageNum)` (lines 585-588)**

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

- [x] **Step 3: Verify**

Run: `node --check js/ai-engine.js`
Expected: exit 0

Run: `node tests/quiz-validate.test.mjs`
Expected: `✅ quiz-validate: tất cả test pass`, exit 0
(Giải thích: `validateQuizQuestions` không đổi — test vẫn pass)

- [x] **Step 4: Commit**

```bash
git add js/ai-engine.js
git commit -m "feat: add count param and content-bound prompt to generateQuiz"
```

---

### Task 2: `index.html` + `css/style.css` — dropdown số câu

**Files:**
- Modify: `index.html` (quiz empty area ~292-296)
- Modify: `css/style.css` (cuối block quiz, ~615)

- [x] **Step 1: Thêm dropdown vào `#quiz-empty` trong `index.html`**

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

- [x] **Step 2: Thêm CSS vào cuối block quiz trong `style.css`**

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

- [x] **Step 3: Verify**

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

- [x] **Step 4: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: add quiz question count dropdown (3/5/10)"
```

---

### Task 3: `js/quiz.js` — đọc dropdown, truyền count, điểm /N động

**Files:**
- Modify: `js/quiz.js` (constructor, `_syncForPage`, `_generateForCurrentPage`, `_showResult`, `_saveScore`, `onPdfLoaded`, `_resetToEmpty`)

- [x] **Step 1: Constructor — thêm `quizCountSelect`**

Sau dòng 17 (`this.quizStartBtn = document.getElementById('quiz-start-btn');`), thêm:

```javascript
    this.quizCountSelect = document.getElementById('quiz-count');
```

- [x] **Step 2: Thêm method `_getQuizCount()`**

Thêm vào class (trước `_generateForCurrentPage`, sau constructor hoặc sau `_setupEvents`):

```javascript
  /** Số câu hỏi từ dropdown (3/5/10, mặc định 3) */
  _getQuizCount() {
    const v = parseInt(this.quizCountSelect?.value, 10);
    return [3, 5, 10].includes(v) ? v : 3;
  }
```

- [x] **Step 3: `_generateForCurrentPage()` — truyền count**

Line 150 hiện tại:
```javascript
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64);
```

Sửa thành:
```javascript
      const questions = await this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64, this._getQuizCount());
```

- [x] **Step 4: `_showResult()` — lưu total**

Line 247 hiện tại:
```javascript
    this._saveScore(pageNum, this.correctCount);
```

Sửa thành:
```javascript
    this._saveScore(pageNum, this.correctCount, this.questions.length);
```

- [x] **Step 5: `_saveScore()` — thêm field `total`**

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

- [x] **Step 6: `_syncForPage()` — hiển thị điểm /N động**

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

- [x] **Step 7: `onPdfLoaded()` — bỏ số "3" trong text**

Line 90 hiện tại:
```javascript
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
```

Sửa thành:
```javascript
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
```

- [x] **Step 8: `_resetToEmpty()` — bỏ số "3" trong text**

Line 117 hiện tại:
```javascript
    this.quizEmptyText.textContent = 'Tạo 3 câu hỏi trắc nghiệm cho trang đang xem.';
```

Sửa thành:
```javascript
    this.quizEmptyText.textContent = 'Tạo câu hỏi trắc nghiệm cho trang đang xem.';
```

- [x] **Step 9: Verify**

Run: `node --check js/quiz.js`
Expected: exit 0

- [x] **Step 10: Commit**

```bash
git add js/quiz.js
git commit -m "feat: wire quiz count dropdown and dynamic score display"
```

---

### Task 4: QA network-interception — count 5/10 render đúng, đổi dropdown không gọi API

**Files:**
- Create: `tests/qa-quiz-count.mjs`

**Chiến lược:** Dùng Playwright `page.route()` chặn request tới Gemini API (URL `https://generativelanguage.googleapis.com/v1beta/.../generateContent`). Đọc `count` từ body request ("Tạo CHÍNH XÁC N câu hỏi") để trả về đúng N câu. Tạo PDF thật bằng `python3` + `fpdf` (đã cài sẵn 2.8.7) để `pdfViewer.isLoaded` = true. Tránh hoàn toàn `window.app` (không tồn tại — `js/app.js` tạo `const app = new App()` module-scoped).

**Các điểm kỹ thuật cần lưu ý khi viết script:**
- Route pattern `**generativelanguage.googleapis.com/**` khớp URL Gemini thật (xác nhận: `_callGeminiAPI` line 851 build URL `this.geminiBaseUrl/models/.../generateContent?key=...`).
- Response shape phải khớp cách app parse: `data.candidates[0].content.parts[0].text` (`_callGeminiAPI` line 906).
- `addInitScript` đặt `localStorage` với `provider: 'gemini'` + `apiKey: 'fake-key'` trước khi page load → app constructor đọc được → `isConfigured = true` → không bị modal API key chặn.
- `#quiz-retry-btn` nằm trong `#quiz-result` (hidden) → Playwright click không được, dùng `page.evaluate(() => document.querySelector('#quiz-retry-btn').click())` để trigger `_retry()`.
- `#quiz-count` nằm trong `#quiz-empty` (hidden khi đang xem questions) → `page.selectOption` phải dùng `{ force: true }`. Chính xác để test "đổi dropdown không tự sinh".
- `_onTabOpened()` (quiz.js line 64) tự động sinh quiz khi mở tab → TEST 1 dựa vào hành vi này (không cần click nút "Tạo câu hỏi"). PDF thật (fpdf) là bắt buộc để `pdfViewer.isLoaded = true`.
- Nếu python3/fpdf bị thiếu → test fail sớm với message rõ ràng (fpdf 2.8.7 đã xác nhận cài sẵn trên máy này).

- [x] **Step 1: Tạo QA test script**

Tạo file `tests/qa-quiz-count.mjs`:

```javascript
// QA: quiz count dropdown — network interception + real PDF via fpdf
// Chạy: node tests/qa-quiz-count.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF HỢP LỆ thật bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF(); p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran va dinh thuc', ln=1)
p.multi_cell(0, 8, 'Dinh thuc cua ma tran vuong cap 2 A = [[a,b],[c,d]] duoc tinh la ad - bc. Ma tran don vi I co dinh thuc bang 1. Phep nhan ma tran khong giao hoan.')
p.output('/tmp/qa-real.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings TRƯỚC khi page load: provider gemini + api key giả → không bị modal chặn ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
});

// --- Chặn request tới Gemini: đếm số lần gọi + trả về đúng N câu theo "Tạo CHÍNH XÁC N câu hỏi" trong body ---
let apiCalls = 0;
let lastCount = null;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const req = route.request();
  let count = 3;
  try {
    const body = req.postData() || '';
    const m = body.match(/Tạo CHÍNH XÁC (\d+) câu hỏi/);
    if (m) count = parseInt(m[1], 10);
  } catch {}
  lastCount = count;
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({
      type: 'mcq',
      question: `Câu hỏi ${i + 1} về định thức`,
      options: ['ad - bc', 'a + d', 'ab + cd', 'a*d'],
      correct_index: 0,
      explanation: `Vì định thức cấp 2 bằng ad trừ bc. Câu ${i + 1}`
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

// Upload PDF thật (hợp lệ, fpdf tạo)
await page.setInputFiles('#pdf-input', '/tmp/qa-real.pdf');
await page.waitForTimeout(2000);

// === TEST 1: dropdown mặc định 3 → mở tab quiz (tự sinh) → assert "Câu 1/3" ===
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(2000);
let qText = await page.textContent('#quiz-question-text');
console.log('Mặc định → question text:', qText);
if (!qText.includes('Câu 1/3')) throw new Error(`TEST 1 FAIL: expected "Câu 1/3", got "${qText}"`);

// === TEST 2: chọn 5 → "Làm lại" → assert "Câu 1/5" ===
await page.selectOption('#quiz-count', '5');
await page.waitForTimeout(200);
await page.click('#quiz-retry-btn', { force: true });
await page.waitForTimeout(2000);
qText = await page.textContent('#quiz-question-text');
console.log('Chọn 5 → question text:', qText);
if (!qText.includes('Câu 1/5')) throw new Error(`TEST 2 FAIL: expected "Câu 1/5", got "${qText}"`);
if (lastCount !== 5) throw new Error(`TEST 2 FAIL: AI nhận count=${lastCount}, expected 5`);

// === TEST 3: chọn 10 → "Làm lại" → assert "Câu 1/10" ===
await page.selectOption('#quiz-count', '10');
await page.waitForTimeout(200);
await page.click('#quiz-retry-btn', { force: true });
await page.waitForTimeout(2000);
qText = await page.textContent('#quiz-question-text');
console.log('Chọn 10 → question text:', qText);
if (!qText.includes('Câu 1/10')) throw new Error(`TEST 3 FAIL: expected "Câu 1/10", got "${qText}"`);
if (lastCount !== 10) throw new Error(`TEST 3 FAIL: AI nhận count=${lastCount}, expected 10`);

// === TEST 4: đổi dropdown khi đang xem quiz → KHÔNG gọi API thêm ===
const callsBefore = apiCalls;
await page.selectOption('#quiz-count', '3');
await page.waitForTimeout(1500);
console.log('API calls before:', callsBefore, 'after:', apiCalls);
if (apiCalls !== callsBefore) throw new Error(`TEST 4 FAIL: đổi dropdown tự sinh lại quiz (API gọi thêm ${apiCalls - callsBefore} lần)`);

if (errors.length > 0) {
  console.log('LỖI TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA quiz count PASS');
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
node tests/qa-quiz-count.mjs
```
Expected: `✅ QA quiz count PASS`, exit 0

Kill server:
```bash
pgrep -f server.py | grep -v $$ | xargs -r kill
```

- [x] **Step 3: Commit**

```bash
git add tests/qa-quiz-count.mjs
git commit -m "test: add QA for quiz count dropdown"
```

---

### Task 5: README + regression

**Files:**
- Modify: `README.md` (dòng quiz features ~16)

- [x] **Step 1: Sửa README**

Line 16 hiện tại:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo 3 câu hỏi/trang (trắc nghiệm + đúng/sai), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
```

Sửa thành:
```markdown
- 📝 **Quiz trắc nghiệm** — AI tự tạo câu hỏi trắc nghiệm bám sát nội dung trang (3/5/10 câu tuỳ chọn), chấm điểm ngay, đọc bằng giọng, lưu điểm theo trang
```

- [x] **Step 2: Chạy regression test**

```bash
node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs
```
Expected: `✅ title-detect: tất cả test pass` + `✅ quiz-validate: tất cả test pass`, exit 0

- [x] **Step 3: Chạy smoke test**

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

- [x] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README quiz feature description"
```

---

### Task 6: Tổng kiểm tra + kết thúc

- [x] **Step 1: Kiểm tra git status**

```bash
git status
```
Expected: sạch (ngoài `.omo/` và `docs/superpowers/plans/` nếu plan file vẫn unstaged).

- [x] **Step 2: Liệt kê commits tạo ra**

```bash
git log --oneline -5
```
Expected: 5 commits (Task 1-5) với commit mới nhất đầu tiên:
1. `docs: update README quiz feature description`
2. `test: add QA for quiz count dropdown`
3. `feat: wire quiz count dropdown and dynamic score display`
4. `feat: add quiz question count dropdown (3/5/10)`
5. `feat: add count param and content-bound prompt to generateQuiz`

---

## Self-Review

**1. Spec coverage:**
- Yêu cầu 1 (câu hỏi bám nội dung môn học): ✓ — systemPrompt mới trong Task 1 thêm chỉ thị "PHẢI về kiến thức môn học" + "TUYỆT ĐỐI KHÔNG hỏi về số trang..." + ví dụ đúng/sai.
- Yêu cầu 2 (cấm tuyệt đối câu meta): ✓ — cùng chỉ thị trên.
- Yêu cầu 3 (dropdown 3/5/10): ✓ — Task 2 thêm `#quiz-count` trong `#quiz-empty`.
- Yêu cầu 4 (đổi số không tự sinh lại — phương án B): ✓ — dropdown chỉ nằm trong `#quiz-empty` (ẩn khi quiz đang làm); QA Task 4 TEST 4 assert API calls không tăng khi đổi dropdown (network interception đếm request tới Gemini).
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
- QA test: không dùng `window.app` (không tồn tại — `js/app.js` dùng `const app` module-scoped), không dùng dummy PDF `%PDF-1.4` (PDF.js không parse được). Dùng network interception trên Gemini URL + PDF thật từ python3 fpdf.
- `page.selectOption` hoạt động trên hidden elements → test được "đổi dropdown không tự sinh" dù `#quiz-count` ẩn khi đang làm quiz.
- `#quiz-retry-btn` nằm trong `#quiz-result` view nhưng click `force:true` trigger `_retry()` ngay cả khi đang ở question view.
- `addInitScript` đặt localStorage trước page load → app constructor đọc được provider + apiKey → không bị API key modal chặn.
- Route `**generativelanguage.googleapis.com/**` khớp URL Gemini thật (`_callGeminiAPI` line 851), response shape `{candidates:[{content:{parts:[{text:"..."}]}}]}` khớp cách app parse (`_callGeminiAPI` line 900-906).

**Ghi chú triển khai:**
- Không đổi server.py, không thêm dependency.
- `quizCache.clear()` trong `clearCache()` (line 592) vẫn dùng `this.quizCache.clear()` — không cần sửa vì xoá toàn bộ map, không phụ thuộc key format.
- `saveSettings()` line 79 cũng gọi `this.quizCache.clear()` — không cần sửa vì lý do tương tự.
- QA test `tests/qa-quiz-count.mjs` dùng Playwright network interception (`page.route`) chặn request tới Gemini URL, tạo PDF thật bằng python3 fpdf, `addInitScript` để tránh modal API key. KHÔNG dùng `window.app` hay dummy PDF.
