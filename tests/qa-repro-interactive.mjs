// QA: Reproduce pause/seek/subtitle bugs on interactive (chunk) teaching.
// Chạy: node tests/qa-repro-interactive.mjs (cần server localhost:8080)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.multi_cell(0, 8, 'Dai so tuyen tinh la mon hoc quan trong. Ma tran la bang so gom hang va cot. Dinh thuc la mot gia tri so duoc tinh tu ma tran vuong. Phep nhan ma tran co nhung tinh chat dac biet. Ma tran nghich dao ton tai khi dinh thuc khac khong. Nhung khai niem nay la nen tang cua mon hoc.')
p.output('/tmp/qa-repro.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed');

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'deepseek', apiKey: 'fake', interactiveTeach: true }));
  const realSynth = window.speechSynthesis;
  let speaking = false;
  let qPaused = false;
  window.__qaSpeech = [];
  window.__tt = window.__tt || [];
  const log = (s) => { window.__qaSpeech.push(s); window.__tt.push(s); };
  const m = {
    getVoices() { const r = realSynth?.getVoices?.(); return (r && r.length) ? r : [{ name: 'vi-VN - Mock', lang: 'vi-VN', voiceURI: 'm' }]; },
    speak(u) {
      speaking = true;
      log('SPEAK:' + (u.text || '').slice(0, 14));
      const tt = 250 + Math.min(400, (u.text || '').length * 8);
      setTimeout(() => u.onstart?.(), 15);
      setTimeout(() => { if (!qPaused) { u.onend?.(); speaking = false; } }, tt);
    },
    cancel() { speaking = false; qPaused = false; },
    pause() { qPaused = true; log('PAUSE'); },
    resume() { qPaused = false; log('RESUME'); },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return speaking; }, get pending() { return false; }, get paused() { return qPaused; }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: m, writable: true, configurable: true });
  try {
    Object.defineProperty(window.SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true, set(v) { this.__mockVoice = v; }, get() { return this.__mockVoice || null; }
    });
  } catch (e) {}
});

let teachCalls = 0;
await page.route('**/api/deepseek', async (route, req) => {
  const raw = req.postData() || '';
  if (raw.includes('voice_chunks')) {
    teachCalls++;
    const json = JSON.stringify({
      voice_chunks: [
        { text: 'Chunk mot. Ma tran la bang so.', region_vert: [0, 0.33] },
        { text: 'Chunk hai. Dinh thuc la gia tri.', region_vert: [0.33, 0.66] },
        { text: 'Chunk ba. Ma tran nghich dao.', region_vert: [0.66, 1] }
      ],
      interactive_questions: [{
        after_chunk: 1, lead_in: 'Bay gio toi hoi em', question: 'Dinh thuc la gi?', options: ['Gia tri', 'Ma tran', 'So', 'Vec to'], correct_index: 0, explanation: 'Dinh thuc la gia tri.'
      }]
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: json } }] }) });
  } else {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ voice_text: 'Tra loi.', display_text: 'Tra loi.' }) } }] }) });
  }
});

const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(300);
await page.setInputFiles('#pdf-input', '/tmp/qa-repro.pdf');
await page.waitForTimeout(1200);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(300);

await page.click('#teach-now', { force: true });
await page.waitForTimeout(400);
console.log('teachCalls:', teachCalls, 'status:', await page.textContent('#voice-text'));

// 1) PAUSE trong chunk teaching
await page.click('#btn-play-pause', { force: true });
await page.waitForTimeout(250);
const stPause = await page.textContent('#voice-text');
const btnPause = await page.textContent('#btn-play-pause');
console.log('after pause click: btn=' + JSON.stringify(btnPause) + ' status=' + JSON.stringify(stPause));
console.log('speech log:', JSON.stringify((await page.evaluate(() => window.__tt.slice())).slice(-4)));

// 2) SEEK trong chunk teaching
await page.evaluate(() => {
  const s = document.getElementById('seek-slider');
  s.value = 33; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(300);
console.log('after seek 33: status=' + JSON.stringify(await page.textContent('#voice-text')));

// 3) chờ câu hỏi hiện ra
let qShown = false;
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(400);
  const t = await page.textContent('#voice-text').catch(() => '');
  if (t && t.includes('trả lời')) { qShown = true; break; }
}
console.log('question shown:', qShown);
console.log('subtitle now:', JSON.stringify(await page.textContent('#subtitle-text')));

// 4) pause khi đang chờ câu hỏi
if (qShown) {
  await page.click('#btn-play-pause', { force: true });
  await page.waitForTimeout(200);
  console.log('pause while waiting answer: btn=' + JSON.stringify(await page.textContent('#btn-play-pause')) + ' status=' + JSON.stringify(await page.textContent('#voice-text')));
  console.log('speech after pause while waiting:', JSON.stringify((await page.evaluate(() => window.__tt.slice())).slice(-3)));
}

console.log(errs.length ? 'PAGEERRORS:\n' + errs.join('\n') : 'no page errors');
await browser.close();
process.exit(0);