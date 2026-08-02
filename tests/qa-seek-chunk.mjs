// QA: seek slider works on interactive (chunk) teaching pages
// Chạy: node tests/qa-seek-chunk.mjs (cần server localhost:8080)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const SKIP_ERRS = ['InvalidPDFException', 'TTSError', 'Lỗi tải PDF'];

const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.multi_cell(0, 8, 'Dai so tuyen tinh: Ma tran va dinh thuc cac phan tu. Phep nhan ma tran khong giao hoan trong truong hop tong quat nen phai doc ky cong thuc tinh dinh thuc truoc khi giai bai tap.')
p.output('/tmp/qa-seek-chunk.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed');

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

await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({
    provider: 'deepseek', apiKey: 'fake', interactiveTeach: true
  }));
  const _origSynth = window.speechSynthesis;
  let _queued = 0;
  const _mockSynth = {
    getVoices() { return _origSynth?.getVoices?.() || [{ name: 'vi-VN - Mock', lang: 'vi-VN', voiceURI: 'mock' }]; },
    speak(utt) {
      _queued++;
      const dur = Math.min(400, Math.max(120, utt.text.length * 12));
      setTimeout(() => { if (utt.onstart) utt.onstart(); }, 30);
      setTimeout(() => { if (utt.onend) utt.onend(); _queued--; }, dur);
    },
    cancel() { _queued = 0; }, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return _queued > 0; }, get pending() { return false; }, get paused() { return false; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: _mockSynth, writable: true, configurable: true });
});

// Mock DeepSeek: 3 chunks, question after LAST chunk (index 2 = length-1)
await page.route('**/api/deepseek', async (route, request) => {
  const body = request.postDataJSON ? request.postDataJSON() : {};
  const str = JSON.stringify(body);
  if (str.includes('voice_chunks')) {
    const responseJson = JSON.stringify({
      voice_chunks: [
        { text: 'Doan mot gioi thieu ma tran.', region_vert: [0, 0.33] },
        { text: 'Doan hai ve dinh thuc.', region_vert: [0.33, 0.66] },
        { text: 'Doan ba ve phep nhan ma tran.', region_vert: [0.66, 1] }
      ],
      interactive_questions: [
        { after_chunk: 2, lead_in: 'Bay gio toi se hoi em cau nay', question: 'Ma tran la gi?', options: ['Bang so', 'Vector', 'Ma tran', 'Dao ham'], correct_index: 0, explanation: 'Ma tran la bang so.' }
      ]
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: responseJson } }] }) });
  } else {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ voice_text: 'Tra loi', display_text: 'Tra loi' }) } }] }) });
  }
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(400);

await page.setInputFiles('#pdf-input', '/tmp/qa-seek-chunk.pdf');
await page.waitForTimeout(1500);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(400);

// Teach and wait until chunk teaching starts (slider should be enabled)
await page.click('#teach-now', { force: true });
await page.waitForFunction(() => {
  const el = document.getElementById('seek-slider');
  return el && !el.disabled;
}, { timeout: 30000 });
console.log('PASS: seek-slider enabled during chunk teaching');

// Read current status/detail before seek
const before = await page.textContent('#voice-text');
console.log('  status before seek:', before);

// Seek forward to the last chunk (pct ~95 → chunk index 2)
await page.evaluate(() => {
  const slider = document.getElementById('seek-slider');
  slider.value = 95;
  slider.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(600);
const splitted = (await page.textContent('#voice-text')).split('—');
const statusAfterSeek = await page.textContent('#voice-text');
console.log('  status after seek :', statusAfterSeek);

// Question after last chunk should surface once last chunk finishes
let hasQ = false;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500);
  const msgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#chat-messages .ai-msg .ai-bubble')).map(m => m.textContent || ''));
  if (msgs.some(m => m.includes('❓') || m.includes('Ma tran la gi?'))) { hasQ = true; break; }
}
console.log('Question surfaced after seek:', hasQ ? 'YES' : 'NO');

if (errors.length > 0) { console.log('BROWSER ERRORS:'); errors.forEach(e => console.log(' -', e)); }

const ok = hasQ;
console.log(ok ? '✅ QA seek-chunk PASS' : '❌ QA seek-chunk FAIL');
await browser.close();
if (!ok) process.exit(1);