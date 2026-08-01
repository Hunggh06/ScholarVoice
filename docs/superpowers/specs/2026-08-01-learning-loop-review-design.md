# Learning loop: Kiểm tra ngay sau giảng + Ôn tập trang yếu

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Trạng thái:** Đã được user duyệt (2026-08-01)

**Chứa:** Feature #6 "Kiểm tra ngay sau khi giảng" + Feature #1 "Ôn tập trang yếu"

---

## 1. Vấn đề

1. Sau khi giảng xong một trang, người học có thể muốn tự kiểm tra ngay xem mình hiểu bài đến đâu. Hiện tại phải tự chuyển sang tab Quiz rồi bấm "Tạo câu hỏi" — nhiều bước, dễ bỏ qua.
2. Khi học nhiều trang, điểm quiz một số trang thấp (< 60%) — người học không có cách nào hệ thống để ôn lại các trang yếu này.

---

## 2. Mục tiêu

1. **Kiểm tra ngay (Feature #6):** Sau khi giảng xong một trang, voice status bar hiển thị nút "📝 Kiểm tra ngay" để người học chuyển nhanh sang làm quiz cho trang vừa giảng.
2. **Ôn tập trang yếu (Feature #1):** Tab Quiz có nút "📚 Ôn tập trang yếu" — lần lượt kiểm tra lại các trang có điểm quiz < 60%, hiển thị báo cáo cải thiện sau khi ôn xong.

---

## 3. Yêu cầu (đã chốt với user — KHÔNG thay đổi)

### Feature #6 — Kiểm tra ngay

| # | Yêu cầu | Ghi chú |
|---|---|---|
| 1 | Sau khi giảng **XONG** 1 trang (TTS end), voice bar hiện nút "📝 Kiểm tra ngay" | Điểm kết thúc: `app.js:924-941` — callback `ttsEngine.onEnd`, state `'done'`. KHÔNG hiện nút khi `state === 'done'` do trả lời chat (`app.js:1087-1089`). |
| 2 | KHÔNG tự động chuyển tab | Người học chủ động bấm nút, không bị ép chuyển tab. |
| 3 | Bấm nút → chuyển sang tab Quiz + tự sinh quiz cho trang vừa giảng | Dùng `QuizManager.switchTab('quiz')` + `generateQuiz` — tái sử dụng count từ dropdown hiện có. |
| 4 | Settings thêm toggle "Tự kiểm tra sau mỗi trang giảng" | Toggle trong modal `#api-modal` (`index.html:29-89`). Lưu key `teachThenQuiz` trong `ai_settings` localStorage (`ai-engine.js:8`). **Mặc định BẬT**. Tắt → không hiện nút "Kiểm tra ngay". |

### Feature #1 — Ôn tập trang yếu

| # | Yêu cầu | Ghi chú |
|---|---|---|
| 5 | Trang yếu = điểm quiz < 60% | Công thức: `score.best / (score.total \|\| 3)` < 0.6. Dữ liệu từ `localStorage` key `quiz_scores_<filename>` (`quiz.js:284`). |
| 6 | Tab Quiz thêm nút "📚 Ôn tập trang yếu" | Chỉ hiện khi ≥ 1 trang yếu trong file PDF đang mở. Đặt trong `#quiz-header` của `#quiz-area`. |
| 7 | Review lần lượt từng trang yếu theo thứ tự trang | Mỗi trang yếu: gọi `clearQuizForPage(ai-engine.js:590)` **trước** `generateQuiz` để xoá cache → sinh quiz mới. Người học làm xong → tự chuyển sang trang yếu kế tiếp. |
| 8 | Báo cáo kết thúc review | Dạng: `Trang 3: 2/3 → 3/3 ✅ \| Trang 7: 1/3 → 2/3 ✅`. ✅ nếu điểm mới ≥ 60%. Hiển thị trong khu vực `#quiz-area` (element review report riêng). |
| 9 | Điểm review lưu đè `quiz_scores` | `_saveScore()` (`quiz.js:291-308`) đã lưu đè `cur.last` và `cur.best = Math.max(cur.best, score)`. Trang tự động hết yếu nếu đạt ≥ 60%. Không cần thay đổi logic lưu. |
| 10 | Bỏ qua trang không phải trang nội dung (title slide) | Dùng `detectTitleSlide` (`app.js:10`) nếu đã có page text trong cache; nếu không có text → kiểm tra qua `ai-engine.js:pageCache` key `page_<num>_...` có `isTitleSlide === true` không. |

---

## 4. Thiết kế chi tiết

### A. `js/app.js` — Kiểm tra ngay (Feature #6)

| # | File | Thay đổi | Chi tiết |
|---|---|---|---|
| 1 | `app.js:12-31` | Constructor | Thêm `this._teachThenQuiz = true;` (mặc định BẬT). Sau khởi tạo AIEngine, gọi `this._loadTeachThenQuizSetting()`. |
| 2 | `app.js` (method mới) | `_loadTeachThenQuizSetting()` | Đọc `JSON.parse(localStorage.getItem('ai_settings') || '{}').teachThenQuiz` — nếu `undefined` thì mặc định `true`. |
| 3 | `app.js:44-62` | `init()` | Gọi `this._setupQuizNowBtn()` — thêm vào cuối `init()`. |
| 4 | `app.js` (method mới) | `_setupQuizNowBtn()` | Lấy `#quiz-now-btn` từ DOM. Gắn click handler → gọi `this._onQuizNowClick()`. |
| 5 | `app.js` (method mới) | `_onQuizNowClick()` | `this.quizManager.switchTab('quiz')` rồi gọi `this.quizManager._generateForCurrentPage()`. Không cần navigate vì đang ở đúng trang. |
| 6 | `app.js:924-941` | `ttsEngine.onEnd` | Trong callback `onEnd`, sau `_updateVoiceStatus('done', ...)` (line 927): nếu `this._teachThenQuiz` → `document.getElementById('quiz-now-btn').classList.remove('hidden')`. |
| 7 | `app.js:985-1024` | `_updateVoiceStatus()` | Với case `'idle'`, `'speaking'`, `'analyzing'`, `'loading'`: luôn `classList.add('hidden')` cho `#quiz-now-btn` để ẩn nút khi bắt đầu giảng trang mới. |
| 8 | `app.js:649-676` | `_navigatePage()` | Trong `_navigatePage`, ẩn `#quiz-now-btn` (vì sắp giảng trang mới / chuyển trang). |
| 9 | `app.js:392-488` | `_showApiKeyModal()` / `_setupSettingsBtn()` | **Đọc** toggle `teachThenQuiz` từ `ai_settings` khi mở modal (`app.js:397` → thêm dòng gán checkbox). **Lưu**: trong `save-api-key` click handler (`app.js:453`), thêm `teachThenQuiz: document.getElementById('teach-then-quiz-toggle').checked` vào object gửi `this.aiEngine.saveSettings()`. Sau lưu: gọi `this._loadTeachThenQuizSetting()`. |

### B. `js/ai-engine.js` — Settings (Feature #6)

| # | File | Thay đổi | Chi tiết |
|---|---|---|---|
| 1 | `ai-engine.js:8` | Constructor | Thêm `this.teachThenQuiz = saved.teachThenQuiz !== undefined ? saved.teachThenQuiz : true;`. |
| 2 | `ai-engine.js:47-83` | `saveSettings()` | Thêm `if (settings.teachThenQuiz !== undefined) this.teachThenQuiz = settings.teachThenQuiz;` trong phần gán biến. |
| 3 | `ai-engine.js:62-75` | `saveSettings()` localStorage | Thêm `teachThenQuiz: this.teachThenQuiz` vào object lưu `ai_settings`. |

### C. `index.html` — UI (Feature #6 + #1)

| # | File | Thay đổi | Chi tiết |
|---|---|---|---|
| 1 | `index.html:240-244` | Voice bar | **Sau** `<div id="voice-controls">...</div>` (line 243), thêm: `<button id="quiz-now-btn" class="voice-btn quiz-now-btn hidden" title="Kiểm tra kiến thức trang vừa giảng">📝 Kiểm tra ngay</button>`. |
| 2 | `index.html:29-89` | Settings modal | Trong `#api-modal` → `.modal-card`, **sau** `</div>` của `#deepseek-settings` (line 82), thêm block toggle: `<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;cursor:pointer;"><input type="checkbox" id="teach-then-quiz-toggle" checked style="accent-color:var(--accent);"> Tự động đề xuất kiểm tra sau mỗi trang giảng</label>`. |
| 3 | `index.html:287-290` | Quiz header | **Sau** `<span id="quiz-best-score" class="hidden"></span>` (line 289), thêm: `<button id="quiz-review-btn" class="btn-ghost hidden" style="font-size:0.75rem;padding:4px 10px;" title="Ôn tập các trang có điểm thấp">📚 Ôn tập trang yếu</button>`. |
| 4 | `index.html` (mới) | Quiz body — review report | **Sau** `<div id="quiz-result" class="hidden">...</div>` (line 322), thêm: `<div id="quiz-review-report" class="hidden" style="padding:16px;display:flex;flex-direction:column;gap:12px;flex:1;overflow-y:auto;"><div id="quiz-review-list"></div><button id="quiz-review-done-btn" class="btn-primary" style="align-self:center;">✅ Đóng báo cáo</button></div>`. |

**Vị trí chính xác trong code sẽ chèn nút:**

- **Nút "📝 Kiểm tra ngay"**: `index.html:243` — sau `</div>` của `<div id="voice-controls">`, bên trong `<div class="voice-right">`. Hiển thị/ẩn tại `app.js:985-1024` (`_updateVoiceStatus` case `'done'`), click handler tại `app.js:873` (`_setupVoiceControls`).
- **Nút "📚 Ôn tập trang yếu"**: `index.html:289` — sau `<span id="quiz-best-score">`, bên trong `<div id="quiz-header">`. Hiển thị/ẩn tại `quiz.js:96-105` (`_syncForPage`), click handler tại `quiz.js:40-52` (`_setupEvents`).

### D. `css/style.css` — Style (Feature #6 + #1)

| # | File | Thay đổi | Chi tiết |
|---|---|---|---|
| 1 | `style.css:367-377` (sau `.voice-btn`) | `#quiz-now-btn` | Thêm selector: `#quiz-now-btn { width:auto; padding:0 14px; font-size:0.82rem; font-weight:600; white-space:nowrap; }` — nút rộng hơn voice-btn tiêu chuẩn để chứa text "📝 Kiểm tra ngay". |
| 2 | `style.css:377` (sau `.voice-btn.retry-btn`) | `#quiz-now-btn:hover` | `#quiz-now-btn:hover:not(:disabled) { background:rgba(0,242,254,0.12); border-color:var(--accent); color:var(--accent); box-shadow:0 0 12px var(--accent-glow); }` — màu accent nổi bật. |
| 3 | `style.css:615-622` (sau `#quiz-result`) | `#quiz-review-report` | Thêm style: `#quiz-review-report { ... }` và `#quiz-review-list { font-size:0.9rem; line-height:1.8; }`. |
| 4 | `style.css:614` (sau `#quiz-result-score`) | `#quiz-review-list .improved` | `.review-item { display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:var(--radius-sm); }` + `.review-item.pass { border-left:3px solid var(--green); }` + `.review-item.fail { border-left:3px solid var(--red); }`. |

### E. `js/quiz.js` — Ôn tập trang yếu (Feature #1)

| # | File | Thay đổi | Chi tiết |
|---|---|---|---|
| 1 | `quiz.js:6-38` | Constructor | Thêm tham chiếu: `this.quizReviewBtn = document.getElementById('quiz-review-btn');` và `this.quizReviewReport = document.getElementById('quiz-review-report');` và `this.quizReviewList = document.getElementById('quiz-review-list');` và `this.quizReviewDoneBtn = document.getElementById('quiz-review-done-btn');`. Thêm state: `this._reviewMode = false;`, `this._weakPages = [];`, `this._reviewIndex = -1;`, `this._reviewReport = {};`. |
| 2 | `quiz.js:40-52` | `_setupEvents()` | Thêm: `this.quizReviewBtn.addEventListener('click', () => this._startWeakPageReview());` và `this.quizReviewDoneBtn.addEventListener('click', () => this._closeReviewReport());`. |
| 3 | `quiz.js` (method mới) | `_getWeakPages()` | Tính danh sách trang yếu: `Object.entries(quiz_scores_<filename>)` filter `score.best / (score.total \|\| 3) < 0.6`, sort theo `parseInt(key)`. Lấy `filename` từ `this.app._pdfFileName`. Trả về `number[]`. |
| 4 | `quiz.js:96-105` | `_syncForPage(pageNum)` | Thêm ở cuối: gọi `this._updateReviewBtn()` — kiểm tra nếu đang có file PDF đã mở và `_getWeakPages().length > 0` thì hiện `#quiz-review-btn`, ngược lại ẩn. |
| 5 | `quiz.js:89-93` | `onPdfLoaded()` | Thêm `this._updateReviewBtn();` vào cuối. |
| 6 | `quiz.js:107-119` | `_resetToEmpty()` | Thêm `this._updateReviewBtn();` vào cuối. |
| 7 | `quiz.js` (method mới) | `_updateReviewBtn()` | `const weak = this._getWeakPages(); this.quizReviewBtn.classList.toggle('hidden', weak.length === 0);`. Không gọi nếu `this.app.pdfViewer.isLoaded === false`. |
| 8 | `quiz.js` (method mới) | `_startWeakPageReview()` | 1. `this._weakPages = this._getWeakPages()` (sắp xếp tăng dần). 2. Nếu rỗng → toast "Không có trang yếu nào." và return. 3. `this._reviewMode = true; this._reviewIndex = 0; this._reviewReport = {};`. 4. Gọi `this._reviewCurrentPage()`. |
| 9 | `quiz.js` (method mới) | `_reviewCurrentPage()` | `const pageNum = this._weakPages[this._reviewIndex];`. Lưu điểm cũ: `this._reviewReport[pageNum] = { oldScore: ... }`. 1. `this.app.pdfViewer.renderPage(pageNum)` + cập nhật UI. 2. `this.app.aiEngine.clearQuizForPage(pageNum)`. 3. `this.questions = [];` reset state. 4. `this._generateForCurrentPage()` — quiz sẽ tự sinh cho trang mới. |
| 10 | `quiz.js:252-260` | `_showResult()` | **Sau** `this._syncForPage(pageNum)` (line 259), thêm: `if (this._reviewMode) this._onReviewPageDone(pageNum);`. |
| 11 | `quiz.js` (method mới) | `_onReviewPageDone(pageNum)` | 1. Lưu điểm mới → `this._reviewReport[pageNum].newScore = { correct, total }`. 2. `this._reviewIndex++`. 3. Nếu `this._reviewIndex >= this._weakPages.length` → `this._showReviewReport()`. 4. Ngược lại → `this._reviewCurrentPage()` (tự chuyển sang trang yếu kế tiếp). |
| 12 | `quiz.js` (method mới) | `_showReviewReport()` | 1. `this._reviewMode = false;`. 2. Duyệt `this._reviewReport` theo `pageNum` tăng dần: render từng dòng `Trang X: old → new ✅/❌` (✅ nếu `newScore.correct/newScore.total >= 0.6`). 3. Ẩn các quiz section khác, hiện `#quiz-review-report`. |
| 13 | `quiz.js` (method mới) | `_closeReviewReport()` | Ẩn `#quiz-review-report`, reset về `_resetToEmpty()`, gọi `this._updateReviewBtn()`. |
| 14 | `quiz.js:75-86` | `onPageChanged(pageNum)` | Trong review mode: KHÔNG reset quiz — skip toàn bộ logic reset (vì `_reviewCurrentPage` đã tự gọi `_generateForCurrentPage` sau khi navigate). Thêm guard: `if (this._reviewMode) return;` ở đầu hàm. |

---

## 5. Không làm (YAGNI)

| # | Mục | Lý do |
|---|---|---|
| 1 | Tự chuyển tab Quiz sau khi giảng xong | User chốt: KHÔNG tự chuyển, để người học chủ động bấm nút. |
| 2 | Đổi `server.py` | Không liên quan. |
| 3 | Thêm dependency mới | Không cần — dùng localStorage có sẵn. |
| 4 | Tự sinh quiz cho cả trang KHÔNG yếu trong review | Chỉ review trang yếu (< 60%), không review trang đã đạt. |
| 5 | Persist `_reviewReport` ra localStorage | Chỉ hiển thị trong phiên, không cần lưu dài hạn. |
| 6 | Cho phép bỏ qua trang trong review | MVP: làm tuần tự hết mới xong. Có thể thêm "Bỏ qua" sau này. |
| 7 | Review trang yếu khi chưa từng làm quiz | Trang chưa có score → không có trong `quiz_scores` → không phải trang yếu. |
| 8 | Gộp điểm review với điểm quiz thường | Điểm review đã lưu đè `quiz_scores` qua `_saveScore` hiện có — không cần phân biệt. |

---

## 6. Tác động file

| File | Thay đổi |
|---|---|
| `js/app.js` | Thêm `_teachThenQuiz`, `_loadTeachThenQuizSetting()`, `_setupQuizNowBtn()`, `_onQuizNowClick()`. Sửa `_updateVoiceStatus` (hiện/ẩn nút quiz-now), `ttsEngine.onEnd` (hiện nút khi done), `_navigatePage` (ẩn nút), `_showApiKeyModal`/`save-api-key` (đọc/ghi toggle teachThenQuiz). |
| `js/ai-engine.js` | Thêm `this.teachThenQuiz` trong constructor + `saveSettings` + `getSettings`. |
| `js/quiz.js` | Thêm `quizReviewBtn`, `quizReviewReport`, `quizReviewList`, `quizReviewDoneBtn` refs + review state (`_reviewMode`, `_weakPages`, `_reviewIndex`, `_reviewReport`). Thêm methods: `_getWeakPages()`, `_updateReviewBtn()`, `_startWeakPageReview()`, `_reviewCurrentPage()`, `_onReviewPageDone()`, `_showReviewReport()`, `_closeReviewReport()`. Sửa `_setupEvents`, `_syncForPage`, `onPdfLoaded`, `_resetToEmpty`, `_showResult`, `onPageChanged`. |
| `index.html` | Thêm `#quiz-now-btn` trong voice bar (sau `#voice-controls`). Thêm toggle `#teach-then-quiz-toggle` trong settings modal. Thêm `#quiz-review-btn` trong `#quiz-header`. Thêm `#quiz-review-report` + `#quiz-review-list` + `#quiz-review-done-btn` trong `#quiz-body`. |
| `css/style.css` | Thêm style `#quiz-now-btn`, `.review-item`, `.review-item.pass`, `.review-item.fail`, `#quiz-review-report`, `#quiz-review-list`. |
| `docs/...` | Design doc này. |

---

## 7. Rủi ro & lưu ý

- **State `'done'` từ chat cũng trigger**: `app.js:1087-1089` gọi `_updateVoiceStatus('done', ...)` khi trả lời chat. Cần phân biệt: chỉ hiện nút "Kiểm tra ngay" khi `state === 'done'` do `ttsEngine.onEnd`, không phải do chat. Giải pháp: đặt flag `this._justTaught = true` trong `onEnd`, xoá trong `_updateVoiceStatus` sau khi hiển thị nút, hoặc kiểm tra `this._isTeaching` vừa được set `false`.
- **_reviewCurrentPage** gọi `renderPage` → trigger `onPageChanged` → trong review mode cần skip reset quiz (guard `if (this._reviewMode) return;`). Nếu không guard, `onPageChanged` sẽ reset quiz vừa sinh xong.
- **Quiz count dropdown**: Trong review mode, `_getQuizCount()` vẫn đọc giá trị dropdown hiện tại → nhất quán với hành vi B: số câu do người dùng chọn từ dropdown 3/5/10.
- **Điểm cũ trong báo cáo**: Dùng `score.best` từ `quiz_scores` trước khi review. Sau review, `_saveScore` đã lưu đè → dữ liệu cũ biến mất. Cần **chụp** điểm cũ (`oldScore`) trước khi gọi `_generateForCurrentPage` (vì đến khi `_showResult` gọi `_saveScore` thì score cũ đã bị đè). Lưu vào `this._reviewReport[pageNum].oldScore` trước khi clear + generate.
- **`detectTitleSlide` require page text**: Trong `_reviewCurrentPage`, nếu muốn bỏ qua title slide, cần gọi `this.app.pdfViewer.getTextForPage(pageNum)` để có text rồi mới gọi `detectTitleSlide`. Có thể async tốn thời gian. Giải pháp thay thế: kiểm tra `this.app.aiEngine.pageCache` key `page_<num>_<provider>_<style>` có `isTitleSlide: true` không (đã lưu từ `teachPage`). Nếu chưa có cache → mặc định không skip (an toàn — vẫn cho review).
- **Nút "Làm lại" trong review mode**: Khi đang review mà user bấm "Làm lại" (`_retry`), sẽ xoá cache và sinh lại quiz cho trang yếu hiện tại — hành vi đúng, không cần thay đổi.
- **Tắt tab Quiz giữa review**: Nếu user chuyển sang tab Chat giữa lúc đang review → cần huỷ review mode. Giải pháp: trong `switchTab('chat')`, nếu `this._reviewMode` → gọi `this._reviewMode = false` và reset.

(End of file)
