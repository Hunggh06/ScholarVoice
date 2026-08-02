/**
 * QA: Sau khi trả lời câu hỏi tương tác, gõ câu hỏi thật vào chat phải có AI trả lời.
 * Repro cho bug: "hỏi trên thanh chat không có kết quả trả về"
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.multi_cell(0, 8, 'Ma tran la mot bang so. Dinh thuc la mot gia tri gan voi ma tran vuong. Phep nhan ma tran kong giao hoan.')
p.output('/tmp/qa-chat-after.pdf')`;
spawnSync('python3', ['-c', py]);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'deepseek', apiKey: 'fake', interactiveTeach: true }));
  const realSynth = window.speechSynthesis;
  let speaking = false;
  const m = {
    getVoices() { const r = realSynth?.getVoices?.(); return (r && r.length) ? r : [{ name: 'vi-VN - Mock', lang: 'vi-VN', voiceURI: 'm' }]; },
    speak(u) { speaking = true; setTimeout(() => { u.onstart?.(); }, 20); setTimeout(() => { u.onend?.(); speaking = false; }, 700); },
    cancel() { speaking = false; }, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return speaking; }, get pending() { return false; }, get paused() { return false; }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: m, writable: true, configurable: true });
  window.speechSynthesis.onvoiceschanged = null;
  // Cho phép gán voice object thường (Chromium throw nếu không phải SpeechSynthesisVoice thật)
  try {
    Object.defineProperty(window.SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true,
      set(v) { this.__mockVoice = v; },
      get() { return this.__mockVoice || null; }
    });
  } catch (e) {}
});

let teachBranch = 0, chatBranch = 0;
await page.route('**/api/deepseek', async (route, req) => {
  // eslint-disable-next-line no-undef
  const raw = req.postData() || '';
  console.log('=== REQ', req.url(), 'branch-hint:', raw.includes('voice_chunks'), raw.includes('after_chunk'), 'len:', raw.length);
  // Dựa vào câu hỏi để phân biệt teach vs chat
  if (raw.includes('voice_chunks') && raw.includes('after_chunk')) {
    teachBranch++;
    const json = JSON.stringify({
      voice_chunks: [
        { text: 'Chunk mot. Ma tran la bang so.', region_vert: [0, 0.5] },
        { text: 'Chunk hai. Dinh thuc la gia tri.', region_vert: [0.5, 1] }
      ],
      interactive_questions: [{
        after_chunk: 0, lead_in: 'Bây giờ tôi sẽ hỏi bạn câu này',
        question: 'Dinh thuc la gi?', options: ['Gia tri', 'Ma tran', 'So phuc', 'Vec to'],
        correct_index: 0, explanation: 'Dinh thuc la mot gia tri so.'
      }]
    });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
  } else {
    chatBranch++;
    // Câu hỏi chat sau khi trả lời
    const json = JSON.stringify({
      voice_text: 'Định nghĩa đầy đủ: định thức là một giá trị số gán cho ma trận vuông.',
      display_text: '**Định thức** là một giá trị số gán cho ma trận vuông, dùng nhiều trong giải tích.'
    });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
  }
});

await page.goto('http://localhost:8080/');
const consoleErrs = [];
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') consoleErrs.push(msg.text()); });
page.on('pageerror', (e) => { consoleErrs.push('PAGEERROR: ' + e.message); });
await page.waitForSelector('#start-btn', { state: 'visible' });

// Mở trang teach
await page.click('#start-btn', { force: true });
await page.waitForTimeout(300);
await page.setInputFiles('#pdf-input', '/tmp/qa-chat-after.pdf');
await page.waitForTimeout(1200);
// đóng modal nếu có
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(300);

// Bắt đầu giảng
await page.click('#teach-now', { force: true });
await page.waitForTimeout(3000);
console.log('status:', await page.textContent('#voice-text').catch(() => '(none)'));

// Câu hỏi tương tác đã được đặt — kiểm tra
let hasQuestion = false;
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(500);
  const msgs = await page.evaluate(() => Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-bubble')).map(m => m.textContent || ''));
  if (msgs.some(m => m.includes('Dinh thuc la gi'))) { hasQuestion = true; break; }
}
console.log('question surfaced:', hasQuestion);

// Trả lời
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(2000);

// Kiểm tra xác nhận đúng/sai
const msgsAfterAnswer = await page.evaluate(() => Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-buffer')).map(m => m.textContent || ''));
console.log('confirmation shown:', msgsAfterAnswer.some(m => m.includes('Đúng') || m.includes('Sai')));

// Giờ gõ câu hỏi thật
await page.fill('#chat-input', 'Định thức là');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(1500);

const msgsAfterChat = await page.evaluate(() => Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-bubble')).map(m => m.textContent || ''));
const gotAnswer = msgsAfterChat.some(m => m.includes('giá trị số'));
console.log('chat answer received:', gotAnswer);
console.log(JSON.stringify(msgsAfterChat.slice(-3), null, 1));

if (!hasQuestion || !gotAnswer) {
  console.log('❌ FAIL');
  process.exit(1);
}
console.log('✅ PASS');
await browser.close();