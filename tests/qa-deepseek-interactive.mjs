// QA: interactive teach flow with DeepSeek provider (mock /api/deepseek)
// Chạy: node /tmp/qa-deepseek-interactive.mjs (cần server localhost:8080)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const SKIP_ERRS = ['InvalidPDFException', 'TTSError', 'Lỗi tải PDF'];

// --- Tạo PDF 1 trang bằng python3 + fpdf ---
const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad - bc. Neu dinh thuc khac 0, ma tran kha nghich.')
p.output('/tmp/qa-deepseek-interactive.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

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

// --- Seed settings (deepseek provider) + mock TTS TRƯỚC page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({
    provider: 'deepseek', apiKey: 'fake', interactiveTeach: true
  }));

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

// --- Mock DeepSeek endpoint /api/deepseek ---
await page.route('**/api/deepseek', async (route, request) => {
  const postData = request.postDataJSON ? request.postDataJSON() : null;
  const promptText = postData ? JSON.stringify(postData) : '';
  const sysOrUser = (postData && postData.messages) ? JSON.stringify(postData.messages) : '';

  // teachPage interactive request includes voice_chunks / interactive_questions keywords
  if (promptText.includes('interactive_questions') || promptText.includes('voice_chunks')
      || sysOrUser.includes('interactive_questions') || sysOrUser.includes('voice_chunks')) {
    const responseJson = JSON.stringify({
      voice_chunks: [
        { text: 'Doan mot: Ma tran la bang so hinh chu nhat.', region_vert: [0, 0.4] },
        { text: 'Doan hai: Dinh thuc khac 0 thi ma tran kha nghich.', region_vert: [0.4, 1.0] }
      ],
      interactive_questions: [
        {
          after_chunk: 0,
          question: 'Ma tran la gi?',
          options: ['Bang so', 'Mot vector', 'Mot ma tran', 'Mot phuong trinh'],
          correct_index: 0,
          explanation: 'Ma tran la bang so hinh chu nhat.'
        }
      ]
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: responseJson } }],
        conversation_id: 'conv-123'
      })
    });
  } else {
    // askQuestion
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify({ voice_text: 'Tra loi', display_text: 'Tra loi' }) } }]
      })
    });
  }
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// Upload PDF
await page.setInputFiles('#pdf-input', '/tmp/qa-deepseek-interactive.pdf');
await page.waitForTimeout(2000);

// Close API modal nếu xuất hiện
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(500);

await page.click('#teach-now', { force: true });
await page.waitForTimeout(8000);

// Kiểm tra câu hỏi xuất hiện trong chat
const chatMsgs = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasQuestion = chatMsgs.some(m => m.includes('Ma tran la gi?'));
console.log('TEST A: Question in chat =', hasQuestion);
if (!hasQuestion) {
  // Debug: log all messages
  console.log('CHAT MESSAGES:', JSON.stringify(chatMsgs, null, 2));
  const voiceStatus = await page.textContent('#voice-text');
  console.log('Voice status:', voiceStatus);
  throw new Error('DeepSeek question NOT found — interactive teach may be broken for deepseek');
}
console.log('TEST A PASS');

// Answer correctly
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(4000);

const chatMsgs2 = await page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});
const hasCorrect = chatMsgs2.some(m => m.includes('✅ Đúng') || m.includes('Bang so hinh chu nhat'));
console.log('TEST B: Correct confirmation =', hasCorrect);
if (!hasCorrect) throw new Error('No correct confirmation');
console.log('TEST B PASS');

if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA deepseek interactive PASS');
await browser.close();