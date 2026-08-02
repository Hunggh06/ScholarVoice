/**
 * QA: Pause + seek + subtitle trong luồng giảng có câu hỏi tương tác.
 * Repro cho: "nút pause và thanh tua nhiều lúc không hoạt động, cứ đứng im.
 * sub bị nhảy lung tung khi có câu hỏi diễn ra"
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

const py = `from fpdf import FPDF
p = FPDF()
p.add_page(); p.set_font('Helvetica', size=14)
p.multi_cell(0, 8, 'Dai so tuyen tinh la mon hoc quan trong. Ma tran la bang so gom hang va cot. Dinh thuc la mot gia tri so duoc tinh tu ma tran vuong. Phep nhan ma tran co nhung tinh chat dac biet. Ma tran nghich dao ton tai khi dinh thuc khac khong. Nhung khai niem nay la nen tang cua mon hoc.')
p.output('/tmp/qa-pause.pdf')`;
spawnSync('python3', ['-c', py]);

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'deepseek', apiKey: 'fake', interactiveTeach: true }));
  const realSynth = window.speechSynthesis;
  let speaking = false;
  let cur = null;
  window.__qaSpeech = [];
  const m = {
    getVoices() { const r = realSynth?.getVoices?.(); return (r && r.length) ? r : [{ name: 'vi-VN - Mock', lang: 'vi-VN', voiceURI: 'm' }]; },
    speak(u) {
      speaking = true;
      cur = u;
      window.__qaSpeech.push('SPEAK:' + (u.text || '').slice(0, 18));
      setTimeout(() => u.onstart?.(), 20);
      const tt = 450 + Math.min(900, (u.text || '').length * 12);
      setTimeout(() => { if (cur === u) { cur = null; u.onend?.(); speaking = false; } }, tt);
    },
    cancel() {
      const u = cur;
      cur = null;
      speaking = false;
      window.__qaSpeech.push('CANCEL');
      if (u) queueMicrotask(() => u.onerror?.({ error: 'canceled' }));
    },
    pause() {},
    resume() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    get speaking() { return speaking; }, get pending() { return false; }, get paused() { return false; }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: m, writable: true, configurable: true });
  window.speechSynthesis.onvoiceschanged = null;
  try {
    Object.defineProperty(window.SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true, set(v) { this.__mockVoice = v; }, get() { return this.__mockVoice || null; }
    });
  } catch (e) {}
});

let teachBranch = 0;
await page.route('**/api/deepseek', async (route, req) => {
  const raw = req.postData() || '';
  console.log('=== REQ branch-hint:', raw.includes('voice_chunks'), raw.includes('after_chunk'), 'len:', raw.length);
  if (raw.includes('voice_chunks') && raw.includes('after_chunk')) {
    teachBranch++;
    const json = JSON.stringify({
      voice_chunks: [
        { text: 'chunk mot. Ma tran la bang so.', region_vert: [0, 0.33] },
        { text: 'chunk hai. Dinh thuc la gia tri.', region_vert: [0.33, 0.66] },
        { text: 'chunk ba. Ma tran nghich dao.', region_vert: [0.66, 1] }
      ],
      interactive_questions: [{
        after_chunk: 1, lead_in: 'Bây giờ tôi sẽ hỏi bạn câu này',
        question: 'Dinh thuc la gi?', options: ['Gia tri', 'Ma tran', 'So phuc', 'Vec to'],
        correct_index: 0, explanation: 'Dinh thuc la mot gia tri so.'
      }]
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
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrs.push(msg.text()); });

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(300);
await page.setInputFiles('#pdf-input', '/tmp/qa-pause.pdf');
await page.waitForTimeout(1200);
const modal = await page.$('#api-modal:not(.hidden)');
if (modal) await page.click('#close-modal', { force: true });
await page.waitForTimeout(300);

await page.click('#teach-now', { force: true });

await page.waitForTimeout(150);
const st0 = await page.textContent('#voice-text');
const btn0 = await page.textContent('#btn-play-pause');
console.log('before pause: btn=', JSON.stringify(btn0), 'status=', JSON.stringify(st0));

await page.click('#btn-play-pause', { force: true });
await page.waitForTimeout(200);
const st1 = await page.textContent('#voice-text');
const btn1 = await page.textContent('#btn-play-pause');
const speech1 = await page.evaluate(() => window.__qaSpeech.slice());
console.log('after pause: btn=' + JSON.stringify(btn1) + ' status=' + JSON.stringify(st1));
console.log('speech:', JSON.stringify(speech1.slice(-3)));

await page.click('#btn-play-pause', { force: true });
await page.waitForTimeout(200);
const speech2 = await page.evaluate(() => window.__qaSpeech.slice());
console.log('after resume speech:', JSON.stringify(speech2.slice(-3)));

await page.evaluate(() => {
  const s = document.getElementById('seek-slider');
  s.value = 75; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(300);
const st3 = await page.textContent('#voice-text');
const speech3 = await page.evaluate(() => window.__qaSpeech.slice());
console.log('after seek 75: status=' + JSON.stringify(st3) + ' speech=' + JSON.stringify(speech3.slice(-2)));

await page.evaluate(() => {
  const s = document.getElementById('seek-slider');
  s.value = 20; s.dispatchEvent(new Event('change'));
});
let qShown = false;
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(300);
  const t = await page.textContent('#voice-text').catch(() => '');
  if (t && t.includes('trả lời')) { qShown = true; break; }
}
console.log('question shown:', qShown);

if (qShown) {
  await page.click('#btn-play-pause', { force: true });
  await page.waitForTimeout(200);
  const btnQ = await page.textContent('#btn-play-pause');
  const stQ = await page.textContent('#voice-text');
  const speechQ = await page.evaluate(() => window.__qaSpeech.slice(-3));
  console.log('pause during wait: btn=' + JSON.stringify(btnQ) + ' status=' + JSON.stringify(stQ) + ' speech=' + JSON.stringify(speechQ));
}

console.log(consoleErrs.length ? 'console errors:\n' + consoleErrs.join('\n') : 'no console errors');
console.log('teachBranch=' + teachBranch);
process.exit(qShown ? 0 : 1);