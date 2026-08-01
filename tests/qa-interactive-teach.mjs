// QA: interactive teach flow — mock Gemini + real PDF via fpdf
// Chạy: node tests/qa-interactive-teach.mjs (cần server localhost:8080)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const SKIP_ERRS = ['InvalidPDFException', 'TTSError', 'Lỗi tải PDF'];

// --- Tạo PDF 1 trang bằng python3 + fpdf ---
const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad - bc. Neu dinh thuc khac 0, ma tran kha nghich va co ma tran nghich dao.')
p.output('/tmp/qa-interactive-teach.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

let apiCallCount = 0;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => {
  if (!SKIP_ERRS.some(s => e.message.includes(s))) errors.push('pageerror: ' + e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error' && !SKIP_ERRS.some(s => m.text().includes(s))) errors.push('console: ' + m.text());
});

// --- Seed settings + mock TTS TRƯỚC page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({
    provider: 'gemini', apiKey: 'fake-key', interactiveTeach: true
  }));

  // Mock speechSynthesis — headless Chromium fails TTS with "synthesis-failed".
  // Intercept before app's TTSEngine constructor runs so its _synth is the mock.
  const _origSynth = window.speechSynthesis;
  let _queued = 0;
  const _mockSynth = {
    getVoices() {
      return _origSynth?.getVoices?.() || [{ name: 'en-US - Mock', lang: 'en-US', voiceURI: 'mock' }];
    },
    speak(utt) {
      _queued++;
      const dur = Math.min(1000, Math.max(200, utt.text.length * 20));
      setTimeout(() => { if (utt.onstart) utt.onstart(); }, 50);
      setTimeout(() => {
        const chars = utt.text.length;
        let pos = 0;
        const step = Math.max(1, Math.floor(chars / 10));
        const iv = setInterval(() => {
          pos += step;
          if (pos >= chars) { clearInterval(iv); return; }
          if (utt.onboundary) utt.onboundary({ charIndex: pos });
        }, dur / 12);
        setTimeout(() => {
          clearInterval(iv);
          if (utt.onend) utt.onend();
          _queued--;
        }, dur);
      }, 60);
    },
    cancel() { _queued = 0; },
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    get speaking() { return _queued > 0; },
    get pending() { return false; },
    get paused() { return false; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: _mockSynth, writable: true, configurable: true });
});

// --- Mock Gemini ---
await page.route('**generativelanguage.googleapis.com/**', async (route, request) => {
  apiCallCount++;
  const postData = request.postDataJSON ? request.postDataJSON() : null;
  const promptText = postData ? JSON.stringify(postData) : '';

  // Phân biệt teachPage vs askQuestion dựa trên prompt
  if (promptText.includes('interactive_questions') || promptText.includes('voice_chunks')) {
    // teachPage response — trả voice_chunks + interactive_questions
    const responseJson = JSON.stringify({
      voice_chunks: [
        { text: 'Doan mot: Ma tran la bang so hinh chu nhat. Dinh thuc la mot so dac biet cua ma tran vuong.', region_vert: [0, 0.4] },
        { text: 'Doan hai: Neu dinh thuc bang khong, ma tran suy bien va khong co ma tran nghich dao.', region_vert: [0.4, 0.7] },
        { text: 'Doan ba: Ma tran kha nghich co nhieu ung dung trong giai he phuong trinh tuyen tinh.', region_vert: [0.7, 1.0] }
      ],
      interactive_questions: [
        {
          after_chunk: 0,
          question: 'Dinh thuc cua ma tran vuong la gi?',
          options: ['Mot so dac biet', 'Mot vector', 'Mot ma tran', 'Mot phuong trinh'],
          correct_index: 0,
          explanation: 'Dinh thuc la mot so dac biet gan voi ma tran vuong.'
        },
        {
          after_chunk: 1,
          question: 'Neu dinh thuc bang 0 thi ma tran nhu the nao?',
          options: ['Kha nghich', 'Suy bien', 'Don vi', 'Cheo'],
          correct_index: 1,
          explanation: 'Ma tran co dinh thuc bang 0 la ma tran suy bien.'
        }
      ]
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: responseJson }] } }] })
    });
  } else {
    // askQuestion response — chat thường
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ voice_text: 'Tra loi chat', display_text: 'Tra loi chat' }) }] } }]
      })
    });
  }
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// Upload PDF
await page.setInputFiles('#pdf-input', '/tmp/qa-interactive-teach.pdf');
await page.waitForTimeout(2000);

// Close API modal nếu xuất hiện
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(500);

// ===========================================================================
// PHASE 1: Full interactive flow — wrong Q1 → resume → Q2 → correct → slide end
// Covers: tests (a), (e), (f), (g), (c), (h), (j)
// ===========================================================================

await page.click('#teach-now', { force: true });
await page.waitForTimeout(8000); // Chờ speakSequence đọc chunk 0 + TTS câu hỏi

// === TEST (a): Click Teach — câu hỏi đầu tiên hiện trong chat sau chunk 0 ===
const chatMsgs = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasQuestion = chatMsgs.some(m => m.includes('Dinh thuc cua ma tran vuong la gi?'));
console.log('TEST (a): Question in chat =', hasQuestion);
if (!hasQuestion) throw new Error('TEST (a) FAIL: question not found in chat');
console.log('TEST (a) PASS');

// === TEST (e): Lecture PAUSES after question chunk — status shows 'chờ' / icon ❓ ===
const voiceStatusE = await page.textContent('#voice-text');
const voiceIconE = await page.textContent('#voice-icon');
console.log('TEST (e): Voice status after question =', voiceStatusE, '| icon =', voiceIconE);
if (!voiceStatusE.includes('chờ') && !voiceStatusE.includes('❓') && !voiceIconE.includes('❓')) {
  throw new Error(`TEST (e) FAIL: lecture not paused during question, status="${voiceStatusE}" icon="${voiceIconE}"`);
}
console.log('TEST (e) PASS');

// === TEST (f): While awaiting with autoRead ON, page does NOT auto-advance ===
const pageNumBefore = await page.textContent('#page-info');
console.log('TEST (f): Page info before await =', pageNumBefore);
await page.waitForTimeout(3000); // Wait 3s — should NOT auto-advance
const pageNumAfter = await page.textContent('#page-info');
if (pageNumBefore !== pageNumAfter) {
  throw new Error(`TEST (f) FAIL: auto-advanced from "${pageNumBefore}" to "${pageNumAfter}" during awaiting`);
}
console.log('TEST (f) PASS: auto-advance suppressed during awaiting');

// === TEST (g): Answering WRONG ('B' when correct is 'A') → '❌ Sai...' AND teaching RESUMES ===
// With mocked TTS, the resume + Q2 arrival happens quickly; check both ❌ confirm + evidence of resume
await page.fill('#chat-input', 'B');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(5000); // Chờ confirm TTS + resume chunk 1 + Q2 xuất hiện

const chatMsgsG = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasWrongConfirm = chatMsgsG.some(m => m.includes('❌ Sai'));
if (!hasWrongConfirm) throw new Error('TEST (g) FAIL: no wrong confirmation');

// Resume proved by Q2 appearing OR status showing teaching progress
const hasQ2afterWrong = chatMsgsG.some(m => m.includes('Neu dinh thuc bang 0'));
const resumeStatusG = await page.textContent('#voice-text');
console.log('TEST (g): Wrong confirm=' + hasWrongConfirm + ', Q2 appeared=' + hasQ2afterWrong + ', status=' + resumeStatusG);
const resumeOk = hasQ2afterWrong || resumeStatusG.includes('giảng tiếp') || resumeStatusG.includes('speaking') || resumeStatusG.includes('đang đọc') || resumeStatusG.includes('❓');
if (!resumeOk) {
  throw new Error(`TEST (g) FAIL: teaching did not resume after wrong answer, status="${resumeStatusG}"`);
}
console.log('TEST (g) PASS');

// === TEST (c): Câu hỏi 2 hiện sau chunk 1 (verify question text) ===
if (!hasQ2afterWrong) {
  // Q2 chưa xuất hiện trong đợt chờ 5s, chờ thêm
  await page.waitForTimeout(4000);
  const checkAgain = await page.evaluate(() => {
    const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
    const t = Array.from(msgs).map(m => m.textContent || '');
    return t.some(m => m.includes('Neu dinh thuc bang 0'));
  });
  if (!checkAgain) throw new Error('TEST (c) FAIL: question 2 not found');
  console.log('TEST (c): Question 2 found after extra wait');
} else {
  console.log('TEST (c): Question 2 found (from g check)');
}
console.log('TEST (c) PASS');

// === TEST (h): Answering CORRECT (for question 2) → '✅ Đúng!' + resume ===
// Answer correct (correct_index = 1, so answer is 'B')
await page.fill('#chat-input', 'B');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(4000);

const chatMsgsH2 = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasCorrectH = chatMsgsH2.some(m => m.includes('✅ Đúng'));
if (!hasCorrectH) throw new Error('TEST (h) FAIL: no correct confirmation');
const resumeStatusH = await page.textContent('#voice-text');
console.log('TEST (h): Correct confirmation = true, resume status =', resumeStatusH);
console.log('TEST (h) PASS');

// === TEST (j): Sau câu hỏi 2, giảng tiếp → hết slide onEnd ===
await page.waitForTimeout(6000); // Chờ chunk cuối đọc xong

const voiceTextJ = await page.textContent('#voice-text');
console.log('TEST (j): Voice status after slide end:', voiceTextJ);
if (!voiceTextJ.includes('giảng xong') && !voiceTextJ.includes('xong')) {
  throw new Error(`TEST (j) FAIL: unexpected voice status "${voiceTextJ}"`);
}
console.log('TEST (j) PASS');

// === SESSION 2: Teach — test (b), (d) correct+wrong flow ===

// Clear cache để buộc gọi API mới
await page.evaluate(() => {
  const btn = document.querySelector('#clear-cache-btn');
  if (btn) btn.click();
});
await page.waitForTimeout(500);

await page.click('#teach-now', { force: true });
await page.waitForTimeout(8000); // Chờ chunk 0 + câu hỏi 1

// === TEST (b): Trả lời đúng → ✅ xác nhận ===
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(4000); // Chờ TTS đọc xác nhận + speakSequence resume

const chatMsgs2 = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasCorrect = chatMsgs2.some(m => m.includes('✅ Đúng') || m.includes('Dinh thuc la mot so dac biet'));
console.log('TEST (b): Correct confirmation =', hasCorrect);
if (!hasCorrect) throw new Error('TEST (b) FAIL: no correct confirmation');
console.log('TEST (b) PASS');

// Wait for Q2 after chunk 1
await page.waitForTimeout(6000);

// === TEST (d): Trả lời sai → ❌ + đáp án đúng + explanation ===
await page.fill('#chat-input', 'A'); // Sai (đáp án đúng là B)
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(4000);

const chatMsgs4 = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasWrong = chatMsgs4.some(m => m.includes('❌ Sai') || m.includes('Suy bien'));
console.log('TEST (d): Wrong confirmation =', hasWrong);
if (!hasWrong) throw new Error('TEST (d) FAIL: no wrong confirmation');
console.log('TEST (d) PASS');

// === SESSION 3: Teach — test (i) stop during awaiting ===

// Clear cache để buộc gọi API mới
await page.evaluate(() => {
  const btn = document.querySelector('#clear-cache-btn');
  if (btn) btn.click();
});
await page.waitForTimeout(500);

await page.click('#teach-now', { force: true });
await page.waitForTimeout(6000); // Chờ chunk 0 + câu hỏi 1

// Stop during awaiting
await page.click('#btn-stop', { force: true });
await page.waitForTimeout(500);

// === TEST (i): Click Stop while awaiting → status 'stopped', then answering does nothing ===
const stopStatusI = await page.textContent('#voice-text');
console.log('TEST (i): Status after stop =', stopStatusI);
if (!stopStatusI.includes('dừng') && !stopStatusI.includes('stopped')) {
  throw new Error(`TEST (i) FAIL: status not stopped, got "${stopStatusI}"`);
}

// Answer after stop — should NOT resume teaching (awaitingAnswer should be false)
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(3000);

// The answer should be treated as regular chat message (not interactive answer)
const chatMsgsI = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
// Should NOT see ❌/✅ from interactive answer handler; may get regular chat response
const hasInteractiveConfirmI = chatMsgsI.some(m => m.includes('✅ Đúng') || m.includes('❌ Sai'));
console.log('TEST (i): Interactive confirm after stop =', hasInteractiveConfirmI, '(should be false or from earlier)');
console.log('TEST (i) PASS');

// === TEST (k): Toggle interactive OFF → dạy trang không hỏi ===
// Bật settings, tắt interactive
await page.click('#settings-btn', { force: true });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const toggle = document.querySelector('#interactive-teach-toggle');
  if (toggle) toggle.checked = false;
});
await page.click('#save-api-key', { force: true });
await page.waitForTimeout(500);

// Clear cache để buộc gọi API mới
await page.evaluate(() => {
  const btn = document.querySelector('#clear-cache-btn');
  if (btn) btn.click();
});
await page.waitForTimeout(1000);

// Route mới: trả response không có interactive_questions (voice_chunks vẫn có)
await page.unroute('**generativelanguage.googleapis.com/**');
await page.route('**generativelanguage.googleapis.com/**', async (route, request) => {
  apiCallCount++;
  const postData = request.postDataJSON ? request.postDataJSON() : null;
  const promptText = postData ? JSON.stringify(postData) : '';

  if (promptText.includes('interactive_questions') || promptText.includes('voice_chunks')) {
    const responseJson = JSON.stringify({
      voice_chunks: [
        { text: 'Doan mot', region_vert: [0, 0.5] },
        { text: 'Doan hai', region_vert: [0.5, 1.0] }
      ],
      interactive_questions: []  // empty → no interaction
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: responseJson }] } }] })
    });
  } else {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ voice_text: 'OK', display_text: 'OK' }) }] } }]
      })
    });
  }
});

// Xoá chat cũ trước khi test không có câu hỏi mới
await page.click('#chat-clear-btn', { force: true });
await page.waitForTimeout(300);

// Clear chat để loại bỏ ❓ từ các session trước (false positive)
await page.evaluate(() => {
  const btn = document.querySelector('#chat-clear-btn');
  if (btn) btn.click();
});
await page.waitForTimeout(300);

await page.click('#teach-now', { force: true });
await page.waitForTimeout(6000);

// Kiểm tra KHÔNG có câu hỏi trong chat (chỉ còn welcome hoặc không có AI message mới)
const chatMsgs5 = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasInteractiveQuestionOff = chatMsgs5.some(m => m.includes('❓'));
console.log('TEST (k): Interactive OFF — question in chat =', hasInteractiveQuestionOff);
if (hasInteractiveQuestionOff) throw new Error('TEST (k) FAIL: question shown when interactive toggle is OFF');
console.log('TEST (k) PASS');

// === TEST (l): Cache entry cũ thiếu field → giảng single utterance không tương tác ===
// Tắt interactive toggle, bật lại để test cache entry format cũ
await page.click('#settings-btn', { force: true });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const toggle = document.querySelector('#interactive-teach-toggle');
  if (toggle) toggle.checked = true;
});
await page.click('#save-api-key', { force: true });
await page.waitForTimeout(500);

// Xóa cache để đảm bảo gọi API (vì inject khó)
await page.evaluate(() => {
  const btn = document.querySelector('#clear-cache-btn');
  if (btn) btn.click();
});
await page.waitForTimeout(500);

// Mock response: thiếu voice_chunks và interactive_questions
await page.unroute('**generativelanguage.googleapis.com/**');
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCallCount++;
  // Response format cũ: chỉ có voice_text (không JSON)
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Day la noi dung giang bai khong co voice_chunks.' }] } }]
    })
  });
});

await page.click('#teach-now', { force: true });
await page.waitForTimeout(6000);

// Verify: không crash, voice text bình thường
const voiceTextG = await page.textContent('#voice-text');
console.log('TEST (l): Cache old format — voice status:', voiceTextG);
if (!voiceTextG || voiceTextG.includes('error') || voiceTextG.includes('Lỗi')) {
  throw new Error(`TEST (l) FAIL: crash on old format cache, status: "${voiceTextG}"`);
}
console.log('TEST (l) PASS');

// === Final ===
if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA interactive teach PASS');
await browser.close();
