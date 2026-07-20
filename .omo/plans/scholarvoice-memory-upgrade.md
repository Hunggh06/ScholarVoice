# scholarvoice-memory-upgrade - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->

**What you'll get:** ScholarVoice được nâng cấp toàn diện: (1) sửa 13 bug từ critical đến cosmetic, (2) thêm bộ nhớ hội thoại để AI nhớ toàn bộ lịch sử chat, (3) xóa , (4) cải thiện UX chat. Sau khi nâng cấp, mọi thứ chạy ổn định hơn, không crash, chat thông minh hơn.

**Why this approach:** Sửa bug critical trước (settings crash, abort không hoạt động) → sửa bug medium (prefetch, TTS đè) → thêm tính năng mới (chat memory) → polish. Thứ tự này đảm bảo không xây tính năng mới trên nền bug.

**What it will NOT do:** Không thêm AI provider mới, không voice-to-text, không multi-PDF, không UI redesign, không streaming, không thay đổi server (trừ xóa endpoint ).

**Effort:** Medium-Large (5 files, ~500 dòng thay đổi, 14 todo)
**Risk:** Low — thay đổi cục bộ, không phá vỡ kiến trúc
**Decisions to sanity-check:** Giữ 20 lượt chat, summarize khi >60% token, xóa history khi đổi PDF, fix tất cả bug trước khi thêm tính năng.

Your next move: approve to start work. Full execution detail follows below.

---

> TL;DR (machine): Medium-Large effort, Low risk — fix 13 bugs + add chat memory + remove  + UX polish, 5 files, ~500 LOC, 14 todos in 5 waves

## Scope
### Must have
**Bug fixes (13 bugs):**
1. Fix settings modal crash (`cf-*` elements → null reference) — B1
2. Remove  entirely (provider, method, settings, DOM, server) — B2
3. Fix abort not working for NVIDIA/Ollama (use `this._abortController`) — B3
4. Fix prefetch state not cleaned on style change — B4
5. Fix prefetch state not cleaned on navigation — B5
6. Add prefetch circuit breaker (stop after 3 consecutive failures) — B6
7. Fix chat TTS interrupting active voice lecture — B7
8. Debounce custom style input save (300ms instead of every keystroke) — B8
9. Update landing page text (remove  mentions) — B9
10. Fix `_formatTime` hardcoded 8s chunk assumption — B10
11. Fix `_importCache` not checking provider match — B11
12. Fix misleading `_prefetchNextPages` comment — B12
13. Remove redundant rate setter call on init — B13

**New features:**
- Chat history storage (multi-turn Q&A, localStorage, 20 turns max)
- Context injection (history + docContext into every question prompt)
- Smart summarization (auto-summarize old turns at 60% token limit)
- Clear chat button + context memory indicator
- Cache segment export/import (preserve region highlighting data)

### Must NOT have
- ❌ No new AI providers
- ❌ No voice-to-text, no multi-PDF chat
- ❌ No UI redesign beyond specified elements
- ❌ No new npm dependencies
- ❌ No server.py changes beyond  removal
- ❌ No streaming, no TTS engine changes
- ❌ No export/import chat history (localStorage only)

## Verification strategy
- Test decision: tests-after + manual checklist
- Framework: In-browser console verification + visual inspection
- **Automated (console + DOM state):** grep assertions, console.error absence, DOM element existence, localStorage key checks, function return value verification via browser console
- **Manual (audio + real API):** TTS playback behavior, provider switching with real API keys, full voice lecture flow — scenarios marked "Manual" in QA must be verified interactively
- Evidence: `.omo/evidence/scholarvoice-memory-upgrade/`

## Execution strategy
### Parallel execution waves

**Wave 1 — Critical Fixes + Cleanup:** Todo 1-4 (B1, B2 HTML, B3, B9) — can parallelize
**Wave 2 — Core Cleanup:** Todo 5-6 (B2 JS/server, B8, B13) — depends on Wave 1
**Wave 3 — Prefetch Fixes:** Todo 7-8 (B4, B5, B6, B12) — independent
**Wave 4 — Chat Memory:** Todo 9-11 (chat history, context injection, summarization) — sequential
**Wave 5 — UX + Polish:** Todo 12-14 (B7, B10, B11, clear button, indicator, final QA) — depends on Wave 4

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | — | 5 | 2, 3, 4 |
| 2 | — | 5 | 1, 3, 4 |
| 3 | — | — | 1, 2, 4 |
| 4 | — | — | 1, 2, 3 |
| 5 | 1, 2 | 6 | — |
| 6 | — | — | 5 |
| 7 | 6 | — | 8 |
| 8 | — | — | 7 |
| 9 | 5, 6, 7, 8 | 10 | — |
| 10 | 9 | 11 | — |
| 11 | 10 | 12 | — |
| 12 | 9 | 14 | 13 |
| 13 | — | 14 | 12 |
| 14 | 12, 13 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.

- [ ] 1. Fix settings modal crash (cf-* dead references) — B1
  What to do: In `js/app.js`, remove lines 318-320 (`cf-account-id`, `cf-api-token`, `cf-model` DOM reads). These elements don't exist in `index.html`, causing TypeError crash when `_showApiKeyModal()` is called. Also remove lines 384-389 (cf-* fields from save handler). Remove any cf-* from getSettings/saveSettings in ai-engine.js if present.
  Must NOT do: Do NOT remove any existing provider settings. Do NOT change the modal structure.
  Parallelization: Wave 1 | Blocked by: — | Blocks: 5 | Can parallelize with: 2, 3, 4
  References: `js/app.js:307-329` (_showApiKeyModal), `js/app.js:375-405` (save handler), `index.html` (verify no cf-* elements exist)
  Acceptance criteria: Settings modal opens without error. Save button works. No cf-* references anywhere in project (grep confirms zero matches).
  QA scenarios:
    - Happy: Click ⚙️ Cài đặt → modal opens, provider dropdown shows 4 options. Click Lưu → closes, toast appears.
    - Failure: Run `grep -r "cf-" js/ app.js` → zero results.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-1-settings-crash-fix.txt`
  Commit: Y | fix(app): remove dead cf-* references causing settings modal crash

- [ ] 2. Remove  from index.html and update landing page — B2 (HTML part), B9
  What to do: In `index.html`: remove  `<option>` from provider select (line 37). Remove `#-settings` div (lines 63-72). Update landing page text: line 120 "Hỗ trợ Gemini • NVIDIA • Ollama", line 133 "chọn nguồn AI (Gemini, NVIDIA...)", line 162 remove "hoặc ".
  Must NOT do: Do NOT change other provider options. Keep Gemini, NVIDIA, Ollama intact.
  Parallelization: Wave 1 | Blocked by: — | Blocks: 5 | Can parallelize with: 1, 3, 4
  References: `index.html:34-39` (provider select), `index.html:63-72` ( div), `index.html:120` (hero-models), `index.html:133` (step-card text), `index.html:162` (warning-card text)
  Acceptance criteria: `grep -i "" index.html` returns zero matches. Landing page shows 3 providers.
  QA scenarios:
    - Happy: Open app → landing page says "Hỗ trợ Gemini • NVIDIA • Ollama". Settings modal has 3 options (no ).
    - Failure: No JS errors on page load.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-2-html--removal.txt`
  Commit: Y | refactor(html): remove  UI and update landing page text

- [ ] 3. Fix abort not working for NVIDIA and Ollama — B3
  What to do: In `js/ai-engine.js`, replace local `const abortController = new AbortController()` in `_callNvidiaAPI` (line 506) and `_callOllamaAPI` (line 589) with `this._abortController`. Before creating a new one, call `this.abort()` first. Use `this._abortController.signal` in fetch calls. Match the pattern already used in `_callGeminiAPI` (lines 662-663).
  Must NOT do: Do NOT change the Gemini abort pattern (it's correct). Do NOT change the fetch logic otherwise.
  Parallelization: Wave 1 | Blocked by: — | Blocks: — | Can parallelize with: 1, 2, 4
  References: `js/ai-engine.js:127-132` (abort method), `js/ai-engine.js:501-582` (_callNvidiaAPI), `js/ai-engine.js:588-647` (_callOllamaAPI), `js/ai-engine.js:661-663` (Gemini pattern to copy)
  Acceptance criteria: Calling `aiEngine.abort()` while NVIDIA API is in-flight → fetch is aborted → error "Đã hủy yêu cầu." is thrown. Same for Ollama.
  QA scenarios:
    - Happy: Start NVIDIA teach call, immediately click stop → API call cancelled, no network request hanging.
    - Happy: Start Ollama teach call, navigate to next page → API call cancelled.
    - Failure: Abort then immediately start new call → no "AbortError" leaking to new call.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-3-abort-fix.txt`
  Commit: Y | fix(ai-engine): use shared abortController for NVIDIA and Ollama

- [ ] 4. Remove  from ai-engine.js, app.js, and server.py — B2 (JS + server part)
  What to do: In `ai-engine.js`: remove `Key`, `Model`, `Vision` from constructor (lines 28-31), `saveSettings()` (lines 56-58), `getSettings()` (lines 97-99), `hasVision()` (line 109), `isConfigured` (line 117), `_getModelName()` (line 332). Remove entire `_callAPI()` method (lines 409-495). Fix `_callAPI()` routing (line 305-306: remove empty  branch). In `app.js`: remove  reads from `_showApiKeyModal()` (lines 321-323) and save handler (lines 388-390). Remove  line from `_toggleProviderUI()` (line 338) and labels object (line 401). In `server.py`: remove  routing (lines 31-32) and `_proxy_()` method (lines 45-87). **Critical: add migration** — in `AIEngine` constructor, after loading `saved`: if `saved.provider === ''`, reset to `provider = 'gemini'` and show a toast " đã bị xóa, đã chuyển về Gemini". Also in `saveSettings()`, strip any lingering `Key/Model/Vision` keys from the saved localStorage object when writing.
  Must NOT do: Do NOT touch Gemini, NVIDIA, or Ollama code. Do NOT change `_callAPI` signature.
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 6 | Can parallelize with: —
  References: `js/ai-engine.js:28-31,56-58,97-99,109,117,305-306,332,409-495`, `js/app.js:321-323,338,388-390,401`, `server.py:31-32,45-87`
  Acceptance criteria: `grep -ri "" js/ai-engine.js js/app.js server.py` returns zero matches.
  QA scenarios:
    - Happy: Settings modal shows 3 providers (Gemini, NVIDIA, Ollama). Existing Gemini key still works.
    - Happy: Switch to NVIDIA → teach page → works. Switch to Ollama → works.
    - Failure: No JS console errors. Server starts without error (`python server.py`).
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-4--code-removal.txt`
  Commit: Y | refactor: remove  provider entirely

- [ ] 5. Fix custom style debounce and cleanup ai-engine settings — B8, B13
  What to do: In `js/app.js:158-164`, replace `input` event with debounced save: use `let _customStyleTimer` in App class, `clearTimeout` on each input, `setTimeout(300ms)` before calling `saveSettings()`. In `js/app.js:232`, remove the line `this.ttsEngine.rate = parseFloat(savedRate)` — the TTSEngine constructor already loads rate from localStorage at line 18 of tts-engine.js and the slider value is set separately at line 230. Also in `js/ai-engine.js:79-83`, update the comment and logic: `clearCache()` is called externally for style changes, so the provider-only check is intentional but should be documented.
  Must NOT do: Do NOT change TTSEngine constructor. Do NOT change the `rate` getter/setter.
  Parallelization: Wave 2 | Blocked by: — | Blocks: — | Can parallelize with: —
  References: `js/app.js:158-164` (custom style input), `js/app.js:229-232` (speed control init), `js/tts-engine.js:18` (constructor rate load)
  Acceptance criteria:
    - Typing in custom style box: localStorage NOT updated on every keystroke, only after 300ms pause.
    - Speed slider still shows correct saved value on page load.
  QA scenarios:
    - Happy: Type "nói chậm như thầy giáo" fast → only 1 localStorage write after stopping.
    - Happy: Refresh page → custom style and speed restored correctly.
    - Failure: Rapid typing → no performance lag, no console errors.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-5-debounce-cleanup.txt`
  Commit: Y | perf(app): debounce custom style save and remove redundant rate setter

- [ ] 6. Add `_cancelPrefetch()` helper and wire into style change + clear cache — B4, B5 (prep)
  What to do: In `js/app.js`, add method `_cancelPrefetch()` that: clears `_prefetchTimer`, sets `_prefetchRunning = false`, clears `_pendingPages`, calls `this.aiEngine.abort()`. Call it from: (a) `_setupTeachingStyle` style button click (before `clearCache()`), (b) `_navigatePage` (before existing abort), (c) `_setupClearCacheBtn` (replace the manual 4-line cleanup at lines 349-352). Keep existing `clearCache()` call in teaching style — the `_cancelPrefetch` only handles prefetch state.
  Must NOT do: Do NOT call `clearCache()` inside `_cancelPrefetch()` — they are separate concerns. Do NOT change navigation logic.
  Parallelization: Wave 2 | Blocked by: 5 | Blocks: — | Can parallelize with: 5
  References: `js/app.js:149-155` (style change), `js/app.js:573-597` (navigatePage), `js/app.js:342-363` (clearCacheBtn — has manual 4-line cleanup)
  Acceptance criteria:
    - After style change: `_prefetchTimer` is null, `_prefetchRunning` is false, `_pendingPages` is empty, in-flight API aborted.
    - After navigation: same state.
    - Clear cache button still works with 1-line `_cancelPrefetch()` call instead of 4 manual lines.
  QA scenarios:
    - Happy: Teach page 3 with "Trung bình", prefetch starts, immediately change to "Chi tiết" → old prefetch cancelled, page 3 re-teaches with new style.
    - Happy: Navigate while prefetch running → prefetch cancelled, no stale requests.
    - Failure: Rapid style changes → no race conditions, no duplicate timers.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-6-cancel-prefetch.txt`
  Commit: Y | fix(app): add _cancelPrefetch helper and clean prefetch state on style/nav change

- [ ] 7. Add prefetch circuit breaker + fix misleading comment — B6, B12
  What to do: In `js/app.js`, add `this._prefetchFailures = 0` to constructor. In `_prefetchNextPages()`: in the `try` block after successful cache (after line 701), add `this._prefetchFailures = 0`. In the `catch` block (after line 704): increment `this._prefetchFailures++`. If `>= 3`, log warning and set `this._prefetchRunning = false` and return (stop retrying). Update comment at line 679-680 from "Dừng khi gặp trang đã có cache hoặc hết file" to "Dừng sau 1 trang mỗi lần gọi, tiếp tục tự động qua _autoPrefetch". Reset `_prefetchFailures = 0` in `_cancelPrefetch()` (from todo 6).
  Must NOT do: Do NOT change the "one page at a time" prefetch design. Do NOT affect manual teaching.
  Parallelization: Wave 3 | Blocked by: — | Blocks: — | Can parallelize with: 8
  References: `js/app.js:678-710` (_prefetchNextPages), `js/app.js:21-23` (constructor for new counter)
  Acceptance criteria:
    - 3 consecutive prefetch failures → prefetch stops, console shows "[Prefetch] Dừng sau 3 lỗi liên tiếp"
    - Manual teach still works after prefetch stopped (unaffected).
    - Successful prefetch resets counter.
  QA scenarios:
    - Happy: Bad API key → prefetch tries 3 times, then stops. No infinite retry loop.
    - Happy: Fix API key, manually teach page → prefetch resumes normally.
    - Failure: Network error on 2 pages, 3rd succeeds → counter reset to 0.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-7-prefetch-circuit-breaker.txt`
  Commit: Y | fix(app): add circuit breaker to prefetch (stop after 3 failures)

- [ ] 8. Fix chat TTS interrupting voice lecture — B7
  What to do: In `js/app.js:_handleChatMessage()` (line 931), make the `this.ttsEngine.stop()` call conditional: only stop TTS if the current voice is NOT a page lecture. To track this, add `this._isTeaching = false` flag in App class, set to true in `_teachCurrentPage()` when TTS starts, set to false on TTS end/stop. Then at line 931, use: `if (!this._isTeaching) this.ttsEngine.stop();`. At line 947, the existing check is not needed if TTS wasn't stopped — but add a guard anyway: `if (result.voice_text && !this.ttsEngine.isSpeaking) { this.ttsEngine.speak(...); }`. This ensures: (a) lecture voice is never interrupted by chat, (b) chat response still speaks if no lecture is active, (c) if lecture just ended naturally, chat speaks.
  Must NOT do: Do NOT remove the TTS stop entirely. Do NOT change the chat flow otherwise.
  Parallelization: Wave 3 | Blocked by: — | Blocks: — | Can parallelize with: 7
  References: `js/app.js:931` (ttsEngine.stop before API call), `js/app.js:947-950` (speak chat response), `js/app.js:613-676` (_teachCurrentPage for _isTeaching flag), `js/tts-engine.js:231` (isSpeaking getter)
  Acceptance criteria:
    - While voice is speaking a page lecture: ask question in chat → lecture continues uninterrupted, chat answer shown as text only.
    - While voice is idle: ask question → AI answers with voice (existing behavior).
    - Lecture just finished naturally → next chat question speaks answer normally.
  QA scenarios:
    - Happy: Teach page 3 (speaking), ask "công thức này là gì?" → chat shows answer, voice continues speaking page 3. No interruption.
    - Happy: No voice playing, ask question → voice speaks answer (normal behavior).
    - Failure: TTS state tracked correctly — `_isTeaching` resets on TTS end/error/stop. No stuck "teaching" state.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-8-chat-tts-fix.txt`
  Commit: Y | fix(app): prevent chat TTS from interrupting active voice lecture

- [ ] 9. Add chat history storage to AIEngine
  What to do: In `js/ai-engine.js`, add `this.chatHistory = []` in constructor. Add methods: `addChatTurn(role, text)` — stores `{role, text, pageNum, timestamp}`, trims to 20 turns (shift oldest). `getChatHistory()` — returns full array. `clearChatHistory()` — empties array and removes localStorage key. Add `_saveChatHistory()` / `_loadChatHistory()` for localStorage with key `chat_history_<pdfName>`. **Wrap `_saveChatHistory()` in try/catch for QuotaExceededError** — on quota error, show toast "Bộ nhớ đầy, không lưu được lịch sử chat" and continue with in-memory only. Add `setPdfName(name)` to bind history. In `clearCache()`, also call `clearChatHistory()`. **Clear chat history on provider switch:** in `saveSettings()`, when `oldProvider !== this.provider` (line 80), also call `clearChatHistory()`. In `js/app.js:_loadPDFFile()`, call `aiEngine.setPdfName(file.name)` + `_loadChatHistory()`.
  Must NOT do: Do NOT store history in ChatManager. Do NOT exceed 20 turns. Do NOT mix with docContext.
  Parallelization: Wave 4 | Blocked by: 5, 6, 7, 8 | Blocks: 10 | Can parallelize with: —
  References: `js/ai-engine.js:6-42` (constructor), `js/ai-engine.js:39` (docContext pattern), `js/ai-engine.js:400-403` (clearCache), `js/app.js:455-486` (_loadPDFFile)
  Acceptance criteria:
    - `addChatTurn('user', 'hello')` adds entry. After 21 adds, array length = 20.
    - `clearChatHistory()` empties array + clears localStorage.
    - Refresh page → history restored from localStorage.
    - Provider switch (Gemini → NVIDIA) → chat history cleared, docContext cleared.
    - localStorage quota exceeded → graceful toast, history in-memory only, app continues.
  QA scenarios:
    - Happy: 3 Q&A turns → `getChatHistory()` returns 6 entries with correct roles.
    - Happy: Switch PDF → old history cleared, new history starts fresh.
    - Happy: Switch provider → chat history cleared automatically.
    - Failure: localStorage corrupted → returns empty array, no crash.
    - Failure: localStorage full → toast warning, history in-memory only, no crash on subsequent saves.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-9-chat-history.txt`
  Commit: Y | feat(ai-engine): add multi-turn chat history with localStorage persistence

- [ ] 10. Inject chat history into askQuestion prompts
  What to do: In `js/ai-engine.js:239-283`, modify `askQuestion()` to build compact history context from `this.chatHistory`. Format: `Trước đó - Người dùng: <question>\nTrước đó - AI: <first 150 chars of voice_text>`. Also include `this.docContext` when available (via `_buildContext`). Update system prompt to tell AI to reference previous conversation. After response, call `addChatTurn('user', question)` and `addChatTurn('ai', result.voice_text)`.
  Must NOT do: Do NOT change JSON response format. Do NOT exceed ~6000 chars in total prompt.
  Parallelization: Wave 4 | Blocked by: 9 | Blocks: 11 | Can parallelize with: —
  References: `js/ai-engine.js:239-283` (askQuestion), `js/ai-engine.js:363-373` (_buildContext pattern), `js/ai-engine.js:350-358` (_updateContext)
  Acceptance criteria:
    - 0 history → prompt identical to current (plus empty history block).
    - 3 previous Q&A → prompt contains "Trước đó - Người dùng:" ×3 and "Trước đó - AI:" ×3.
    - After askQuestion, chatHistory has +2 entries.
  QA scenarios:
    - Happy: Ask "trang này nói về gì?", then "giải thích kỹ hơn" → AI references previous answer.
    - Happy: Page with docContext from taught pages → prompt includes prior page summaries.
    - Failure: Empty history → no "undefined" in prompt, normal behavior.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-10-prompt-injection.txt`
  Commit: Y | feat(ai-engine): inject chat history and docContext into question prompts

- [ ] 11. Add smart history summarization
  What to do: In `js/ai-engine.js`, add `_summarizeIfNeeded()` method. Before building prompt in `askQuestion()`, estimate total prompt length. If > 6000 chars (~4000 tokens, assuming ~1.5 chars/token for Vietnamese; safe margin under Gemini Flash 10K limit): take oldest 5 turns, call AI with a compact "summarize this conversation" prompt, replace those 5 turns with one summary entry: `Tóm tắt đoạn trước: <summary>`. The summarization fires BEFORE the user's question, adding latency but keeping context. If summarization API fails, fall back to truncating oldest turns silently.
  Must NOT do: Do NOT summarize turns less than 2 turns old. Do NOT trigger summarization if prompt < 6000 chars. Do NOT change the main askQuestion flow structure.
  Parallelization: Wave 4 | Blocked by: 10 | Blocks: 12 | Can parallelize with: —
  References: `js/ai-engine.js:239-283` (askQuestion), `js/ai-engine.js:337-345` (_getMaxTokens)
  Acceptance criteria:
    - Short conversation (3 turns) → no summarization triggered.
    - 20 long turns → oldest 5 summarized into 1 compact entry before sending question.
    - Summarization failure → old turns silently truncated, no error to user.
  QA scenarios:
    - Happy: 15 long Q&A turns, ask next → prompt has <Tóm tắt> block + recent 10 turns.
    - Happy: After summarization, new question still receives coherent context-aware answer.
    - Failure: Summarization API error → fallback truncation, user question still answered.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-11-summarization.txt`
  Commit: Y | feat(ai-engine): auto-summarize old chat turns at token limit

- [ ] 12. Add clear chat button + context indicator to UI
  What to do: In `index.html:274-279`, add a small `<span id="chat-context-indicator">` showing "🧠 0 tin nhắn" and a `<button id="chat-clear-btn">🗑️</button>` next to the chat input. In `js/chat.js`, add methods: `updateContextIndicator(count)` — updates the span text. Wire clear button click to: clear chat DOM messages, restore welcome message, call `aiEngine.clearChatHistory()`, update indicator. In `js/app.js:_handleChatMessage()`, after each successful response, call `chatManager.updateContextIndicator(aiEngine.chatHistory.length / 2)`. Hide clear button when history is empty.
  Must NOT do: Do NOT add clear button to header toolbar — keep it in chat area. Do NOT change chat input layout significantly.
  Parallelization: Wave 5 | Blocked by: 9 | Blocks: 14 | Can parallelize with: 13
  References: `index.html:274-279` (chat-input-area), `js/chat.js:5-14` (constructor), `js/app.js:912-966` (chat handling)
  Acceptance criteria:
    - Initial state: indicator shows "🧠 0 tin nhắn", clear button hidden.
    - After 3 Q&A: indicator shows "🧠 Đang nhớ 3 tin nhắn", clear button visible.
    - Click clear: all chat messages gone, welcome restored, indicator back to 0.
  QA scenarios:
    - Happy: Ask 3 questions → indicator updates each time → click clear → fresh start.
    - Happy: Clear during API loading → button disabled, no race condition.
    - Failure: Clear with empty history → no-op, no error.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-12-clear-indicator.txt`
  Commit: Y | feat(chat): add clear history button and context memory indicator

- [ ] 13. Fix _formatTime, importCache provider check, and remaining low bugs — B10, B11
  What to do: (a) `app.js:129-135`: Replace hardcoded `* 8` seconds with a reasonable estimate. Use `Math.max(1, Math.ceil(totalChars / (15 * this.ttsEngine.rate)))` — ~15 chars/sec at 1.0x speed, adjusted by TTS rate (2.0x → half the time). (b) `app.js:1063-1101`: In `_importCache()`, add provider check: if `data.provider && data.provider !== this.aiEngine.provider`, show toast "Cache từ provider khác — không áp dụng" and skip import. (c) **Add cache segment round-trip verification:** add acceptance criterion that exported + re-imported cache retains `segments` array with `regionVert` data (verify via `_getPageCache` returns object with valid segments).
  Must NOT do: Do NOT change the seek bar UI. Do NOT break existing cache files.
  Parallelization: Wave 5 | Blocked by: — | Blocks: 14 | Can parallelize with: 12
  References: `js/app.js:129-135` (_formatTime), `js/app.js:1063-1101` (_importCache), `js/app.js:1103-1128` (_autoRestoreCache — already has provider check as reference pattern), `js/ai-engine.js:230-233` (cache entry structure with segments)
  Acceptance criteria:
    - Seek bar duration shows reasonable time based on text length × TTS rate.
    - Import Gemini cache while using NVIDIA → toast warning, no cache loaded.
    - Import matching provider cache → works as before.
    - Export cache, clear, re-import → `_getPageCache(n)` returns object with `segments` array (if original had segments).
  QA scenarios:
    - Happy: Teach short page → seek bar shows ~30s. Long page → shows ~2min. At 2.0x speed → times halved.
    - Happy: Import cache with wrong provider → toast "Cache từ provider khác", no crash.
    - Happy: Export cache with segments → import → region highlighting works during playback.
    - Failure: `_formatTime` with 0 text → shows 00:00, no NaN.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-13-low-bug-fixes.txt`
  Commit: Y | fix(app): improve seek time estimate, add provider check and segment round-trip to cache import

- [ ] 14. Final integration, end-to-end QA, and remaining cleanup
  What to do: Verify ALL 13 bugs are fixed and ALL new features work together. Test full flow: open app → settings modal opens (B1 fixed) → configure Gemini → upload PDF → teach page 3 → change style while prefetch running (B4, B6 fixed) → navigate back (B5 fixed) → chat asks question while voice speaking (B7 fixed) → ask follow-up question (memory works) → clear history → refresh (history restored) → load different PDF (history cleared) → switch provider to NVIDIA/Ollama (B3 abort works) → import cache from different provider (B11 guarded) → verify no  anywhere (B2 fixed). Check console: zero errors. Check localStorage: clean keys. Verify toast messages correct.
  Must NOT do: Do NOT add features. Only verify and fix any remaining integration issues.
  Parallelization: Wave 5 | Blocked by: 12, 13 | Blocks: — | Can parallelize with: —
  References: All modified files: `js/ai-engine.js`, `js/app.js`, `js/chat.js`, `index.html`, `server.py`
  Acceptance criteria:
    - Full flow test passes with zero console errors.
    - All 13 bugs confirmed fixed.
    - All 3 providers (Gemini, NVIDIA, Ollama) functional.
    - Chat memory persisted across refresh, cleared on PDF change.
  QA scenarios:
    - Happy (full): Load PDF → teach → style change → prefetch → navigate → chat with memory → clear → refresh → restore → new PDF → all smooth.
    - Happy (providers): Gemini teach → NVIDIA teach → Ollama teach → all work. Abort works for all.
    - Failure: API error mid-chat → error in chat, UI re-enabled, history preserved.
    - Failure: localStorage full → graceful toast, app continues with in-memory only.
    Evidence: `.omo/evidence/scholarvoice-memory-upgrade/task-14-final-qa.txt`
  Commit: N | (final QA — only commit if fixes needed)

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE.

- [ ] F1. Plan compliance audit — verify all 14 todos completed, each acceptance criteria met
- [ ] F2. Code quality review — zero console errors, zero dead imports, no /cf-* residues, style consistency
- [ ] F3. Real manual QA — full user flow: open → settings → PDF → teach → style change → navigate → chat memory → clear → refresh → provider switch
- [ ] F4. Scope fidelity — confirm Must NOT have items absent, 13 bugs fixed, no scope creep

## Commit strategy
- 1 commit per todo (13 commits + optional QA fix)
- Order: Wave 1 (1-4) → Wave 2 (5-6) → Wave 3 (7-8) → Wave 4 (9-11) → Wave 5 (12-13) → QA (14 if fixes needed)
- Format: Conventional Commits

## Success criteria
1. ✅ Settings modal opens without crash
2. ✅  completely removed from all files
3. ✅ Abort works for all 3 providers (Gemini, NVIDIA, Ollama)
4. ✅ Prefetch cleanly cancelled on style change and navigation
5. ✅ Prefetch stops after 3 consecutive failures
6. ✅ Chat TTS doesn't interrupt active voice lecture
7. ✅ Custom style saves debounced (300ms)
8. ✅ Chat remembers previous Q&A across multiple turns
9. ✅ History persists across refresh, clears on PDF change
10. ✅ Old chat turns auto-summarized at token limit
11. ✅ Clear button + context indicator work correctly
12. ✅ Seek bar shows reasonable duration estimate
13. ✅ Cache import guards against wrong provider
14. ✅ Zero console errors, all providers functional
