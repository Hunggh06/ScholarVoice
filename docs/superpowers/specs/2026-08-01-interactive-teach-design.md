# Tương tác hỏi đáp khi giảng (Plan D)

**Ngày:** 2026-08-01
**Dự án:** ScholarVoice — biến PDF thành bài giảng AI bằng giọng nói
**Trạng thái:** Chờ user duyệt (2026-08-01)

---

## 1. Vấn đề

Hiện tại khi AI giảng một slide (TTS), người học chỉ nghe thụ động — không có cơ chế kiểm tra hiểu bài giữa chừng. Nội dung dài, nhiều khái niệm dễ khiến người học mất tập trung. Cần một luồng tương tác: AI chủ động đặt câu hỏi trắc nghiệm ngay trong lúc giảng, user trả lời, AI xác nhận và giải thích, rồi giảng tiếp trên cùng slide — tất cả trong 1 API call duy nhất.

---

## 2. Mục tiêu

1. AI tự quyết định điểm dừng để hỏi trong lúc giảng một slide, dựa trên độ phức tạp của nội dung.
2. Câu hỏi trắc nghiệm 4 đáp án A/B/C/D hiện trong tab chat, user gõ chữ cái để trả lời.
3. AI xác nhận đúng/sai + giải thích ngay trong chat, không gọi API riêng.
4. Sau khi trả lời, giảng tiếp tục trên cùng slide từ chunk kế tiếp.
5. Toàn bộ luồng (giảng + câu hỏi) gói gọn trong 1 API call `teachPage` — cache cũ vẫn hoạt động an toàn.

---

## 3. Yêu cầu (đã chốt với user)

| # | Yêu cầu | Phương án đã chốt |
|---|---|---|
| 1 | Khi nào hỏi | **C. AI tự quyết định điểm dừng** — slide dài/khó/nhiều khái niệm → hỏi; slide tiêu đề/giới thiệu/chuyển tiếp → không hỏi. |
| 2 | Dạng câu hỏi | **B. Trắc nghiệm 4 đáp án A/B/C/D** hiện trong chat, user gõ chữ cái. |
| 3 | Trả lời sai | **A. Giải thích đáp án đúng ngay trong chat rồi giảng tiếp** bình thường (không ôn lại, không ghi điểm). |
| 4 | Giọng + auto-read | **A. Đọc to câu hỏi + 4 đáp án bằng TTS, chờ user trả lời** (không timeout); sau khi trả lời xong → giảng tiếp. Auto-read tạm dừng khi đang chờ. |
| 5 | Kiến trúc | **Phương án 1 — gộp câu hỏi vào chính response giảng bài (1 API call)** vì API trả về chậm, user không muốn 2 call. Cache cũ KHÔNG bị invalidate: entry cũ thiếu field mới → giảng như hiện tại (single utterance, không tương tác). |

---

## 4. Thiết kế chi tiết (spec từng file)

### A. `js/ai-engine.js` — mở rộng `teachPage` response (1 API call, cache-safe)

**Response JSON mới (2 field TÙY CHỌN):**

Response hiện tại (dòng 263) trả về `{ voice_text, segments, isTitleSlide }`. Mở rộng thêm 2 field optional:

| Field | Type | Mô tả |
|---|---|---|
| `voice_chunks` | `[{text, regionVert}]` \| null | Lời giảng chia thành các đoạn nhỏ do AI tự chia theo ý giảng. Mỗi chunk có `regionVert` để highlight (pattern giống `segments` hiện có). Nếu thiếu → fallback tạo 1 chunk từ `voice_text`. |
| `interactive_questions` | `[...]` \| null | Mảng 0..N câu hỏi. Mỗi câu: `{after_chunk: int, question: string, options: [string,4], correct_index: int 0-3, explanation: string}`. `after_chunk: X` nghĩa là hỏi ngay sau khi đọc xong chunk X (0-indexed). |

**Thay đổi cụ thể:**

| # | Mục | Vị trí | Thay đổi |
|---|---|---|---|
| 1 | System prompt (non-title slide) | Dòng 178-202 (`teachPage`) | Thêm đoạn hướng dẫn AI: *"TƯƠNG TÁC HỎI ĐÁP: Nếu trang chứa khái niệm/công thức/điểm quan trọng (KHÔNG phải trang tiêu đề/chuyển tiếp), hãy chủ động chèn 1-3 câu hỏi trắc nghiệm vào giữa bài giảng. Với mỗi câu hỏi cần chỉ rõ hỏi SAU chunk nào (after_chunk, 0-indexed). Nếu trang ngắn/tiêu đề → interactive_questions: []. Câu hỏi TIẾNG VIỆT, 4 đáp án (1 đúng + 3 nhiễu hợp lý), correct_index 0-3, explanation ngắn gọn."* |
| 2 | User prompt (vision mode) | Dòng 206-227 | Mở rộng JSON schema: thêm `voice_chunks` và `interactive_questions` vào cấu trúc trả về. `voice_chunks` thay thế `segments` làm nguồn chunking chính khi có tương tác. |
| 3 | Parse response | Sau dòng 236 | Gọi `_extractVoiceChunks(json)` và `_extractInteractiveQuestions(json)`. Parse an toàn: lỗi/thiếu → null/[] (bỏ qua tương tác, giảng bình thường). |
| 4 | Hàm `_extractVoiceChunks(json)` | Hàm mới private | Parse `json.voice_chunks` — phải là mảng, mỗi phần tử có `text` (string non-empty) + `regionVert` (mảng 2 số). Fallback: nếu parse thất bại hoặc mảng rỗng → tạo 1 chunk từ `voice_text` với regionVert [0,1]. |
| 5 | Hàm `_extractInteractiveQuestions(json)` | Hàm mới private | Parse `json.interactive_questions` — phải là mảng, mỗi phần tử có `after_chunk` (int >= 0), `question` (string non-empty), `options` (mảng 4 string non-empty), `correct_index` (int 0-3), `explanation` (string). Validate: `after_chunk` <= `voice_chunks.length - 1`, `correct_index` 0-3, `options.length === 4`. Lỗi/thiếu field → trả []. |
| 6 | Cache entry | Dòng 263 | Lưu `voice_chunks` + `interactive_questions` vào result object. Cache key KHÔNG đổi (`page_${pageNum}_${provider}_${teachingStyle}`). Entry cũ không có 2 field này → hành vi cũ y nguyên (single utterance). |
| 7 | `askQuestion` | Dòng 272 | **KHÔNG đổi** — chat thường giữ nguyên. |

**System prompt bổ sung (đề xuất, chèn vào sau dòng 189 trong prompt non-title):**
```
TƯƠNG TÁC HỎI ĐÁP (tùy chọn):
- Bạn CÓ THỂ chèn câu hỏi trắc nghiệm vào giữa bài giảng để kiểm tra mức độ hiểu của sinh viên.
- KHI NÀO HỎI: Trang có nhiều khái niệm, công thức, điểm quan trọng → 1-3 câu hỏi. Trang tiêu đề, giới thiệu, ngắn → KHÔNG hỏi (interactive_questions: []).
- CÂU HỎI: Tiếng Việt, 4 đáp án A/B/C/D, 1 đúng + 3 nhiễu hợp lý, correct_index là index của đáp án đúng (0-3).
- GIẢI THÍCH: explanation ngắn gọn 1-2 câu, giải thích tại sao đáp án đó đúng.
- after_chunk: số thứ tự chunk (bắt đầu từ 0) mà SAU KHI đọc xong chunk đó sẽ hỏi.
```

**JSON schema mở rộng cho vision mode user prompt (thay thế schema hiện tại dòng 211-227):**
```json
{
  "voice_chunks": [
    {"text": "nội dung giảng cho đoạn 1", "region_vert": [0, 0.3]},
    {"text": "nội dung giảng cho đoạn 2", "region_vert": [0.3, 0.7]}
  ],
  "interactive_questions": [
    {
      "after_chunk": 0,
      "question": "Câu hỏi tiếng Việt?",
      "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
      "correct_index": 1,
      "explanation": "Giải thích ngắn gọn tại sao đáp án này đúng."
    }
  ]
}
```

---

### B. `js/tts-engine.js` — chế độ đọc chuỗi `speakSequence`

| # | Mục | Vị trí | Thay đổi |
|---|---|---|---|
| 1 | Method mới `speakSequence(chunks, callbacks)` | Sau `speak()` (dòng 135) | Đọc lần lượt từng chunk text trong mảng `chunks`. Với mỗi chunk, gọi `this.speak(chunk.text)` qua SpeechSynthesis. Sau mỗi chunk (trừ chunk cuối) fire `callbacks.onChunkEnd(i, chunk)`. Chunk cuối xong fire `callbacks.onEnd` — giữ hợp đồng `onEnd` cũ. |
| 2 | Kế thừa rate/voice | Trong `speakSequence` | Dùng `this._rate`, `this._voiceURI`/`this._voiceId` khi tạo utterance — rate/voice đã có sẵn trong `speak()`. |
| 3 | Pause/Resume trong sequence | Trong `speakSequence` | `this.pause()` và `this.resume()` đã hoạt động trên utterance hiện tại — không cần thay đổi. Stop (`this.stop()`) hủy toàn bộ sequence. |
| 4 | Callback signature | Trong `speakSequence` | `callbacks = { onChunkStart(i, chunk), onChunkEnd(i, chunk), onEnd(), onError(err) }`. `onChunkEnd` chỉ fire cho chunk 0..N-2; chunk cuối fire `onEnd`. |
| 5 | Khoảng nghỉ giữa chunk | Trong `speakSequence` | Chèn `await sleep(150)` ms giữa các chunk để tránh browser SpeechSynthesis bỏ `onEnd` khi speak liên tiếp quá nhanh (quirk đã biết của Chrome). |
| 6 | `_sequenceActive` flag | Constructor + `speakSequence` | Flag `this._sequenceActive = false` để phân biệt đang ở chế độ sequence hay single utterance. Stop → reset flag. |
| 7 | `_currentChunkIndex` | Constructor + `speakSequence` | Lưu index chunk đang đọc để app có thể dùng `setHighlightRegion(chunk.regionVert)`. |

**Logic `speakSequence`:**
```
speakSequence(chunks, callbacks):
  this._sequenceActive = true
  for i = 0 to chunks.length - 1:
    if (!this._sequenceActive) return  // stopped
    this._currentChunkIndex = i
    callbacks.onChunkStart(i, chunks[i])
    await this._speakChunk(chunks[i].text)  // promise resolves on onEnd
    if (!this._sequenceActive) return
    if i < chunks.length - 1:
      callbacks.onChunkEnd(i, chunks[i])
      await sleep(150)
  this._sequenceActive = false
  callbacks.onEnd()
```

---

### C. `js/app.js` — luồng tương tác

#### C.1. `_teachCurrentPage` (dòng 717-784) — entry point

| # | Mục | Vị trí | Thay đổi |
|---|---|---|---|
| 1 | Sau khi nhận `result` | Dòng 754-763 | Sau `result = await this.aiEngine.teachPage(...)`: kiểm tra `result.interactive_questions?.length > 0` VÀ toggle `ai_settings.interactiveTeach` bật. Nếu đúng → lưu `this._chunks = result.voice_chunks \|\| [single chunk từ voice_text]`, `this._questions = result.interactive_questions`, `this._qIdx = 0`, `this._awaitingAnswer = false` → gọi `ttsEngine.speakSequence(thay vì speak)`. Nếu không → đường cũ y nguyên (`ttsEngine.speak`). |
| 2 | Cache hit path | Dòng 725-738 | Kiểm tra `entry.voice_chunks` và `entry.interactive_questions` tương tự — cache entry cũ thiếu field → coi như không tương tác, đi đường `speak` cũ. |
| 3 | Tạo single chunk fallback | Trong bước 1 | Nếu không có `voice_chunks`, tạo: `[{text: result.voice_text, regionVert: [0, 1]}]`. |

#### C.2. `onChunkEnd(i, chunk)` callback — dừng giảng, hiện câu hỏi

| # | Mục | Chi tiết |
|---|---|---|
| 1 | Kiểm tra câu hỏi | Nếu `this._questions[this._qIdx]?.after_chunk === i`: dừng giảng, hiện câu hỏi. |
| 2 | Hiển thị câu hỏi trong chat | `chatManager.addAIMessage("❓ " + q.question + "\n\nA. " + q.options[0] + "\nB. " + q.options[1] + "\nC. " + q.options[2] + "\nD. " + q.options[3])` — dùng `addAIMessage` để KaTeX hoạt động. |
| 3 | TTS đọc câu hỏi | Tạm dừng sequence → gọi `ttsEngine.speak(questionText)` để đọc to câu hỏi + 4 đáp án. Sau khi đọc xong (`onEnd` tạm), set `_awaitingAnswer = true` và update voice status. |
| 4 | Voice status | `this._updateVoiceStatus('done', '❓ Đang chờ bạn trả lời...')` |
| 5 | Chuyển tab chat | Hiện tại `chat.js` KHÔNG có `switchTab` method. Cần thêm `chatManager.switchTab('chat')` hoặc dùng pattern trực tiếp qua `document.getElementById`: ẩn `#quiz-area` / `#flash-area`, hiện `#chat-area`, toggle active class trên tabs. **Spec ghi rõ: cần thêm method switchTab vào ChatManager** (pattern theo `QuizManager.switchTab` dòng 73 quiz.js). |
| 6 | Set `_awaitingAnswer = true` | Chặn chat thường, chỉ nhận A-D. |

#### C.3. `_handleChatMessage` (dòng 1112-1166) — gate câu trả lời

| # | Mục | Vị trí | Thay đổi |
|---|---|---|---|
| 1 | Gate đầu hàm | Đầu `_handleChatMessage` (trước dòng 1113) | Thêm: `if (this._awaitingAnswer === true) { this._handleInteractiveAnswer(text); return; }` |
| 2 | Method mới `_handleInteractiveAnswer(text)` | Sau `_handleChatMessage` | (xem C.4) |

#### C.4. `_handleInteractiveAnswer(text)` — xử lý trả lời

| # | Mục | Chi tiết |
|---|---|---|
| 1 | Chuẩn hóa input | Chấp nhận: "a", "A", "A.", "A)", "a.", "a)". Lấy ký tự đầu tiên, uppercase → index: A=0, B=1, C=2, D=3. |
| 2 | Nhập sai định dạng | Nếu không parse được A-D → `chatManager.addAIMessage("⚠️ Vui lòng trả lời A, B, C hoặc D.")`. Return, KHÔNG thoát trạng thái chờ. |
| 3 | Đúng/Sai | So sánh `userIndex === correct_index`. Nếu đúng → `chatManager.addAIMessage("✅ Đúng! " + q.explanation)`. Nếu sai → `chatManager.addAIMessage("❌ Sai. Đáp án đúng là " + q.options[q.correct_index] + ". " + q.explanation)`. KHÔNG gọi API, KHÔNG ghi điểm. |
| 4 | TTS đọc xác nhận | Gọi `ttsEngine.speak(confirmText)` để đọc ngắn xác nhận + giải thích. |
| 5 | Tiếp tục giảng | `this._qIdx++`, `this._awaitingAnswer = false` → gọi `speakSequence` TIẾP TỤC từ chunk `i+1` (không đọc lại từ đầu slide). Cần lưu `_currentChunkIdx` để biết resume từ đâu. |
| 6 | Hết câu hỏi | Sau chunk cuối + hết `_questions` → `onEnd` như cũ: nút "Kiểm tra ngay", auto-read advance (chỉ với title slide). |

#### C.5. Luồng `speakSequence` callback wiring

| # | Callback | Hành vi |
|---|---|---|
| 1 | `onChunkStart(i, chunk)` | Nếu `chunk.regionVert` → `pdfViewer.setHighlightRegion(chunk.regionVert)`. Nếu không → `pdfViewer.clearHighlight()`. Update subtitle với `chunk.text`. |
| 2 | `onChunkEnd(i, chunk)` | Kiểm tra `_questions[_qIdx]?.after_chunk === i` → nếu có, gọi luồng hiển thị câu hỏi (C.2). Nếu không → highlight chunk tiếp theo (nếu có). |
| 3 | `onEnd()` | Giữ hợp đồng cũ: set `this._isTeaching = false`, `this._justTaught = true`, `_updateVoiceStatus('done', ...)`, clear highlight, clear subtitle. Nếu còn câu hỏi chưa hỏi (không nên xảy ra vì `after_chunk` luôn <= N-2) → bỏ qua. |
| 4 | Seek bar | **Disabled** khi `_questions?.length > 0` (có câu hỏi) → `_updateSeekSlider(false)`. Play/Pause/Stop vẫn hoạt động. |

#### C.6. Stop & reset

| # | Trigger | Hành vi |
|---|---|---|
| 1 | ⏹ Stop button | `this.ttsEngine.stop()` → `this._sequenceActive = false` → sequence dừng. Reset: `this._isTeaching = false`, `this._awaitingAnswer = false`, `this._questions = null`, `this._qIdx = 0`. `_updateVoiceStatus('stopped', 'Đã dừng giảng.')`. |
| 2 | Chuyển trang (`_navigatePage`, dòng 670) | Đã có `this.ttsEngine.stop()` + reset `currentSegments`, `_lastTaughtWasTitle`, `_justTaught`. Thêm reset: `this._awaitingAnswer = false`, `this._questions = null`, `this._qIdx = 0`, `this._chunks = null`. |

#### C.7. Constructor state (thêm vào dòng 21-24)

Thêm các state variable:
- `this._chunks = null` — mảng chunks giảng hiện tại
- `this._questions = null` — mảng interactive_questions
- `this._qIdx = 0` — index câu hỏi tiếp theo
- `this._awaitingAnswer = false` — đang chờ user trả lời
- `this._currentChunkIdx = 0` — index chunk đang đọc (để resume)

---

### D. `index.html` + `css/style.css`

#### D.1. Toggle trong settings modal (`index.html:85-86`)

Chèn toggle mới **trước** `teach-then-quiz-toggle` (dòng 84-86):

```html
<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;cursor:pointer;">
  <input type="checkbox" id="interactive-teach-toggle" checked style="accent-color:var(--accent);"> 🤝 Tương tác hỏi đáp khi giảng
</label>
```

Pattern giống `teach-then-quiz-toggle` (dòng 84-86).

#### D.2. Lưu setting

Lưu `ai_settings.interactiveTeach` mặc định `true` — cùng pattern `teachThenQuiz`:
- `js/ai-engine.js`: constructor đọc `saved.interactiveTeach !== undefined ? saved.interactiveTeach : true` (dòng 37 pattern).
- `js/ai-engine.js`: `saveSettings` gán + lưu vào localStorage (dòng 62-75 pattern).
- `js/ai-engine.js`: `getSettings` export field (dòng 62-75 pattern).
- `js/app.js`: `_showApiKeyModal` đọc setting vào toggle (dòng 424 pattern).
- `js/app.js`: `_setupSettingsBtn` lưu toggle vào `saveSettings` object (dòng 485 pattern).

#### D.3. CSS

- Toggle `#interactive-teach-toggle` tái sử dụng style inline như `teach-then-quiz-toggle` — không cần CSS mới.
- Không cần UI mới trong chat — tận dụng `addAIMessage` + input hiện có.

---

## 5. Không làm (YAGNI)

| # | Mục | Lý do |
|---|---|---|
| 1 | Ghi `quiz_scores` từ câu trả lời tương tác | Đây là kiểm tra nhanh trong lúc giảng, không phải quiz chính thức. Không ghi điểm. |
| 2 | Tích hợp đề tổng hợp / trang yếu | Không liên quan — quiz/ exam là Plan A/C. |
| 3 | Timeout bắt buộc trả lời | Chờ vô hạn, ⏹ để bỏ qua. Không ép thời gian. |
| 4 | Cho user hỏi chat thường khi đang chờ | Khi `_awaitingAnswer === true`, chỉ nhận A-D. Chat thường bị chặn. |
| 5 | Seek/rate-change giữa chunk khi có câu hỏi | Seek bar disabled; play/pause/stop vẫn hoạt động. |
| 6 | Đổi cache key/format cũ | Cache key giữ nguyên; entry cũ thiếu field → fallback single utterance an toàn. |
| 7 | Đổi `server.py` | Không liên quan. |
| 8 | Dependency mới | Không cần. |
| 9 | Đổi luồng giảng khi KHÔNG có câu hỏi | Hành vi cũ giữ nguyên 100% — `_teachCurrentPage` chỉ đi nhánh mới khi có `interactive_questions`. |

---

## 6. Tác động file

| File | Thay đổi |
|---|---|
| `js/ai-engine.js` | Thêm 2 field optional vào JSON response prompt (voice_chunks + interactive_questions). Thêm 2 parser private `_extractVoiceChunks`, `_extractInteractiveQuestions`. Thêm `interactiveTeach` setting (constructor, saveSettings, getSettings — 4 điểm chèn). `teachPage` return object thêm 2 field. `askQuestion` KHÔNG đổi. |
| `js/tts-engine.js` | Thêm method `speakSequence(chunks, callbacks)` (~40 dòng). Thêm state `_sequenceActive`, `_currentChunkIndex`. `stop()` reset 2 flag này. |
| `js/app.js` | Constructor: thêm 5 state vars. `_teachCurrentPage`: 2 nhánh (có/không interactive). Callback wiring cho `speakSequence` (onChunkStart/onChunkEnd/onEnd). `_handleChatMessage`: gate `_awaitingAnswer`. Method mới `_handleInteractiveAnswer` (~25 dòng). `_navigatePage`: reset interactive state. Stop handler: reset interactive state. `_updateVoiceStatus`: case `'done'` khi đang chờ → text "Đang chờ bạn trả lời...". Settings wiring (`_showApiKeyModal` + `_setupSettingsBtn`): thêm `interactiveTeach`. |
| `js/chat.js` | Thêm method `switchTab(name)` (~15 dòng, pattern QuizManager.switchTab — ẩn/hiện chat area + quiz area + flash area, toggle active class trên tabs). |
| `index.html` | Thêm toggle `#interactive-teach-toggle` trước `#teach-then-quiz-toggle` trong settings modal (dòng 84). |
| `css/style.css` | Không cần CSS mới — toggle dùng inline style, chat dùng UI hiện có. |
| `tests/` | (Chưa viết code — kế hoạch test): `tests/interactive-parse.test.mjs` (unit test `_extractVoiceChunks`, `_extractInteractiveQuestions` — valid JSON, missing field, wrong shape, empty array, after_chunk out of range). `tests/qa-interactive-teach.mjs` (QA Playwright: mock Gemini response có voice_chunks + 2 interactive_questions, verify câu hỏi hiện trong chat sau chunk 0, trả lời đúng → xác nhận ✅, câu hỏi 2 hiện sau chunk 1, trả lời sai → giải thích + đáp án đúng, verify giảng tiếp tục hết slide, verify toggle off → không hỏi). |
| `README.md` | Thêm 1 bullet: `🤝 **Tương tác hỏi đáp khi giảng** — AI chủ động đặt câu hỏi trắc nghiệm giữa bài giảng, người học trả lời trong chat, AI xác nhận và giải thích ngay.` |

---

## 7. Rủi ro & lưu ý

- **SpeechSynthesis quirk (browser)**: Chrome/V8 bỏ `onEnd` khi gọi `speak()` liên tiếp quá nhanh. `speakSequence` phải chèn `await sleep(150ms)` giữa các chunk. Test trên Chrome + Edge.
- **`_sequenceActive` flag**: Cần reset sạch khi `stop()`, khi chuyển trang (`_navigatePage`), khi bắt đầu dạy trang mới. Thiếu reset → sequence cũ "rò rỉ" sang trang mới.
- **`_awaitingAnswer` reset khi đổi trang**: `_navigatePage` (dòng 670) phải reset `_awaitingAnswer`, `_questions`, `_qIdx`, `_chunks` — nếu không, user đang chờ trả lời mà chuyển trang → state dơ.
- **Cache entry cũ thiếu field**: Fallback an toàn đã nêu trong thiết kế — entry cũ không có `voice_chunks`/`interactive_questions` → tạo single chunk từ `voice_text`, không tương tác.
- **`after_chunk` out of range**: `_extractInteractiveQuestions` validate `after_chunk <= voice_chunks.length - 2` (không thể hỏi sau chunk cuối vì không còn gì để giảng tiếp).
- **Title slide**: Prompt yêu cầu AI không hỏi trên title slide. Thêm guard: nếu `isTitleSlide === true` → bỏ qua `interactive_questions` ngay cả khi AI trả về (phòng thủ).
- **QA pattern**: Test Playwright theo pattern `qa-quiz-count.mjs` + `qa-weak-review.mjs`: mock Gemini qua `page.route`, `addInitScript` cho `ai_settings`, click bằng `page.evaluate` cho element ẩn, filter console errors với `SKIP_ERRS`.
- **TTS lồng nhau**: Khi đọc câu hỏi (trong lúc `speakSequence` đang tạm dừng), cần cơ chế rõ ràng: tạm dừng sequence → đọc câu hỏi qua `speak()` riêng → sau khi `onEnd` của câu hỏi, set `_awaitingAnswer = true`. User trả lời xong → đọc xác nhận qua `speak()` riêng → resume `speakSequence` từ chunk i+1.
- **Không conflict với auto-read**: Auto-read chỉ advance với title slide (dòng 960-966). Title slide KHÔNG có câu hỏi → không xung đột.
- **Không conflict với `teachThenQuiz`**: Nút "Kiểm tra ngay" hiện sau `onEnd` (dòng 1054-1056). Cả hai feature cùng hoạt động: tương tác trong lúc giảng + đề xuất quiz sau khi giảng xong.
