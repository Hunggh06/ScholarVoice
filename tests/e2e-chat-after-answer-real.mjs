// E2E real: sau khi trả lời câu hỏi tương tác (backend thật), gõ câu hỏi chat → phải có AI trả lời
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!e.message.includes('InvalidPDFException')) errors.push('pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('InvalidPDFException')) errors.push('console: ' + m.text()); });

await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({
    provider: 'deepseek', apiKey: 'fake', interactiveTeach: true, deepseekModel: 'deepseek-chat'
  }));
  const _origSynth = window.speechSynthesis;
  let _queued = 0;
  const _mockSynth = {
    getVoices() { return _origSynth?.getVoices?.() || [{ name: 'vi', lang: 'vi-VN', voiceURI: 'mock' }]; },
    speak(utt) {
      _queued++;
      const dur = Math.min(1500, Math.max(300, utt.text.length * 20));
      setTimeout(() => { if (utt.onstart) utt.onstart(); }, 50);
      setTimeout(() => {
        const chars = utt.text.length; let pos = 0; const step = Math.max(1, Math.floor(chars / 10));
        const iv = setInterval(() => { pos += step; if (pos >= chars) { clearInterval(iv); return; } if (utt.onboundary) utt.onboundary({ charIndex: pos }); }, dur / 12);
        setTimeout(() => { clearInterval(iv); if (utt.onend) utt.onend(); _queued--; }, dur);
      }, 60);
    },
    cancel() { _queued = 0; }, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return _queued > 0; }, get pending() { return false; }, get paused() { return false; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: _mockSynth, writable: true, configurable: true });
  try {
    Object.defineProperty(window.SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true, set(v) { this.__mockVoice = v; }, get() { return this.__mockVoice || null; }
    });
  } catch (e) {}
});

await page.goto('http://localhost:8080/');
const rawResponses = [];
page.on('response', async (res) => {
  if (res.url().includes('/api/deepseek')) { try { rawResponses.push(await res.text()); } catch {} }
});
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

const py = [
  'from fpdf import FPDF',
  'p = FPDF()',
  'p.add_page()',
  'p.set_font("Helvetica", size=14)',
  'p.multi_cell(0, 8, "Dai so tuyen tinh: Ma tran va dinh thuc. Ma tran cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc duoc tinh bang cong thuc ad tru bc. Neu dinh thuc khac khong thi ma tran la kha nghich. Phep nhan ma tran khong giao hoan AB khac BA trong truong hop tong quat. Phep chuyen vi doi hang thanh cot va giu nguyen phan tu o duong cheo. Ma tran don vi I nhan voi bat ky ma tran nao cung cho chinh ma tran do. Phep cong ma tran cong tung phan tu tuong ung. Ma tran doi xung bang chuyen vi cua no. Hang cua ma tran la so duc, cot la so doc. Phep nhan yeu cau so cot cua ma tran thu nhat bang so dong cua ma tran thu hai. Ma tran thuan nghich ton tai khi dinh thuc khac khong.")',
  'p.output("/tmp/e2e2.pdf")'
].join('\n');
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('pdf failed');

await page.setInputFiles('#pdf-input', '/tmp/e2e2.pdf');
await page.waitForTimeout(2000);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(500);

const pollMsgs = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-bubble')).map(m => m.textContent || ''));

console.log('Clicking Teach...');
await page.click('#teach-now', { force: true });

// Phase 1: chờ câu hỏi (tối đa 120s)
let questionMsgs, qStatus;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(5000);
  questionMsgs = await pollMsgs();
  qStatus = await page.textContent('#voice-text');
  const hasQ = questionMsgs.some(m => m.includes('❓') && (m.includes('A.') || m.includes('A ')));
  console.log(`[Q ${i * 5}s] status="${qStatus}" hasQ=${hasQ} msgs=${questionMsgs.length}`);
  if (hasQ) break;
}
if (!questionMsgs.some(m => m.includes('❓'))) {
  console.log('❌ Không có câu hỏi tương tác xuất hiện.');
  process.exit(1);
}

// Phase 2: trả lời 'A'
await page.fill('#chat-input', 'A');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(3000);
const afterAns = await pollMsgs();
console.log('after answer, last msg:', (afterAns[afterAns.length - 1] || '').slice(0, 100));

// Phase 3: gõ câu hỏi chat thật
await page.fill('#chat-input', 'Giai thich chi tiet hon ve cach tinh dinh thuc cap 2');
await page.press('#chat-input', 'Enter');
await page.waitForTimeout(2000);

// Đợi phản hồi chat tối đa 60s
let finalMsgs = [];
let gotAnswer = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(5000);
  finalMsgs = await pollMsgs();
  const chatInputEnabled = await page.evaluate(() => !document.getElementById('chat-input').disabled);
  // AI reply sau khi ta hỏi: msgs nào không phải câu hỏi trắc nghiệm đã đếm trước là câu trả lời
  gotAnswer = finalMsgs.length > afterAns.length && chatInputEnabled;
  console.log(`[C${i * 5}s] msgs=${finalMsgs.length} (before=${afterAns.length}) inputEnabled=${chatInputEnabled} got=${gotAnswer}`);
  if (gotAnswer) break;
}

console.log('=== FINAL CHAT ===');
for (const m of finalMsgs.slice(-4)) console.log(' -', m.slice(0, 140));

if (errors.length) { console.log('BROWSER ERRORS:'); errors.forEach(e => console.log(' -', e)); }
console.log(`=== RAW responses: ${rawResponses.length} ===`);

// Verdict: cần có ít nhất 1 AI câu trả lời mới quanh câu hỏi chat
const lastMsg = (finalMsgs[finalMsgs.length - 1] || '');
const answerOk = gotAnswer && /Giai thich|thich hơn|định thức|thức|được tính|công thức|ad|bc/i.test(lastAnswer());
function lastAnswer() { return lastMsg.replace(/\s+/g, ' '); }
console.log(answerOk ? '✅ REAL E2E: chat answer arrives after answering question' : '❌ No chat answer');
await browser.close();