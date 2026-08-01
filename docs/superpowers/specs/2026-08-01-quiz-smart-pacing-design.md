# Thiết kế: Quiz trắc nghiệm tự động + Căn thời gian giảng thông minh

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Trạng thái:** Đã được user duyệt (2026-08-01)

---

## 1. Bối cảnh & mục tiêu

ScholarVoice hiện có: PDF Viewer, AI Lecture (4 provider: Gemini / NVIDIA / DeepSeek / Ollama, 3 style + tính cách tùy chỉnh), Smart Q&A (context từng trang), TTS đa ngôn ngữ, Auto-read, Audio cache (export/import), phụ đề, seek bar.

Hai nâng cấp được chốt:

1. **Quiz trắc nghiệm tự động** — AI sinh câu hỏi từ nội dung trang, chấm điểm ngay, giải thích, đọc bằng giọng, lưu điểm theo trang.
2. **Căn thời gian giảng thông minh** — slide chỉ có tiêu đề được giảng ngắn gọn (1-2 câu nối mạch) và tự động chuyển trang khi auto-read bật; slide nội dung chính vẫn được phân tích đầy đủ.

---

## 2. Kiến trúc hiện tại (tóm tắt)

- Frontend thuần vanilla JS ES modules: `js/app.js` (orchestrator), `js/ai-engine.js` (router AI + prompt + cache), `js/pdf-viewer.js` (pdf.js wrapper: `getPageText()`, `getPageImageBase64()`, highlight), `js/tts-engine.js` (Web Speech API + seek/progress), `js/chat.js` (UI chat).
- Backend `server.py`: proxy NVIDIA / DeepSeek (session free API) / Google Cloud TTS.
- Lưu trữ: `localStorage` (settings `ai_settings`, cache `cache_<filename>`, chat `chat_history_<filename>`).
- Pattern AI có sẵn: `_callAPI()` → router provider → JSON mode (`response_format: json_object` / `responseMimeType: application/json`) → parse JSON với fallback.
- `ai-engine.js` đã có `docContext` (tóm tắt các trang đã giảng) — tái sử dụng cho quiz context.

---

## 3. Tính năng 1: Quiz trắc nghiệm tự động

### 3.1 Quyết định thiết kế (đã chốt với user)

| # | Quyết định | Giá trị |
|---|---|---|
| 1 | Phạm vi | **(c) Cả hai** — v1: quiz từng trang; quiz toàn tài liệu hoãn lại (cần hạ tầng trích text toàn file ở phase "Chat toàn tài liệu") |
| 2 | Loại câu hỏi | **(b)** MCQ 4 đáp án + Đúng/Sai (chấm tự động client-side, không tốn thêm API call) |
| 3 | Luồng chấm | **(a)** Chấm ngay từng câu: trả lời → đúng/sai + giải thích ngay → câu tiếp |
| 4 | Số câu/lần | **(a)** 3 câu/trang |
| 5 | Giọng đọc | **(a)** TTS đọc câu hỏi + giải thích |
| 6 | Lưu kết quả | **(b)** localStorage theo file PDF: điểm cao nhất + lần gần nhất mỗi trang |

### 3.2 Luồng hoạt động

1. User bấm tab **"📝 Quiz"** ở panel phải (cạnh tab Chat).
2. `QuizManager` kiểm tra cache quiz của trang hiện tại:
   - Chưa có → gọi `AIEngine.generateQuiz(pageText, imageBase64)` → hiện trạng thái "Đang sinh câu hỏi..." (icon 🤔 như pattern hiện có).
   - Có → hiện quiz đã cache ngay.
3. Hiện câu 1 (MCQ: 4 nút A/B/C/D; TF: 2 nút Đúng/Sai). **TTS đọc câu hỏi** (`_cleanVoiceText` trước khi đọc).
4. User chọn đáp án → chấm ngay: tô xanh đáp án đúng, đỏ đáp án đã chọn nếu sai → hiện **giải thích ngắn** → **TTS đọc giải thích** → nút "Câu tiếp →".
5. Lặp đến câu 3 → màn hình tổng kết: "2/3 đúng", lưu điểm, 2 nút: **"🔄 Làm lại"** (xóa cache quiz trang đó, sinh 3 câu mới) và **"Đóng"** (về trạng thái sẵn sàng).
6. Điểm được lưu: `quiz_scores_<filename>` — xem mục 3.5.

### 3.3 API contract AI

`AIEngine.generateQuiz(pageText, imageBase64)` → gọi `_callAPI()` (router 4 provider, jsonMode=true).

**System prompt (tiếng Việt):**
```
Bạn là giảng viên tạo câu hỏi trắc nghiệm để kiểm tra hiểu bài.
Tạo CHÍNH XÁC 3 câu hỏi từ nội dung trang tài liệu.
Độ khó tăng dần. Câu hỏi phải bám sát nội dung trang, KHÔNG bịa kiến thức ngoài.
Trả về JSON duy nhất, không thêm text ngoài JSON:
{
  "questions": [
    {
      "type": "mcq",
      "question": "nội dung câu hỏi",
      "options": ["đáp án A", "đáp án B", "đáp án C", "đáp án D"],
      "correct_index": 0,
      "explanation": "giải thích ngắn vì sao đúng, 1-2 câu"
    },
    {
      "type": "tf",
      "question": "khẳng định đúng hay sai",
      "correct": true,
      "explanation": "giải thích ngắn 1-2 câu"
    }
  ]
}
```
- Luôn trả lời bằng TIẾNG VIỆT.
- `explanation` viết phù hợp để đọc bằng giọng: không ký hiệu toán học, không markdown.

**Input:** `pageText` (bắt buộc, ưu tiên) + `imageBase64` nếu provider có vision (như pattern `teachPage`).

**Parse & validation:**
- Dùng pattern parse JSON có fallback (giống `_parseSegmentsJSON` / `parseResult` hiện có).
- Validate: đủ 3 câu, mỗi câu có `type` hợp lệ, MCQ có đủ 4 options + `correct_index` trong [0,3], TF có `correct` boolean.
- Thiếu/thiếu trường → dùng `explanation` rỗng, hoặc bỏ câu lỗi nếu vẫn còn ≥ 1 câu; nếu không parse được → hiện lỗi "Không tạo được câu hỏi, bấm thử lại" + nút retry (pattern hiện có của `_teachCurrentPage`).

### 3.4 UI & tương tác

- **Tab "📝 Quiz"** trong panel phải, cạnh tab "💬 Chat" (chuyển đổi tab, giữ state chat hiện có). Cần sửa `index.html` (cấu trúc tab) + `css/style.css` (style tab + quiz card).
- Khi đang giảng (TTS speak) mà mở quiz → không dừng giảng (như hành vi chat hiện tại khi `_isTeaching`).
- Nếu chưa tải PDF / chưa cấu hình API → toast + mở modal settings (pattern hiện có).
- Keyboard: phím `1-4` chọn MCQ, `Đ`/`S` không bắt buộc v1 — bỏ qua (YAGNI), chỉ nút bấm.
- Highlight: không dùng region highlight cho quiz (câu hỏi không gắn vùng cụ thể).

### 3.5 Lưu trữ

`localStorage["quiz_scores_<filename>"]`:
```json
{
  "filename": "bai-giang.pdf",
  "provider": "gemini",
  "scores": {
    "1": { "best": 2, "last": 2, "lastTime": 1722500000000, "attempts": 3 },
    "2": { "best": 3, "last": 1, "lastTime": 1722500100000, "attempts": 1 }
  }
}
```
- `best`: điểm cao nhất (0-3); `last`: lần gần nhất; `attempts`: số lần làm.
- Hiển thị trong tab Quiz: header hiện "Trang X — điểm cao nhất: 2/3" nếu có.
- Khi user bấm "Xoá cache" (`clear-cache-btn`) → không xóa quiz_scores (điểm là thành tích học, không phải cache âm thanh). Lưu ý đưa vào phần lưu ý triển khai.

### 3.6 Cache & chi phí API

- `quizCache: Map` trong `AIEngine`, key `quiz_<page>_<provider>` (không phân biệt style — quiz không phụ thuộc teaching style).
- Cache trong phiên (session) + lưu vào localStorage cùng cấu trúc `cache_<filename>` khi export/import cache? → **v1: KHÔNG** export quiz cache (YAGNI). Chỉ cache trong bộ nhớ phiên.
- Chi phí: 3 câu/trang = 1 API call. Cache tránh gọi lại khi đổi qua lại giữa các trang.
- "Làm lại" → xóa key quiz của trang → sinh mới.

### 3.7 Lỗi & fallback

- API lỗi/abort → toast lỗi + nút "Thử lại" (pattern `_teachCurrentPage`).
- PDF chưa tải → toast "Vui lòng tải file PDF trước".
- Provider chưa cấu hình → mở modal settings.
- `pageText` rỗng + không vision → thông báo không đủ nội dung để tạo câu hỏi.

### 3.8 Kiểm thử

- Test thủ công (script tạm trong browser console hoặc `test_playwright.js` pattern):
  - Tạo quiz trang có công thức/nội dung dày → 3 câu hợp lệ, bám nội dung.
  - Trả lời đúng/sai → chấm đúng, giải thích hiện, TTS đọc.
  - Đổi trang → quiz mới; quay lại trang cũ → quiz cũ (cache).
  - "Làm lại" → câu mới khác.
  - Lưu điểm: làm 2 lần → `best`/`last`/`attempts` đúng.
  - Provider không vision (DeepSeek) → quiz vẫn chạy từ text.
- LSP diagnostics sạch, không vỡ luồng chat/giảng hiện có.

### 3.9 Phạm vi ngoài v1 (YAGNI)

- Quiz toàn tài liệu (chờ hạ tầng document index ở phase "Chat toàn tài liệu").
- Câu tự luận, chấm điểm AI cho câu viết.
- Export/import điểm quiz.
- Xếp hạng/streak.

---

## 4. Tính năng 2: Căn thời gian giảng thông minh

### 4.1 Phát hiện slide tiêu đề (client-side, miễn phí)

- Tại `app.js._teachCurrentPage()` (và `_prefetchNextPages()`), trước khi gọi AI: lấy `pageText` (đã có sẵn trong luồng), áp hàm:

```js
function detectTitleSlide(pageText) {
  if (!pageText || !pageText.trim()) return false; // trang không có text → không phán đoán, xử lý như nội dung (an toàn)
  const clean = pageText.replace(/[#*`\-_=~]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  return words.length <= 20;
}
```

- Ngưỡng **≤ 20 từ**: bắt trang bìa / trang "Chương X: ..." / trang chia mục, không bắt nhầm trang nội dung ngắn có bảng/hình (những trang đó thường có ≥ 20 từ hoặc nhiều hình → vẫn giảng vision bình thường).
- Hằng số ngưỡng đặt 1 chỗ (module hoặc đầu file) để dễ chỉnh.
- Trang không trích được text (lỗi) → `false` (mặc định an toàn: giảng bình thường).

### 4.2 Hành vi giảng

- **Slide tiêu đề** (`isTitleSlide === true`):
  - `teachPage(..., { isTitleSlide: true })` → system prompt thay bằng phiên bản ngắn:
    ```
    Trang này CHỈ CÓ TIÊU ĐỀ (trang bìa/trang mở đầu chương).
    Hãy nói NGẮN GỌN 1-2 câu giới thiệu nội dung sắp học, nối mạch với bài giảng trước đó.
    KHÔNG phân tích, KHÔNG bịa nội dung, KHÔNG lặp tiêu đề quá dài dòng.
    ```
  - Không yêu cầu JSON segments → `segments = null`, không highlight, không tạo subtitle dài (subtitle = 1-2 câu).
  - Giữ cơ chế context liên kết trang trước (`_buildContext`) để lời giới thiệu tự nhiên.
- **Slide nội dung**: prompt hiện tại giữ nguyên (đã có hướng dẫn phân tích chuẩn + liên kết bài giảng).

### 4.3 Auto-advance (auto-read bật)

- Sau khi TTS của slide tiêu đề kết thúc (`onEnd`) và `autoRead === true` và slide vừa giảng là title slide → chờ **~2.5s** → `_navigatePage('next')` (hàm này tự gọi `_teachCurrentPage` khi autoRead bật → chuỗi giảng liền mạch).
- Slide nội dung: giữ hành vi hiện tại (dừng sau khi giảng xong trang, chờ user thao tác).
- Phải lưu cờ `_lastTaughtWasTitle` khi bắt đầu giảng; reset đúng lúc để không auto-advance nhầm (vd: user dừng giữa chừng bằng nút Stop → không auto-advance).
- Khi `autoRead` tắt → không auto-advance (giữ nguyên hành vi).

### 4.4 Cache

- Cache key giữ nguyên `page_<n>_<provider>_<style>` (kết quả là xác định với cùng input) → slide tiêu đề cũng được cache bình thường; không cần phân biệt key riêng.
- Prefetch (`_prefetchNextPages`) cũng áp dụng phát hiện title slide (tránh tốn token giảng dài cho trang tiêu đề).

### 4.5 Lỗi & fallback

- `detectTitleSlide` lỗi/không có text → `false` → giảng bình thường.
- API lỗi → giữ nguyên hành vi retry hiện tại của `_teachCurrentPage`.

### 4.6 Kiểm thử

- Test hàm `detectTitleSlide`: chuỗi ngắn (≤ 20 từ) → true; đoạn nội dung dài → false; rỗng → false; nhiều ký tự đặc biệt/heading → xử lý đúng.
- Test thủ công với PDF có trang bìa + trang nội dung: auto-read bật → trang bìa nói ngắn rồi tự sang trang tiếp; trang nội dung giảng đầy đủ và dừng.
- Prefetch: trang tiêu đề được prefetch ngắn gọn.

---

## 5. Tác động file

| File | Thay đổi |
|---|---|
| `js/quiz.js` | **Mới** — `QuizManager`: UI tab quiz, luồng câu hỏi, chấm điểm, TTS, lưu điểm |
| `js/ai-engine.js` | Thêm `generateQuiz()` + `quizCache` + `clearQuizPage()`; sửa `teachPage()` nhận flag `isTitleSlide` (prompt ngắn) |
| `js/app.js` | Khởi tạo `QuizManager` + setup tab; phát hiện title slide trong `_teachCurrentPage`/`_prefetchNextPages`; auto-advance title slide khi autoRead; không xóa quiz_scores khi clear cache |
| `index.html` | Thêm tab "📝 Quiz" + container quiz (panel phải) |
| `css/style.css` | Style tab quiz, câu hỏi, đáp án đúng/sai, tổng kết |
| `docs/…` | Design doc này |

## 6. Rủi ro & lưu ý

- **Prompt tiêu đề ngắn** có thể bị model "quá ngắn" (0 câu) hoặc lặp tiêu đề → thử nghiệm với từng provider; fallback: nếu output rỗng → dùng template mặc định "Tiếp theo chúng ta đến với <tiêu đề>".
- DeepSeek không vision → quiz chỉ từ text; chất lượng phụ thuộc text trích xuất (pdf.js).
- `_callAPI` dùng chung `_abortController` — quiz phải dùng pattern abort riêng như chat/teach để không xung đột khi user thao tác nhanh.
- Điểm quiz không bị xóa khi "Xoá cache" (quyết định có chủ ý).
- Auto-advance chỉ kích hoạt khi TTS kết thúc tự nhiên (không phải do user Stop) và chỉ cho title slide.
