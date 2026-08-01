# Đề ôn tổng hợp — gom câu hỏi từ các trang yếu thành một bài kiểm tra

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Kế hoạch:** Plan C — feature "#3 Đề ôn tổng hợp"
**Trạng thái:** Đã chốt với user (2026-08-01)

Phụ thuộc: **Plan A** (`docs/superpowers/specs/2026-08-01-learning-loop-review-design.md`) — Plan A định nghĩa "trang yếu" và cách xác định. Plan C dùng chung định nghĩa đó (chỉ tham chiếu, không định nghĩa lại).

---

## 1. Vấn đề

1. Sau khi làm quiz từng trang, người dùng có một số trang điểm thấp (< 60%) nhưng không có cách ôn tập trung các trang yếu đó trong một lần.
2. Quiz hiện tại chỉ hỗ trợ từng trang đơn lẻ — muốn ôn nhiều trang yếu phải chuyển trang thủ công, làm từng quiz riêng.
3. Cache quiz cũ (`quiz_<trang>_<provider>_<sốcâu>`) khiến việc "sinh lại quiz cho trang yếu" trả về câu cũ nếu không chủ động xoá cache.

---

## 2. Mục tiêu

Tạo chế độ "Đề ôn tổng hợp" — tự động gom các trang có điểm quiz < 60%, sinh câu hỏi MỚI cho từng trang, gộp thành một bài kiểm tra duy nhất. Người dùng làm một mạch, xem kết quả tổng + báo cáo theo từng trang.

---

## 3. Yêu cầu (đã chốt với user)

| # | Yêu cầu | Chi tiết |
|---|---|---|
| 1 | Mục "Đề ôn" trong tab Quiz | Thêm khu vực riêng trong `#quiz-body`: tiêu đề "📝 Đề ôn tổng hợp", nút "Tạo đề ôn", dropdown số câu/trang. |
| 2 | Dropdown số câu/trang | Dropdown riêng `#exam-count` (giá trị 3/5/10, mặc định 3). **Không** dùng chung `#quiz-count` — lý do: `#quiz-count` thuộc về empty state quiz đơn trang, dùng chung gây nhập nhằng UX và phụ thuộc DOM không cần thiết. |
| 3 | Trang yếu = quiz score < 60% | Dùng chung định nghĩa từ Plan A: trang có `quiz_scores` mà `best/total < 0.6`. Nếu Plan A chưa implement, định nghĩa tạm: `score = _getScore(pageNum)`, yếu nếu `score && score.total > 0 && score.best / score.total < 0.6`. |
| 4 | Tự động gom trang yếu | Quét toàn bộ `quiz_scores_<filename>` trong localStorage, lấy danh sách trang có điểm < 60%, KHÔNG cho user chọn thủ công từ-trang/đến-trang. |
| 5 | Sinh câu MỚI cho từng trang yếu | **Trước khi gọi `generateQuiz`**, gọi `clearQuizForPage(pageNum)` để xoá cache prefix `quiz_<pageNum>_<provider>_` → đảm bảo câu hỏi luôn MỚI, không trả về cache cũ user đã làm. |
| 6 | Gộp thành 1 đề | Mỗi trang yếu sinh `count` câu, gộp theo thứ tự số trang tăng dần. Câu hỏi KHÔNG trộn (theo trang → dễ báo cáo, dễ trace). |
| 7 | Chấm tổng | Hiển thị "🎯 Bạn trả lời đúng **X/N** câu." + báo cáo theo trang: "Trang 3: 2/3, Trang 7: 1/3". |
| 8 | KHÔNG lưu vào quiz_scores | Điểm đề ôn chỉ hiển thị trong phiên, không ghi đè `quiz_scores` (không phá điểm ôn tập từng trang của Plan A). |
| 9 | Không có trang yếu | Nếu không có trang nào yếu: nút "Tạo đề ôn" bị **disabled**, hiển thị thông báo "Không có trang yếu — làm quiz các trang để tạo đề ôn". |
| 10 | Render tái sử dụng UI quiz | Dùng chung `#quiz-question`, `#quiz-options`, `#quiz-feedback` — chỉ đổi header thành "Đề ôn (N câu)" và mỗi câu kèm nhãn trang nguồn nhỏ. |
| 11 | Mở rộng QuizManager | Thêm exam mode (`_examMode`, `_examPages`): `startExam()`, `_showExamResult()`. **Không** tạo ExamManager riêng — để tái dùng toàn bộ render + answer + next + race guard + TTS đã có. Exam mode chỉ khác ở: nguồn câu (nhiều trang), cách hiển thị kết quả (không lưu score), header. |

---

## 4. Thiết kế chi tiết

### Phân tích: mở rộng QuizManager hay ExamManager riêng?

| Tiêu chí | Mở rộng QuizManager (chọn) | ExamManager riêng |
|---|---|---|
| Render câu hỏi | Tái dùng `_renderQuestion`, `_answer`, `_onNext` — không trùng lặp code. | Phải copy ~120 dòng render logic. |
| Race guard | Tái dùng `_genSeq`/`genId` — đã battle-tested. | Phải viết lại toàn bộ cơ chế abort + guard. |
| TTS | Tái dùng `_speak()`. | Phải copy. |
| Score display | Gate bằng `_examMode` trong `_showResult()` → không lưu score. | Không cần gate nhưng phải viết lại score display riêng. |
| Risk | Exam state leak sang quiz thường nếu không reset đúng. | Không leak, nhưng trùng lặp code. |
| **Kết luận** | **Chọn mở rộng** — risk thấp, chỉ cần reset `_examMode = false` trong `_resetToEmpty()` và `onPageChanged()`. | Không chọn — DRY vi phạm. |

### Phân tích: dropdown dùng chung hay riêng?

| Tiêu chí | Dùng chung `#quiz-count` | Dropdown riêng `#exam-count` (chọn) |
|---|---|---|
| UX | Dropdown thay đổi ý nghĩa tuỳ context (quiz đơn / đề ôn) — dễ gây nhầm. | Rõ ràng: dropdown trong exam section chỉ ảnh hưởng exam. |
| DOM coupling | `#quiz-count` nằm trong `#quiz-empty` — bị ẩn khi đang làm quiz/exam → không truy cập được lúc cần đọc giá trị cho exam. | Exam section độc lập, luôn visible khi tab Quiz mở (trừ lúc đang làm exam). |
| Code coupling | `_getQuizCount()` bị overload semantics, phải check context. | `_getExamCount()` riêng, không ảnh hưởng code quiz đơn. |
| **Kết luận** | Không chọn. | **Chọn dropdown riêng** trong exam section. |

### A. `js/quiz.js` — QuizManager mở rộng

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Constructor | Thêm: `this._examMode = false`, `this._examPages = []`, `this.examSection = document.getElementById('exam-section')`, `this.examStartBtn = document.getElementById('exam-start-btn')`, `this.examCountSelect = document.getElementById('exam-count')`, `this.examStatus = document.getElementById('exam-status')`. |
| 2 | `startExam()` | Phương thức mới — entry point cho đề ôn: (a) Quét `quiz_scores`, lọc trang yếu; (b) Nếu rỗng → disable nút + hiện thông báo; (c) Nếu có → set `_examMode = true`, `_examPages = [...]`, hiển thị loading, gọi `_generateExam()`. |
| 3 | `_generateExam()` | Phương thức mới — async, dùng `genSeq` guard giống `_generateForCurrentPage()`: (a) Với mỗi trang trong `_examPages`, gọi `this.app.aiEngine.clearQuizForPage(p)` → sau đó `this.app.aiEngine.generateQuiz(p, pageText, imageBase64, count)`; (b) Gắn `pageNum` vào mỗi câu (`q._page = pageNum`); (c) Gộp toàn bộ câu vào `this.questions`, sắp xếp theo `_page` tăng dần; (d) Render câu đầu tiên. |
| 4 | `_getExamCount()` | Phương thức mới: `return parseInt(this.examCountSelect?.value, 10) \|\| 3` (validate [3,5,10]). |
| 5 | `_getWeakPages()` | Phương thức mới — đọc `quiz_scores_<filename>` từ localStorage, lọc các trang có `score.total > 0 && (score.best / score.total) < 0.6`, trả về mảng pageNum tăng dần. Dùng chung định nghĩa Plan A. |
| 6 | `_showExamResult()` | Phương thức mới — giống `_showResult()` nhưng: (a) **Không** gọi `_saveScore()`; (b) Hiển thị tổng: `🎯 Bạn trả lời đúng <strong>X/N</strong> câu.`; (c) Hiển thị báo cáo theo trang: `Trang 3: 2/3, Trang 7: 1/3` (dùng `_examPages` + đếm correctCount theo `q._page`). |
| 7 | `_renderQuestion()` | Sửa: nếu `_examMode`, header hiển thị `📝 Đề ôn (${this.questions.length} câu) — Câu ${idx+1}/${total}` + nhãn trang nguồn nhỏ: `(Trang ${q._page})` ở cuối câu hỏi. |
| 8 | `_syncForPage()` | Sửa: nếu `_examMode` → hiển thị header exam (không ghi đè `#quiz-title` bằng "Quiz trang X"). |
| 9 | `_showResult()` | Sửa: nếu `_examMode` → gọi `_showExamResult()` thay vì logic thường. |
| 10 | `onPageChanged()` | Sửa: nếu `_examMode` → không reset (exam cố định, không phụ thuộc trang hiện tại). Nếu không → reset `_examMode = false`. |
| 11 | `_resetToEmpty()` | Sửa: reset `_examMode = false`, `_examPages = []`, hiển thị lại exam section (nếu có). |
| 12 | `_onTabOpened()` | Sửa: nếu `_examMode` → không tự sinh quiz (giữ nguyên exam đang làm). Nếu không → hành vi cũ. |
| 13 | `onPdfLoaded()` | Sửa: cập nhật trạng thái exam section (enable/disable nút "Tạo đề ôn" dựa trên có trang yếu không). |
| 14 | `_setupEvents()` | Thêm listener: `this.examStartBtn.addEventListener('click', () => this.startExam())`. |
| 15 | Giữ nguyên | `_genSeq`/`genId` race guard, `_answer`, `_onNext`, `_speak`, `_escapeHtml`, `_getScore`, `_saveScore`, `_getQuizCount`, `_generateForCurrentPage`, `_retry`, `switchTab`. |

**Luồng `startExam()` chi tiết:**

```
startExam()
  ├─ Kiểm tra PDF loaded + AI configured (giống _generateForCurrentPage)
  ├─ Gọi _getWeakPages() → mảng pageNum[]
  ├─ Nếu rỗng → examStartBtn.disabled = true, examStatus.textContent = "Không có trang yếu..."
  ├─ Nếu có:
  │   ├─ _examMode = true, _examPages = weakPages
  │   ├─ Ẩn exam section, hiện loading
  │   ├─ _genSeq++ (race guard)
  │   ├─ Với mỗi pageNum trong _examPages:
  │   │   ├─ clearQuizForPage(pageNum)            ← ĐẢM BẢO CÂU MỚI
  │   │   ├─ getPageText() + getPageImageBase64()
  │   │   ├─ generateQuiz(pageNum, text, img, count)
  │   │   ├─ Gắn q._page = pageNum cho từng câu
  │   │   └─ Push vào this.questions
  │   ├─ Sort this.questions theo q._page (tăng dần)
  │   ├─ Ẩn loading, hiện quiz-question
  │   └─ _renderQuestion()
```

**Lý do clearQuizForPage trước generateQuiz:**
- `generateQuiz` cache theo key `quiz_<pageNum>_<provider>_<count>` (ai-engine.js:544).
- Nếu user đã làm quiz trang 3 với count=3, cache đã có key `quiz_3_gemini_3`.
- Gọi `generateQuiz(3, text, img, 3)` sẽ trả về cache cũ → user làm lại câu đã biết.
- `clearQuizForPage(3)` xoá prefix `quiz_3_gemini_` (ai-engine.js:590-595) → `generateQuiz` gọi API mới.
- Đây là yêu cầu then chốt để "đề ôn" thực sự là câu MỚI.

### B. `js/ai-engine.js`

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Không thay đổi | `generateQuiz(pageNum, pageText, imageBase64, count)` đã hỗ trợ đầy đủ tham số `count` + cache key `quiz_<pageNum>_<provider>_<count>`. |
| 2 | `clearQuizForPage(pageNum)` | Đã xoá prefix `quiz_<pageNum>_<provider>_` — dùng trực tiếp, không cần sửa. |
| 3 | Không thêm method mới | `_getWeakPages()` logic nằm trong QuizManager (đọc localStorage), không liên quan AIEngine. |

### C. `index.html` — exam section

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Vị trí | Trong `#quiz-body`, **trước** `#quiz-empty` (để exam section luôn visible khi tab Quiz mở, trừ lúc đang làm exam thì ẩn). |
| 2 | HTML thêm vào | Block mới `#exam-section`: |
| 3 | Cấu trúc exam-section | `<div id="exam-section">` chứa: tiêu đề `<h3>📝 Đề ôn tổng hợp</h3>`, mô tả `<p>`, controls `<div>` gồm dropdown `#exam-count` + nút `#exam-start-btn`, status `<p id="exam-status">`. |
| 4 | Dropdown `#exam-count` | `<select id="exam-count"><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select>` — style dùng chung class với `#quiz-count`. |
| 5 | Nút `#exam-start-btn` | `<button id="exam-start-btn" class="btn-primary" disabled>🎯 Tạo đề ôn tổng hợp</button>` — disabled mặc định (chưa có PDF), enable khi PDF loaded + có trang yếu. |
| 6 | Status `#exam-status` | `<p id="exam-status" class="exam-status-text"></p>` — hiển thị thông báo "Không có trang yếu..." hoặc số trang yếu tìm thấy. |
| 7 | Hành vi ẩn/hiện | `#exam-section` ẩn khi exam đang chạy (`#quiz-loading` hoặc `#quiz-question` hiển thị), hiện lại khi `_resetToEmpty()`. KHÔNG ẩn khi quiz đơn trang đang chạy (exam section và quiz đơn là hai UI path riêng). |
| 8 | Không đụng | `#quiz-empty`, `#quiz-count`, `#quiz-start-btn`, `#quiz-question`, `#quiz-result` — giữ nguyên cho quiz đơn trang. |

**HTML dự kiến (pseudocode, vị trí trong `#quiz-body`):**
```html
<div id="quiz-body">
  <!-- Exam section — luôn hiển thị trừ khi đang làm exam -->
  <div id="exam-section">
    <h3 class="exam-title">📝 Đề ôn tổng hợp</h3>
    <p class="exam-desc">Ôn tập trung các trang có điểm thấp trong một lần.</p>
    <div class="exam-controls">
      <label class="quiz-count-label" for="exam-count">Số câu/trang</label>
      <select id="exam-count">
        <option value="3" selected>3</option>
        <option value="5">5</option>
        <option value="10">10</option>
      </select>
      <button id="exam-start-btn" class="btn-primary" disabled>🎯 Tạo đề ôn</button>
    </div>
    <p id="exam-status" class="exam-status-text"></p>
  </div>

  <!-- Giữ nguyên -->
  <div id="quiz-empty" class="welcome-message">...</div>
  <div id="quiz-loading" class="hidden">...</div>
  <div id="quiz-question" class="hidden">...</div>
  <div id="quiz-result" class="hidden">...</div>
</div>
```

### D. `css/style.css`

| # | Mục | Thay đổi |
|---|---|---|
| 1 | `#exam-section` | Style: `padding: 0 0 16px 0; border-bottom: 1px solid rgba(255,255,255,0.04); margin-bottom: 12px;` — phân tách visual với `#quiz-empty`. |
| 2 | `.exam-title` | `font-size:0.95rem; font-weight:600; color:var(--text-primary); margin-bottom:4px;` |
| 3 | `.exam-desc` | `font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;` |
| 4 | `.exam-controls` | Dùng chung style `.quiz-start-controls` (flex, gap 10px). |
| 5 | `#exam-count` | Dùng chung style `#quiz-count` (cùng kiểu dropdown). |
| 6 | `.exam-status-text` | `font-size:0.78rem; color:var(--text-muted); margin-top:8px;` |
| 7 | `.exam-question-source` | Nhãn trang nguồn nhỏ trong câu hỏi exam: `font-size:0.7rem; color:var(--text-muted); margin-top:4px; font-style:italic;` |
| 8 | `.exam-report-table` | Style bảng báo cáo theo trang (trong result): `width:100%; border-collapse:collapse; font-size:0.85rem; margin-top:12px;`. Mỗi dòng: `border-bottom: 1px solid rgba(255,255,255,0.04); padding:6px 0;`. |
| 9 | Không đụng | Style quiz đơn trang hiện tại. |

---

## 5. Không làm (YAGNI)

| # | Mục | Lý do |
|---|---|---|
| 1 | User chọn thủ công từ-trang/đến-trang | Đã chốt Q5 = B: tự gom trang yếu, không cho chọn. |
| 2 | Trộn câu hỏi ngẫu nhiên | Theo trang dễ báo cáo + trace hơn. Có thể thêm option shuffle sau này. |
| 3 | Lưu điểm đề ôn vào quiz_scores | Sẽ phá điểm ôn tập từng trang (Plan A). Điểm đề ôn chỉ hiển thị. |
| 4 | ExamManager class riêng | DRY — tái dùng QuizManager render + guard. |
| 5 | Exam offline (không cần API) | Câu hỏi luôn cần AI sinh — không có ngân hàng câu hỏi cục bộ. |
| 6 | Sinh câu song song (Promise.all) | Gọi tuần tự để tránh rate-limit API + giữ tiến trình ổn định. Có thể thêm sau. |
| 7 | Đổi `server.py` | Không liên quan. |
| 8 | Thêm dependency mới | Không cần. |

---

## 6. Tác động file

| File | Thay đổi |
|---|---|
| `js/quiz.js` | Mở rộng QuizManager: thêm `_examMode`, `_examPages`, `startExam()`, `_generateExam()`, `_getExamCount()`, `_getWeakPages()`, `_showExamResult()`, sửa `_renderQuestion()`, `_syncForPage()`, `_showResult()`, `onPageChanged()`, `_resetToEmpty()`, `_onTabOpened()`, `onPdfLoaded()`, `_setupEvents()`. |
| `js/ai-engine.js` | **Không thay đổi** — `generateQuiz` và `clearQuizForPage` đã đáp ứng đủ. |
| `index.html` | Thêm `#exam-section` block trong `#quiz-body` (trước `#quiz-empty`). |
| `css/style.css` | Thêm style cho `#exam-section`, `.exam-title`, `.exam-desc`, `.exam-controls`, `.exam-status-text`, `.exam-question-source`, `.exam-report-table`. `#exam-count` dùng chung style `#quiz-count`. |
| `docs/…` | Design doc này. |

---

## 7. Rủi ro & lưu ý

- **Cache cũ trả về câu cũ**: Đây là rủi ro chính. `clearQuizForPage` phải được gọi CHO TỪNG TRANG YẾU trước `generateQuiz`. Nếu quên bước này, exam toàn câu cũ → mất giá trị ôn tập. Đã nêu rõ trong thiết kế (mục 4.A, bước `_generateExam`).
- **Exam state leak sang quiz thường**: Nếu `_examMode` không được reset về `false` trong `_resetToEmpty()` và `onPageChanged()`, quiz đơn trang sau exam sẽ hiển thị nhầm header exam hoặc bỏ qua lưu điểm. Phải reset ở mọi đường thoát exam.
- **Sinh tuần tự nhiều trang → thời gian chờ dài**: Với 5 trang yếu × 10 câu = 50 câu, có thể mất 30-60s tuỳ API. Cân nhắc hiển thị tiến trình ("Đang tạo câu hỏi cho trang 3/5...") thay vì spinner đơn thuần. Để dành cho cải tiến sau (không chặn v1).
- **User chuyển tab/trang khi đang sinh exam**: Race guard `_genSeq`/`genId` đã có — nếu user chuyển trang giữa lúc sinh, `genId` cũ không khớp → huỷ. Nhưng `_examMode` vẫn cần reset. Thêm reset trong `onPageChanged()` khi `_examMode && genId !== _genSeq`.
- **Không có trang nào có điểm (quiz_scores trống)**: `_getWeakPages()` trả về mảng rỗng → hiển thị thông báo, disable nút. Trường hợp tất cả trang đều ≥ 60% cũng trả về rỗng → có thể thêm thông báo khác ("Tất cả trang đều đạt — không cần ôn thêm!").
- **Phụ thuộc Plan A**: Nếu định nghĩa "trang yếu" của Plan A thay đổi (vd: < 50% thay vì < 60%), Plan C phải cập nhật theo. Đã ghi chú phụ thuộc ở đầu doc.
- **PDF page text không có sẵn cho trang chưa xem**: `getPageText()` có thể cần render trang trước. Nếu user chưa từng xem trang yếu, việc lấy text + image có thể chậm. Giải pháp: hiển thị progress bar thay vì spinner.

---

## 8. Tiêu chí hoàn thành (Definition of Done)

- [ ] Tab Quiz hiển thị exam section với dropdown `#exam-count` (3/5/10, default 3) + nút "Tạo đề ôn".
- [ ] Nút disabled khi chưa có PDF hoặc không có trang yếu.
- [ ] Bấm "Tạo đề ôn" → gọi `clearQuizForPage` cho từng trang yếu → sinh `count` câu mới/trang → gộp → render.
- [ ] Làm bài: chọn đáp án, xem giải thích, next question — hoạt động giống quiz đơn trang.
- [ ] Kết quả: "Bạn trả lời đúng X/N câu" + báo cáo từng trang.
- [ ] Điểm đề ôn KHÔNG xuất hiện trong `quiz_scores` localStorage.
- [ ] Sau khi đóng/kết thúc exam, quiz đơn trang vẫn hoạt động bình thường (không leak `_examMode`).
- [ ] Race guard: chuyển trang khi đang sinh exam → huỷ đúng, không corrupt UI.
- [ ] Syntax check `node --check js/quiz.js` → exit 0.
- [ ] Smoke test cơ bản (stub generateQuiz): tạo exam với 2 trang yếu × 3 câu → render 6 câu → làm hết → hiển thị kết quả.
