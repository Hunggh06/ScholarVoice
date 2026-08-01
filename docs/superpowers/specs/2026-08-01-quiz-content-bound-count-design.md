# Cải tiến quiz: câu hỏi bám sát nội dung môn học + số lượng câu tuỳ chọn (dropdown 3/5/10)

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Trạng thái:** Đã được user duyệt (2026-08-01)

---

## 1. Vấn đề

1. AI hiện tạo câu hỏi "meta"/ngoài lề (ví dụ: "trang này là trang số mấy") thay vì câu hỏi về kiến thức môn học trong nội dung trang.
2. Số câu hỏi cố định 3/trang; người dùng muốn chọn số lượng.

---

## 2. Yêu cầu (đã chốt với user)

| # | Yêu cầu | Chi tiết |
|---|---|---|
| 1 | Câu hỏi bám sát nội dung môn học | Câu hỏi phải về kiến thức môn học của trang: công thức, định nghĩa, khái niệm, số liệu, ví dụ có trong text trang đó. |
| 2 | Cấm tuyệt đối | Câu hỏi về số trang, layout, định dạng, tiêu đề, meta, kiến thức ngoài lề. |
| 3 | UI dropdown chọn số câu | Dropdown 3 / 5 / 10 (mặc định 3), đặt cạnh nút "Tạo câu hỏi" trong quiz area. |
| 4 | Hành vi đổi số (phương án B) | Đổi dropdown KHÔNG tự sinh lại quiz trang hiện tại; chỉ áp dụng cho lần tạo sau (bấm "Tạo câu hỏi" / "Làm lại" / đổi trang / mở tab khi chưa có quiz). |
| 5 | Cache key mới | `quiz_<trang>_<provider>_<sốcâu>`; quay lại trang đã cache cùng số câu → trả cache (không gọi API); khác số câu → sinh mới. |
| 6 | "Làm lại" | Xoá cache prefix của trang đó (mọi số câu) rồi sinh câu mới với số câu hiện tại. |
| 7 | Điểm số hiển thị động | Lưu thêm `total` câu; hiển thị động "Điểm cao nhất: X/N" và "Bạn trả lời đúng X/N câu" (thay /3 cố định hiện tại). |

---

## 3. Thiết kế chi tiết (spec từng file)

### A. `js/ai-engine.js` — `generateQuiz(pageNum, pageText, imageBase64, count = 3)`

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Tham số mới | Thêm tham số `count` (mặc định 3). |
| 2 | System prompt | Sửa `"Tạo CHÍNH XÁC 3 câu hỏi"` → `"Tạo CHÍNH XÁC {count} câu hỏi"`. |
| 3 | Chỉ thị nội dung | Thêm: `"Câu hỏi PHẢI về kiến thức môn học có trong nội dung trang (khái niệm, công thức, định nghĩa, số liệu, ví dụ). TUYỆT ĐỐI KHÔNG hỏi về số trang, layout, định dạng, tiêu đề, hoặc kiến thức không có trong nội dung trang."` |
| 4 | Ví dụ phản hồi | Thêm vào prompt: `❌ Sai: "Trang này là trang số mấy?"` / `✅ Đúng: "Theo công thức trong trang, giá trị của X là bao nhiêu?"` |
| 5 | Cache key | Đổi từ `quiz_${pageNum}_${this.provider}` → `quiz_${pageNum}_${this.provider}_${count}`. |
| 6 | `clearQuizForPage(pageNum)` | Sửa từ `delete` một key → xoá mọi key có prefix `quiz_${pageNum}_${this.provider}_` (dùng vòng lặp trên quizCache keys). |
| 7 | Giữ nguyên | `validateQuizQuestions`, `hasVision`, `_callAPI` signature, cache bằng map. |

**System prompt mới (tiếng Việt):**
```
Bạn là giảng viên tạo câu hỏi trắc nghiệm để kiểm tra hiểu bài.
Tạo CHÍNH XÁC {count} câu hỏi từ nội dung trang tài liệu. Độ khó tăng dần.
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
explanation phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.
```

### B. `index.html` — dropdown

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Vị trí | Trong `#quiz-empty` (empty state), cạnh nút `#quiz-start-btn`. |
| 2 | HTML thêm vào | `<label class="quiz-count-label" for="quiz-count">Số câu</label><select id="quiz-count"><option value="3" selected>3</option><option value="5">5</option><option value="10">10</option></select>` |
| 3 | Hành vi ẩn/hiện | Chỉ đặt trong empty state — khi quiz đang làm (`quiz-question`/`quiz-result` hiển thị), dropdown ẩn đi theo `#quiz-empty`. Đúng hành vi B: đổi số lúc đang làm không ảnh hưởng. |
| 4 | Chỉ một chỗ | Chỉ đặt một chỗ trong `#quiz-empty`, không đặt thêm trong quiz question/result. |

### C. `css/style.css`

| # | Mục | Thay đổi |
|---|---|---|
| 1 | `.quiz-count-label` | Style nhãn: `font-size:0.8rem; color:var(--text-secondary); margin-right:6px;` |
| 2 | `#quiz-count` | Style dropdown: `background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:var(--radius-sm); color:var(--text-primary); font-family:inherit; font-size:0.85rem; padding:8px 12px; cursor:pointer;` |
| 3 | Bố cục | `#quiz-empty .btn-primary` hiện có `margin-top:8px;` — cần wrap nút + dropdown trong một div inline-flex hoặc để tự nhiên với `display:flex; gap:10px;` cho khu vực controls. |

### D. `js/quiz.js` — QuizManager

| # | Mục | Thay đổi |
|---|---|---|
| 1 | Constructor | Thêm tham chiếu: `this.quizCountSelect = document.getElementById('quiz-count')` và `this.quizCountLabel` (nếu cần). |
| 2 | `_getQuizCount()` | Phương thức mới: `return parseInt(this.quizCountSelect.value, 10) \|\| 3`. |
| 3 | `_generateForCurrentPage()` | Truyền `this._getQuizCount()` vào `this.app.aiEngine.generateQuiz(pageNum, pageText, imageBase64, count)`. |
| 4 | `_showResult()` | Dùng `this.questions.length` làm total; lưu score `{best, last, total, lastTime, attempts}` — thêm trường `total`. Hiển thị `Điểm cao nhất: X/N` động từ `score.total`. |
| 5 | `_syncForPage(pageNum)` | Sửa `"Điểm cao nhất: ${score.best}/3"` → `"Điểm cao nhất: ${score.best}/${score.total \|\| this.questions.length \|\| 3}"`. |
| 6 | `_showResult()` text | Sửa `"Bạn trả lời đúng <strong>${this.correctCount}/${this.questions.length}</strong> câu."` — giữ nguyên vì đã dùng `this.questions.length` (động sẵn). |
| 7 | `onPdfLoaded()` | Sửa text `'Tạo 3 câu hỏi'` → `'Tạo câu hỏi trắc nghiệm'` (bỏ số cố định). |
| 8 | `_resetToEmpty()` | Sửa text `'Tạo 3 câu hỏi'` → `'Tạo câu hỏi trắc nghiệm'` (bỏ số cố định). |
| 9 | Giữ nguyên | Cơ chế `_genSeq`/`genId` race fix, abort guard — không đụng. |

### E. Kiểm thử

| # | Kiểm thử | Lệnh / Mô tả |
|---|---|---|
| 1 | Syntax check | `node --check js/ai-engine.js js/quiz.js` → exit 0. |
| 2 | Unit tests hiện có | `node tests/title-detect.test.mjs && node tests/quiz-validate.test.mjs` → PASS. |
| 3 | Smoke test | `node tests/smoke-quiz.mjs` (server `python3 server.py &`) → `✅ Smoke test quiz PASS`. |
| 4 | QA tay (stub) | Playwright inject `generateQuiz` stub với count 5 → xác nhận 5 câu render; chọn 10 → 10 câu. |
| 5 | Regression: cache cũ | Cache cũ (`quiz_<trang>_<provider>` không có suffix count) — sau khi đổi key, quiz cũ trong session không còn dùng được → chấp nhận (session cache, mất cũng không sao). |

---

## 4. Không làm (YAGNI)

| # | Mục | Lý do |
|---|---|---|
| 1 | Bộ lọc hậu kỳ so khớp từ khoá text | Sẽ loại nhầm câu diễn đạt lại đúng ý. |
| 2 | Option số câu khác 3/5/10 | Đủ dùng cho v1. |
| 3 | Tự sinh lại khi đổi dropdown | Phương án B đã chốt với user. |
| 4 | Đổi `server.py` | Không liên quan. |
| 5 | Thêm dependency mới | Không cần. |

---

## 5. Tác động file

| File | Thay đổi |
|---|---|
| `js/ai-engine.js` | Sửa `generateQuiz()`: thêm tham số `count`, sửa system prompt (chỉ thị nội dung + ví dụ), đổi cache key thêm `_${count}`, sửa `clearQuizForPage()` xoá prefix. |
| `js/quiz.js` | Thêm `quizCountSelect`, `_getQuizCount()`, truyền count vào generateQuiz; sửa điểm số/thông báo dùng `questions.length` động. |
| `index.html` | Thêm label + select dropdown trong `#quiz-empty`. |
| `css/style.css` | Style `.quiz-count-label` + `#quiz-count`. |
| `docs/…` | Design doc này. |

## 6. Rủi ro & lưu ý

- **Cache cũ mất hiệu lực**: key cũ `quiz_<trang>_<provider>` không còn map với key mới `quiz_<trang>_<provider>_<count>` → quiz đã cache trong phiên trước đó sẽ không được tái sử dụng. Đây là session cache nên mất không ảnh hưởng trải nghiệm.
- **Prompt dài hơn**: thêm chỉ thị nội dung + ví dụ → tăng token input ~100-150 token. Chi phí không đáng kể.
- **`clearQuizForPage` prefix**: dùng vòng lặp `for...of` qua `quizCache.keys()` → O(n) với n là số quiz đã cache. Với tài liệu 100 trang, n ≤ 100 → không đáng kể.
- **`_syncForPage` hiển thị total**: nếu chưa từng làm quiz trang đó (`score = null`) nhưng đang hiển thị quiz với `this.questions.length > 0`, cần fallback hiển thị `this.questions.length` thay vì `score.total`.
