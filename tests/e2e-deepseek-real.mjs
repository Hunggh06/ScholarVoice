// E2E: real DeepSeek backend via browser — does interactive questions appear?
import { chromium } from 'playwright';

const SKIP_ERRS = ['InvalidPDFException', 'TTSError', 'Lỗi tải PDF'];

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

// Seed settings: deepseek provider (real backend via localhost:8080/api/deepseek)
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({
    provider: 'deepseek', apiKey: 'fake', interactiveTeach: true,
    deepseekModel: 'deepseek-chat'
  }));
  // mock TTS to avoid headless TTS failures
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
});

await page.goto('http://localhost:8080/');

// Capture raw DeepSeek backend responses for debugging
const rawResponses = [];
page.on('response', async (res) => {
  if (res.url().includes('/api/deepseek')) {
    try { rawResponses.push(await res.text()); } catch {}
  }
});
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// PDF 1 page — đủ dài (>20 từ) để KHÔNG bị detect là title slide
const py = 'from fpdf import FPDF\np = FPDF()\np.add_page(); p.set_font("Helvetica", size=14)\np.multi_cell(0, 8, "Dai so tuyen tinh: Ma tran va dinh thuc. Ma tran cap 2x2 co dang dang [[a,b],[c,d]]. Dinh thuc cua ma tran duoc tinh bang cong thuc ad tru bc. Neu dinh thuc khac khong thi ma tran la kha nghich va co ma tran nghich dao. Phep nhan ma tran khong giao hoan: AB khac BA trong truong hop tong quat. Phep chuyen vi doi hang thanh cot va giu nguyen cac phan tu tren duong cheo chinh.")\np.output("/tmp/e2e-deepseek.pdf")';
import { spawnSync } from 'node:child_process';
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('pdf failed');

await page.setInputFiles('#pdf-input', '/tmp/e2e-deepseek.pdf');
await page.waitForTimeout(2000);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(500);

console.log('Clicking Teach...');
await page.click('#teach-now', { force: true });

// Poll for up to 120s for question text in chat
const pollMsgs = async () => page.evaluate(() => {
  const msgs = document.querySelectorAll('#chat-messages .ai-msg .ai-bubble');
  return Array.from(msgs).map(m => m.textContent || '');
});

let found = false;
for (let i = 0; i < 24; i++) { // 24 * 5s = 120s
  await page.waitForTimeout(5000);
  const msgs = await pollMsgs();
  const hasQ = msgs.some(m => m.includes('❓') || m.includes('A.') && m.includes('B.'));
  const status = await page.textContent('#voice-text');
  console.log(`[${i * 5}s] status="${status}" | msgs=${msgs.length} | hasQ=${hasQ}`);
  if (hasQ) { found = true; break; }
  // If teaching finished without question, stop waiting
  if (status.includes('giảng xong') || status.includes('xong')) { console.log('Teaching ended without question'); break; }
}

console.log('=== FINAL CHAT ===');
const finalMsgs = await pollMsgs();
for (const m of finalMsgs) console.log(' -', m.slice(0, 120));

console.log(`=== RAW DEEPSEEK RESPONSES (${rawResponses.length}) ===`);
for (let i = 0; i < rawResponses.length; i++) {
  console.log(`--- response ${i} (first 1500 chars) ---`);
  console.log(rawResponses[i].slice(0, 1500));
}

if (errors.length) { console.log('BROWSER ERRORS:'); errors.forEach(e => console.log(' -', e)); }

console.log(found ? '✅ REAL DeepSeek interactive works' : '❌ No question appeared');
await browser.close();