---
slug: scholarvoice-memory-upgrade
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/scholarvoice-memory-upgrade.md
plan_sha256: null
review_round_id: round-1
pending-action: review .omo/plans/scholarvoice-memory-upgrade.md
review:
  momus:
    status: pending
    workspace_root: /home/hungdo/tailieuhaui/tool dạy học
    target: .omo/plans/scholarvoice-memory-upgrade.md
    round_id: round-1
    plan_sha256: null
    launch_id: null
    session: null
    result: null
  independent:
    status: pending
    workspace_root: /home/hungdo/tailieuhaui/tool dạy học
    target: .omo/plans/scholarvoice-memory-upgrade.md
    round_id: round-1
    plan_sha256: null
    launch_id: null
    session: null
    result: null
approach: Add conversational memory via chat history in AIEngine, inject into prompts, remove , fix 3 bugs, polish UX. All client-side, no new deps, tests-after.
---

# Draft: scholarvoice-memory-upgrade

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

| C1 | Chat History Storage — persist multi-turn Q&A in memory + localStorage, clear on PDF change, survive refresh | active | `js/ai-engine.js:39`, `js/chat.js` |
| C2 | Context-Aware AI Prompts — inject full chat history + docContext into each askQuestion API call | active | `js/ai-engine.js:239-283` |
| C3 | Bug Fixes & Cleanup — remove  entirely, dead cf* references, cache segment data loss | active | `js/ai-engine.js:306,409-495`, `js/app.js:318-320`, `index.html:63-72`, `server.py:45-87` |
| C4 | Chat UX — clear button, context indicator, scroll behavior, loading polish | active | `js/chat.js`, `index.html:267-280` |
| C5 | Robustness — token limit handling, error recovery, retry, edge cases | active | `js/ai-engine.js`, `js/app.js` |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| History length | Last 20 turns kept; older summarized into a compact context block | Industry standard for educational chat; prevents token overflow | Yes — adjust `MAX_HISTORY_TURNS` constant |
| History persistence | localStorage + in-memory; cleared on PDF change; restored on refresh | User chose this option; localStorage is cheap and universal | Yes — can switch to sessionStorage or in-memory only |
| Token overflow | When estimated prompt tokens > 60% of model limit, summarize oldest 5 turns into one compressed block | Safe margin for response tokens; common practice | Yes — adjust threshold constant |
| System prompt for chat | Reuse existing system prompt with added history injection | Minimal change to existing patterns | Yes |
| Test framework | Manual QA checklist + in-browser console verification | No test framework in project; tests-after approach chosen by user | Can add Vitest/Jest later |
| Dead code removal | Remove cf* references entirely (Cloudflare was never implemented) | No evidence of Cloudflare provider in AIEngine | Yes — add back if needed later |

## Findings (cited - path:lines)

### Task 1: Remove  entirely (per user decision)
- **Files:** `js/ai-engine.js:306,409-495`, `js/app.js`, `index.html:63-72`, `server.py:45-87`
- **Scope:** Remove  provider option, its API method `_callAPI`, settings fields, DOM elements, and server proxy endpoint.
- **Impact:** Simplifies codebase; 3 remaining providers: Gemini, NVIDIA, Ollama.

### Bug 2: Dead references to Cloudflare provider
- **File:** `js/app.js:318-320`, `js/app.js:384-389`
- **Evidence:** `cfAccountId`, `cfApiToken`, `cfModel` are read from DOM and saved to settings but `AIEngine` has no corresponding properties or API call method.
- **Impact:** Settings save writes undefined values; no functional harm but code cruft.

### Bug 3: Cache segment data lost on export/import
- **File:** `js/app.js:1023-1100`
- **Evidence:** `_exportCache()` saves only `voiceText` strings (line 1039), but `AIEngine.pageCache` stores `{voice_text, segments}` objects (ai-engine.js:230-232). Segment data (region highlighting) is lost.
- **Impact:** Imported cache won't highlight page regions during playback.

### Feature Gap: No chat history in askQuestion
- **File:** `js/ai-engine.js:239-283`
- **Evidence:** `askQuestion()` builds a fresh prompt with only current page content — no conversation history. Each question is isolated.
- **Impact:** AI "forgets" previous Q&A; cannot have follow-up questions.

## Decisions (with rationale)

1. **History stored in AIEngine, not ChatManager** — Rationale: AIEngine already owns `docContext`; co-locating chat history simplifies prompt construction. ChatManager stays UI-only.
2. **History prompt injection uses a compact format** — Each turn: `User: <question>\nAI: <voice_text summary (first 150 chars)>`. Saves tokens vs. full display_text.
3. ** removed entirely** — User decision. Remove from provider dropdown, settings fields, `_callAPI()`, server proxy endpoint, and -specific DOM elements.
4. **cf* cleanup: remove from app.js settings save/load; remove from DOM elements** — No Cloudflare provider exists; dead code removal.
5. **Cache export: include segments array** — Extend export format v2 with segments; backward-compatible import.

## Scope IN

1. Multi-turn chat history with localStorage persistence
2. History injection into AI prompts (incl. docContext from taught pages)
3. Smart summarization of old turns when approaching token limits
4. Clear chat button in UI
5. Context indicator showing "remembering N previous messages"
6. **Remove  entirely** (provider option, API method, settings, DOM, server proxy)
7. Dead cf* code removal
8. Cache segment data in export/import
9. Improved error handling and loading states

## Scope OUT (Must NOT have)

- New AI providers (only Gemini confirmed by user)
- Voice chat / speech-to-text input
- Multi-PDF simultaneous chat
- Server-side changes (all client-side)
- New npm dependencies
- UI redesign or theme changes
- Chat sharing/export
- Real-time streaming responses (stays as single-response)

## Open questions

<!-- None remaining. All design forks resolved via user interview or best-practice defaults. -->

## Approval gate
status: awaiting-approval
next: write .omo/plans/scholarvoice-memory-upgrade.md after explicit "yes" from user
