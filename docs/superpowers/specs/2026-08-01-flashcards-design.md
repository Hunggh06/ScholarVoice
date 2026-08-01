# Flashcards: thẻ học thuật ngữ AI (Plan B)

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Trạng thái:** Chờ user duyệt (2026-08-01)

---

## 1. Vấn đề

Người dùng ScholarVoice cần một cách học thuật ngữ/khái niệm chủ động từ nội dung trang — không chỉ nghe giảng thụ động hay làm quiz trắc nghiệm. Flashcards (thẻ học) là phương pháp ôn tập đã được kiểm chứng: mặt trước hiển thị thuật ngữ, người học tự nhớ định nghĩa, click lật để kiểm tra, rồi tự đánh giá "biết" hay "ôn lại".

---

## 2. Mục tiêu

1. Tab mới "🃏 Thẻ học" trong right panel, cạnh Chat và Quiz.
2. AI trích thuật ngữ → định nghĩa từ nội dung trang hiện tại.
3. Người dùng lật thẻ, nghe đọc thuật ngữ/định nghĩa bằng TTS, tự đánh giá ✅ Biết / 🔄 Ôn lại.
4. Ôn lại → thẻ quay lại xoay vòng đến khi hết; hết thẻ → màn hình hoàn thành.
5. Cache theo trang + provider + số thẻ; nút "Làm mới" xoá cache và sinh thẻ mới.
6. Không ảnh hưởng đến chat, quiz, giảng — module mới độc lập.

---

## 3. Yêu cầu (đã chốt với user)

| # | Yêu cầu | Chi tiết |
|---|---|---|
| 1 | Tab mới "🃏 Thẻ học" | Chèn vào `#right-tabs`, giữa `#tab-chat` (💬 Hỏi đáp) và `#tab-quiz` (📝 Quiz). Khi click, ẩn chat/quiz area, hiển thị flashcard area. |
| 2 | AI trích thuật ngữ → định nghĩa | Hàm mới `generateFlashcards(pageNum, pageText, imageBase64, count = 5)` trong `js/ai-engine.js` — system prompt yêu cầu AI trích chính xác `count` cặp thuật ngữ–định nghĩa từ nội dung trang. |
| 3 | Dropdown số thẻ 3/5/10 | Mặc định 5. Tái sử dụng pattern dropdown `#quiz-count` (label `.quiz-count-label` + `<select>`), đặt trong empty state của flashcard area. `id="flash-count"`, reuse CSS class hiện có. |
| 4 | Luồng học | Mặt trước = thuật ngữ; click lật → định nghĩa + nút 🔊 đọc (gọi TTS engine hiện có). Hai nút "✅ Biết" (thẻ qua, không quay lại) và "🔄 Ôn lại" (thẻ quay lại cuối hàng đợi). Hết thẻ ở hàng đợi chính → màn hình "Hoàn thành 🎉" + nút "Học lại". |
| 5 | Cache | Key `flash_<trang>_<provider>_<sốthẻ>`; đổi trang → cards giữ cache nếu có; nút "Làm mới" → xoá prefix flashcards của trang (tương tự `clearQuizForPage`) rồi sinh mới. |
| 6 | Class mới | `FlashcardsManager` trong `js/flashcards.js` (module ES mới), import vào `app.js`. Pattern theo `QuizManager`: constructor nhận `app`, wire DOM, race guard `_genSeq`/`genId`, `switchTab`, `onPageChanged`, `onPdfLoaded`. |
| 7 | Flashcard JSON shape | `[{term: string, definition: string}]` — validate: term non-empty, definition non-empty + max 200 ký tự, đúng count. |
| 8 | "Ôn trang yếu" | KHÔNG thuộc spec này (Plan A). |

---

## 4. Thiết kế chi tiết (spec từng file)

### A. `js/ai-engine.js` — `generateFlashcards(pageNum, pageText, imageBase64, count = 5)`

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Tham số | `generateFlashcards(pageNum, pageText, imageBase64, count = 5)` — signature bắt chước `generateQuiz(pageNum, pageText, imageBase64, count = 3)` (dòng 542). |
| 2 | Cache key | `flash_${pageNum}_${this.provider}_${n}` — bắt chước `quiz_${pageNum}_${this.provider}_${n}` (dòng 544). |
| 3 | Cache check | Kiểm tra `this.quizCache.get(cacheKey)` trước khi gọi API — pattern giống `generateQuiz` (dòng 545). |
| 4 | Empty page text | Nếu không có `pageText`, throw `'Trang này không có nội dung chữ để tạo thẻ học.'` — giống quiz (dòng 549). |
| 5 | System prompt | Yêu cầu AI: `"Trích CHÍNH XÁC {count} thuật ngữ hoặc khái niệm quan trọng từ nội dung trang. Với mỗi thuật ngữ, viết định nghĩa ngắn gọn 1-2 câu. TUYỆT ĐỐI CHỈ dùng kiến thức có trong nội dung trang, không bịa. Trả về JSON: { \"cards\": [{\"term\":\"...\", \"definition\":\"...\"}] }. NGÔN NGỮ: Luôn dùng TIẾNG VIỆT. definition phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown."` |
| 6 | Gọi API | Qua `this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText)` — jsonMode=true như generateQuiz (dòng 578). |
| 7 | Validate | Gọi `validateFlashcards(rawResponse)` (hàm export mới) để parse + validate JSON. Nếu `cards.length === 0`, throw `'AI không tạo được thẻ học hợp lệ. Bấm 🔄 để thử lại.'` — giống quiz (dòng 581-582). |
| 8 | Lưu cache | `this.quizCache.set(cacheKey, cards)` (dùng chung map `quizCache` hoặc map mới `flashcardCache` — khuyến nghị `flashcardCache` mới để tách biệt prefix, dễ clear riêng). |
| 9 | Return | `return cards` — mảng `[{term, definition}]`. |
| 10 | `clearFlashcardsForPage(pageNum)` | Xoá prefix `flash_${pageNum}_${this.provider}_` — pattern giống `clearQuizForPage` (dòng 590-594). |
| 11 | `clearCache()` | Gọi `this.flashcardCache.clear()` trong `clearCache()` (dòng 597), và trong `saveSettings()` khi đổi provider (dòng 79). |

**System prompt đề xuất (tiếng Việt):**
```
Bạn là giảng viên tạo thẻ học (flashcards) để giúp sinh viên ôn tập.
Trích CHÍNH XÁC {count} thuật ngữ hoặc khái niệm quan trọng từ nội dung trang tài liệu.
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
definition phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.
```

**`validateFlashcards(raw)` — hàm export mới (pattern theo `validateQuizQuestions`, dòng 934):**
- Parse JSON (thử `JSON.parse`, fallback regex block JSON).
- Lấy `parsed.cards` (phải là mảng).
- Với mỗi card: `term` non-empty string, `definition` non-empty string + `definition.length <= 200`.
- Trả về mảng `[{term, definition}]` đã trim.

---

### B. `index.html` — Tab thứ 3 + area mới

#### B.1. Tab (trong `#right-tabs`, dòng 264)

Chèn tab mới **giữa** `#tab-chat` và `#tab-quiz`:

```html
<button id="tab-flash" class="right-tab" data-tab="flash">🃏 Thẻ học</button>
```

Vị trí cụ thể: sau dòng 265 (`<button id="tab-chat" ...>`) và trước dòng 266 (`<button id="tab-quiz" ...>`).

#### B.2. Flashcard area (trong `#right-panel`, sau `#quiz-area`, dòng 325)

Thêm block mới ngay sau `</div>` đóng của `#quiz-area` (dòng 325):

| # | Mục | HTML |
|---|---|---|
| 1 | Container | `<div id="flash-area" class="hidden">` — ẩn mặc định. |
| 2 | Header | `<div id="flash-header"><span id="flash-title">🃏 Thẻ học</span></div>` — pattern giống `#quiz-header` (dòng 287-289). |
| 3 | Body | `<div id="flash-body">...</div>` — chứa các state con. |
| 4 | Empty state | `<div id="flash-empty" class="welcome-message">` — icon 🃏, text, dropdown `#flash-count` (3/5/10, selected 5), nút `#flash-start-btn` (disabled ban đầu). Pattern theo `#quiz-empty` (dòng 292-303). |
| 5 | Loading | `<div id="flash-loading" class="hidden">` — spinner + text "Đang tạo thẻ học..." (pattern `#quiz-loading`, dòng 305-308). |
| 6 | Card view | `<div id="flash-card-view" class="hidden">` — chứa card (`#flash-card`), nút 🔊, counter `#flash-progress`, nút ✅ Biết / 🔄 Ôn lại. |
| 7 | Card | `<div id="flash-card">` — mặt trước (`#flash-card-front` hiển thị term), mặt sau (`#flash-card-back` hiển thị definition, ẩn ban đầu). |
| 8 | Nút đọc | `<button id="flash-speak-btn">🔊</button>` trong card view. |
| 9 | Result | `<div id="flash-result" class="hidden">` — "Hoàn thành 🎉", nút "Học lại" `#flash-retry-btn`, nút "Làm mới" `#flash-refresh-btn`. Pattern theo `#quiz-result` (dòng 317-323). |

**Chi tiết HTML đề xuất (đặt ngay sau `</div>` của `#quiz-area`, tức sau dòng 325):**
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

---

### C. `css/style.css` — Style flashcards

| # | Mục | Thay đổi |
|---|---|---|
| 1 | `#flash-area` | Tái sử dụng style của `#quiz-area` (dòng 576): `flex:1; display:flex; flex-direction:column; overflow:hidden; position:relative;` |
| 2 | `#flash-header` | Tái sử dụng `#quiz-header` (dòng 577-579): flex, padding, border-bottom. |
| 3 | `#flash-body` | Tái sử dụng `#quiz-body` (dòng 583): flex:1, overflow-y:auto, padding, flex-direction column. |
| 4 | `#flash-card` | Card lớn, style như `.quiz-option` (dòng 588-593): nền glass, border, radius, padding lớn, min-height ~200px, cursor pointer. Thêm transition cho flip effect (CSS `transform: rotateY(180deg)` + `backface-visibility: hidden` với perspective). |
| 5 | `#flash-card.flipped #flash-card-front` | `display:none` |
| 6 | `#flash-card.flipped #flash-card-back` | `display:block` |
| 7 | `#flash-card-front` | Font-size lớn (~1.3rem), font-weight 600, căn giữa, hiển thị term. |
| 8 | `#flash-card-back` | Font-size 0.95rem, hiển thị definition, line-height 1.6. |
| 9 | `#flash-speak-btn` | Tái sử dụng `.voice-btn` (dòng 368-376) — nút tròn 36px. |
| 10 | `#flash-card-actions` | Display flex, gap 10px, justify-content center, margin-top 16px — pattern `#quiz-result` actions (dòng 319). |
| 11 | `#flash-count` | Tái sử dụng style `#quiz-count` (dòng 618-621) — không cần CSS mới. |
| 12 | `.quiz-count-label` | Đã có ở dòng 617, tái sử dụng cho `#flash-count`. |
| 13 | `#flash-progress` | Font-size 0.8rem, color var(--text-secondary), text-align center, margin-bottom 12px — pattern như `#quiz-question-text` counter. |

---

### D. `js/flashcards.js` — FlashcardManager (module mới)

| # | Mục | Chi tiết |
|---|---|---|
| 1 | Constructor | `constructor(app)` — lưu `this.app = app`, query tất cả DOM elements (pattern `QuizManager` dòng 6-38), gọi `this._setupEvents()`. |
| 2 | State | `this.cards = []`, `this.mainQueue = []` (hàng đợi chính), `this.reviewQueue = []` (hàng đợi ôn lại), `this.currentCard = null`, `this.flipped = false`, `this._genSeq = 0`, `this._generating = false`. |
| 3 | `switchTab(name)` | Pattern `QuizManager.switchTab` (dòng 55-62): ẩn/hiện chat/quiz/flash, toggle active class trên tabs. Gọi `this._onTabOpened()` nếu chuyển sang flash. |
| 4 | `_onTabOpened()` | Pattern `QuizManager._onTabOpened` (dòng 65-72): reset state, gọi `_generateForCurrentPage()`. |
| 5 | `onPageChanged(pageNum)` | Pattern `QuizManager.onPageChanged` (dòng 75-86): reset, `_genSeq++`, `_generating = false`, gọi `_generateForCurrentPage()` nếu tab flash đang mở. |
| 6 | `onPdfLoaded()` | Pattern `QuizManager.onPdfLoaded` (dòng 89-93): enable `#flash-start-btn`, set text. |
| 7 | `_getFlashCount()` | `return parseInt(this.flashCountSelect?.value, 10) \|\| 5` — pattern `_getQuizCount` (dòng 122-124). |
| 8 | `_generateForCurrentPage()` | Pattern `QuizManager._generateForCurrentPage` (dòng 128-187): kiểm tra pdf loaded, api configured, race guard `genId`, gọi `this.app.aiEngine.generateFlashcards(pageNum, pageText, imageBase64, this._getFlashCount())`, xử lý stale/abort/catch, render card đầu tiên. |
| 9 | `_renderCard()` | Hiển thị term trên `#flash-card-front`, reset flipped state, cập nhật progress `"Thẻ X/Y"`, ẩn definition. |
| 10 | `_flipCard()` | (click vào card) Hiển thị definition trên `#flash-card-back`, thêm class `.flipped` vào `#flash-card`, set `this.flipped = true`. |
| 11 | `_speak(text)` | `this.app.ttsEngine.speak(this.app._cleanVoiceText(text))` — pattern `QuizManager._speak` (dòng 271-273). |
| 12 | `_speakCurrent()` | Nếu chưa flip → đọc term; nếu đã flip → đọc definition. |
| 13 | `_markKnow()` | Thẻ hiện tại chuyển khỏi queue (không quay lại). Gọi `_nextCard()`. |
| 14 | `_markReview()` | Thẻ hiện tại → push vào `this.reviewQueue`. Gọi `_nextCard()`. |
| 15 | `_nextCard()` | Nếu `mainQueue` còn → lấy thẻ tiếp, render. Nếu `mainQueue` hết và `reviewQueue` còn → `mainQueue = [...reviewQueue]`, `reviewQueue = []`, thông báo "Ôn lại X thẻ", render. Nếu cả hai hết → `_showResult()`. |
| 16 | `_showResult()` | Ẩn card view, hiển thị `#flash-result` với text "🎉 Hoàn thành! Bạn đã học xong tất cả thẻ." |
| 17 | `_retry()` | Dùng lại cards hiện có (không gọi AI): `mainQueue = [...cards]`, `reviewQueue = []`, render card đầu tiên. Pattern: `QuizManager._retry` nhưng không clear cache. |
| 18 | `_refresh()` | Xoá cache + sinh mới: `this.app.aiEngine.clearFlashcardsForPage(pageNum)`, `this.cards = []`, `this._generateForCurrentPage()`. Pattern: `QuizManager._retry` (dòng 263-267). |
| 19 | `_resetToEmpty()` | Ẩn card view/result/loading, hiển thị empty state. Pattern: `QuizManager._resetToEmpty` (dòng 108-119). |
| 20 | Race guard | `_genSeq` + `genId` — pattern `QuizManager` (dòng 35, 139, 159-164, 177, 185). |

---

### E. `js/app.js` — Tích hợp module

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Import | Thêm `import { FlashcardsManager } from './flashcards.js';` sau dòng 9 (`import { QuizManager }`). |
| 2 | Constructor | Thêm `this.flashcardsManager = new FlashcardsManager(this);` sau dòng 18 (`this.quizManager = new QuizManager(this);`). |

---

## 5. Không làm (YAGNI)

| # | Mục | Lý do |
|---|---|---|
| 1 | "Ôn trang yếu" (tổng hợp các trang điểm thấp) | Plan A, không thuộc spec này. |
| 2 | Spaced repetition (lặp cách quãng) | Vượt scope v1; giữ đơn giản: biết → qua, ôn → xoay vòng. |
| 3 | Lưu tiến độ flashcards vào localStorage | Quiz có lưu điểm vì có chấm đúng/sai khách quan; flashcards tự đánh giá chủ quan → chưa cần lưu. |
| 4 | Option số thẻ khác 3/5/10 | Đủ dùng cho v1. |
| 5 | Đổi `server.py` | Không liên quan. |
| 6 | Thêm dependency mới | Không cần. |
| 7 | Animation flip 3D phức tạp | CSS `display:none`/`display:block` toggle đơn giản đủ dùng. Flip 3D là nice-to-have. |

---

## 6. Tác động file

| File | Thay đổi |
|---|---|
| `js/ai-engine.js` | Thêm `flashcardCache` (Map mới), `generateFlashcards()`, `validateFlashcards()` (export), `clearFlashcardsForPage()`. Sửa `clearCache()` + `saveSettings()` để clear `flashcardCache`. |
| `js/flashcards.js` | **File mới** — class `FlashcardsManager` (~250-300 dòng, pattern theo QuizManager). |
| `js/app.js` | Import `FlashcardsManager`, khởi tạo trong constructor. |
| `index.html` | Thêm `#tab-flash` trong `#right-tabs` (giữa tab-chat và tab-quiz). Thêm `#flash-area` block sau `#quiz-area`. |
| `css/style.css` | Thêm style cho `#flash-area`, `#flash-header`, `#flash-body`, `#flash-card`, `#flash-card-front`, `#flash-card-back`, `#flash-speak-btn`, `#flash-card-actions`, `#flash-progress`. Tái sử dụng `.quiz-count-label`, `#flash-count` (dùng chung style với `#quiz-count`). |
| `docs/…` | Design doc này. |

---

## 7. Rủi ro & lưu ý

- **AI không trả đúng count**: `validateFlashcards` có thể trả về ít thẻ hơn yêu cầu (vd AI chỉ tìm được 2 thuật ngữ). Chấp nhận — hiển thị số thẻ thực tế, không ép buộc. Chỉ throw nếu 0 thẻ hợp lệ.
- **Definition quá dài**: Cắt ở 200 ký tự trong validation. Prompt yêu cầu "1-2 câu ngắn gọn" để giảm thiểu.
- **Cache map riêng**: Dùng `flashcardCache` (Map mới) thay vì dùng chung `quizCache` để prefix không xung đột và dễ clear riêng. Phải clear trong `clearCache()` và `saveSettings()` khi đổi provider.
- **Tab thứ 3 — switchTab phức tạp hơn**: Hiện tại `QuizManager.switchTab` chỉ toggle chat/quiz (binary). Cần sửa thành 3-way toggle (chat / flash / quiz) — chỉ một tab active tại một thời điểm. `FlashcardsManager.switchTab` và `QuizManager.switchTab` đều cần biết về nhau, hoặc logic switch được nâng lên `App`.
- **Race condition**: Dùng pattern `_genSeq`/`genId` đã chứng minh trong QuizManager (commit `06bfbd2`, `f49fb16`) — không được dùng naive `_generating = false` trong `onPageChanged`.
- **TTS engine**: Gọi `this.app.ttsEngine.speak(this.app._cleanVoiceText(text))` — pattern giống quiz (dòng 273). Không cần thay đổi TTS engine.
- **ESM scoping**: `js/flashcards.js` là ES module; `js/package.json` đã có `{"type":"module"}`.
