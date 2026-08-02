// QA regression: seek-duration (dur) ổn định qua Q&A + seek-pct global + không hijack UI
// Chạy: node tests/qa-sub-duration.mjs (cần server localhost:8080)
// Bug đã fix:
//  1. dur thu nhỏ 00:07 → 00:02 sau khi trả lời (speak câu hỏi/xác nhận ghi đè _fullText)
//  2. seek val hiển thị pct LOCAL trong chunk (12→21) thay vì global (33→67→100)
//  3. sau câu hỏi cuối, onStart/onEnd/onProgress của confirm-speak hijack UI
//     ("Ma tran la bang so." + "Đang giảng bài..." sau khi đã trả lời xong)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.multi_cell(0, 8, 'Dai so tuyen tinh la mon hoc quan trong. Ma tran la bang so gom hang va cot. Dinh thuc la mot gia tri so duoc tinh tu ma tran vuong. Phep nhan ma tran co nhung tinh chat dac biet. Ma tran nghich dao ton tai khi dinh thuc khac khong. Nhung khai niem nay la tao nen mon hoc. He phuong trinh tuyen tinh dung de giai bai toan thuc te.')
p.output('/tmp/qa-2q.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'deepseek', apiKey: 'fake', interactiveTeach: true }));
  let speaking = false;
  let cur = null;
  const m = {
    getVoices() { return [{ name: 'vi-VN - Mock', lang: 'vi-VN', voiceURI: 'm' }]; },
    speak(u) {
      speaking = true;
      cur = u;
      setTimeout(() => u.onstart?.(), 15);
      const tt = 350 + Math.min(700, (u.text || '').length * 10);
      setTimeout(() => { if (cur === u) { cur = null; u.onend?.(); speaking = false; } }, tt);
    },
    cancel() {
      const u = cur;
      cur = null;
      speaking = false;
      if (u) queueMicrotask(() => u.onerror?.({ error: 'canceled' }));
    },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return speaking; }, get pending() { return false; }, get paused() { return false; }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: m, writable: true, configurable: true });
  // Chrome chặn set .voice khi voice không hợp lệ → override setter để mock không ném lỗi
  try {
    Object.defineProperty(window.SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true, set(v) { this.__mockVoice = v; }, get() { return this.__mockVoice || null; }
    });
  } catch (e) {}
});

await page.route('**/api/deepseek', async (route, req) => {
  const raw = req.postData() || '';
  if (raw.includes('voice_chunks') && raw.includes('after_chunk')) {
    const json = JSON.stringify({
      voice_chunks: [
        { text: 'chunk mot. Ma tran la bang so.', region_vert: [0, 0.33] },
        { text: 'chunk hai. Dinh thuc la gia tri so.', region_vert: [0.33, 0.66] },
        { text: 'chunk ba. Ma tran nghich dao ton tai.', region_vert: [0.66, 1] }
      ],
      interactive_questions: [
        { after_chunk: 0, lead_in: 'Tra loi cau hoi mot', question: 'Ma tran la gi?', options: ['Bang so', 'So phuc', 'Hinh tron', 'Vec to'], correct_index: 0, explanation: 'Ma tran la bang so.' },
        { after_chunk: 2, lead_in: 'Tra loi cau hoi hai', question: 'Dinh thuc tinh tu dau?', options: ['Hang', 'Ma tran vuong', 'Cot', 'Vector'], correct_index: 1, explanation: 'Tinh tu ma tran vuong.' }
      ]
    });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
  } else {
    const json = JSON.stringify({ voice_text: 'Tra loi chat.', display_text: 'Tra loi chat.' });
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
  }
});

const consoleErrs = [];
page.on('pageerror', (e) => consoleErrs.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(300);
await page.setInputFiles('#pdf-input', '/tmp/qa-2q.pdf');
await page.waitForTimeout(1200);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(300);

const fail = [];
const assert = (cond, label) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label);
  if (!cond) fail.push(label);
};
const ch = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-bubble')).map(m => m.textContent || ''));
const rd = () => page.evaluate(() => ({
  sub: document.getElementById('subtitle-text').textContent,
  dur: document.getElementById('seek-duration').textContent,
  val: parseInt(document.getElementById('seek-slider').value, 10) || 0
}));
const until = async (fn, timeout = 6000, step = 200) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(step);
  }
  return await fn();
};
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// Chờ TTS đã đọc xong câu hỏi/confirm trước khi trả lời — mô phỏng người dùng thật
// (nghe hết câu hỏi rồi mới chọn). Tránh race: trả lời khi TTS còn đang đọc
// sẽ bị input "nuốt" (không vào _handleInteractiveAnswer, không vào chat).
const waitSpeakingIdle = () =>
  page.waitForFunction(() => !window.speechSynthesis.speaking, { timeout: 8000 });

await page.click('#teach-now', { force: true });

// ---- Đợi câu hỏi 1 xuất hiện trong chat (sau chunk 0) ----
const q1Seen = await until(async () => (await ch()).some(t => t.includes('Ma tran la gi?')));
assert(q1Seen, 'câu hỏi 1 hiện trong chat');

let s = await rd();
const durBase = s.dur;
assert(durBase !== '00:00' && durBase.length === 5, `dur đang tính khi chờ trả lời (dur=${durBase})`);

// ---- Trả lời A (đúng Q1) → confirm-speak chạy (dur phải GIỮ NGUYÊN) ----
await waitSpeakingIdle();
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await until(async () => (await ch()).some(m => m.includes('✅ Đúng') || m.includes('Đúng rồi')));
s = await rd();
assert(s.dur === durBase, `dur giữ nguyên giữa/sau confirm Q1 (dur=${s.dur}, base=${durBase})`);

// ---- Chunk 2 đang giảng: seek val phải GLOBAL (>=33) ----
await until(async () => {
  const st = await rd();
  return st.val >= 33 && !st.sub.includes('Ma tran la gi?');
});
s = await rd();
assert(s.dur === durBase, `dur giữ nguyên khi resume chunk 2 (dur=${s.dur})`);
assert(s.val >= 33, `seek val global khi ở chunk 2 (val=${s.val}, >=33)`);

// ---- Câu hỏi 2 (after_chunk=2) → val phải ~100 trước khi hỏi ----
const q2Seen = await until(async () => (await ch()).some(m => m.includes('Dinh thuc tinh tu dau?')));
assert(q2Seen, 'câu hỏi 2 hiện trong chat');
s = await rd();
assert(s.val >= 66, `val global đạt >=66 (cuối chunk ba) (val=${s.val})`);
assert(s.dur === durBase, `dur giữ nguyên khi hỏi câu 2 (dur=${s.dur})`);

// ---- Trả lời B (đúng) → confirm cuối → KHÔNG hijack UI ----
await waitSpeakingIdle();
await page.fill('#chat-input', 'B');
await page.press('#chat-input', 'Enter');
await until(async () => (await ch()).some(m => m.includes('Tinh tu ma tran vuong')));
s = await rd();
assert(s.sub.includes('Tinh tu') && !s.sub.includes('Ma tran la bang so'),
  `sub giữ confirm, KHÔNG nhảy full-text: "${s.sub.slice(0, 30)}"`);
assert(s.dur === durBase, `dur giữ nguyên sau confirm cuối (dur=${s.dur})`);

// ---- Sequence kết thúc: "Đã giảng xong trang 1" ----
const done = await until(async () => {
  const t = await page.textContent('#voice-text');
  return t.includes('giảng xong') || t.includes('xong');
});
assert(done, 'kết thúc: status Đã giảng xong trang 1');

const statusEnd = await page.textContent('#voice-text');
assert(!statusEnd.includes('Đang giảng bài'), 'không còn status "Đang giảng bài..." định sau khi xong (st="' + statusEnd + '")');
assert(consoleErrs.length === 0, 'không pageerror: ' + consoleErrs.join(', '));

await browser.close();
if (fail.length > 0) {
  console.log('\n❌ QA sub-duration FAIL:', fail.length, 'assert(s):', fail.join(' | '));
  process.exit(1);
}
console.log('\n✅ QA sub-duration PASS');
process.exit(0);