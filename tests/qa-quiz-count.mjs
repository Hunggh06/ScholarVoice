// QA: quiz count dropdown — network interception + real PDF via fpdf
// Chạy: node tests/qa-quiz-count.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF HỢP LỆ thật bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF(); p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran va dinh thuc', ln=1)
p.multi_cell(0, 8, 'Dinh thuc cua ma tran vuong cap 2 A = [[a,b],[c,d]] duoc tinh la ad - bc. Ma tran don vi I co dinh thuc bang 1. Phep nhan ma tran khong giao hoan.')
p.output('/tmp/qa-real.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings TRƯỚC khi page load: provider gemini + api key giả → không bị modal chặn ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
});

// --- Chặn request tới Gemini: đếm số lần gọi + trả về đúng N câu theo "Tạo CHÍNH XÁC N câu hỏi" trong body ---
let apiCalls = 0;
let lastCount = null;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const req = route.request();
  let count = 3;
  try {
    const body = req.postData() || '';
    const m = body.match(/Tạo CHÍNH XÁC (\d+) câu hỏi/);
    if (m) count = parseInt(m[1], 10);
  } catch {}
  lastCount = count;
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push({
      type: 'mcq',
      question: `Câu hỏi ${i + 1} về định thức`,
      options: ['ad - bc', 'a + d', 'ab + cd', 'a*d'],
      correct_index: 0,
      explanation: `Vì định thức cấp 2 bằng ad trừ bc. Câu ${i + 1}`
    });
  }
  const payload = JSON.stringify({ questions });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: payload }] } }] })
  });
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// Upload PDF thật (hợp lệ, fpdf tạo)
await page.setInputFiles('#pdf-input', '/tmp/qa-real.pdf');
await page.waitForTimeout(2000);

// === TEST 1: dropdown mặc định 3 → mở tab quiz (tự sinh) → assert "Câu 1/3" ===
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(2000);
let qText = await page.textContent('#quiz-question-text');
console.log('Mặc định → question text:', qText);
if (!qText.includes('Câu 1/3')) throw new Error(`TEST 1 FAIL: expected "Câu 1/3", got "${qText}"`);

// === TEST 2: chọn 5 → "Làm lại" → assert "Câu 1/5" ===
await page.selectOption('#quiz-count', '5', { force: true });
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('#quiz-retry-btn').click());
await page.waitForTimeout(2000);
qText = await page.textContent('#quiz-question-text');
console.log('Chọn 5 → question text:', qText);
if (!qText.includes('Câu 1/5')) throw new Error(`TEST 2 FAIL: expected "Câu 1/5", got "${qText}"`);
if (lastCount !== 5) throw new Error(`TEST 2 FAIL: AI nhận count=${lastCount}, expected 5`);

// === TEST 3: chọn 10 → "Làm lại" → assert "Câu 1/10" ===
await page.selectOption('#quiz-count', '10', { force: true });
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('#quiz-retry-btn').click());
await page.waitForTimeout(2000);
qText = await page.textContent('#quiz-question-text');
console.log('Chọn 10 → question text:', qText);
if (!qText.includes('Câu 1/10')) throw new Error(`TEST 3 FAIL: expected "Câu 1/10", got "${qText}"`);
if (lastCount !== 10) throw new Error(`TEST 3 FAIL: AI nhận count=${lastCount}, expected 10`);

// === TEST 4: đổi dropdown khi đang xem quiz → KHÔNG gọi API thêm ===
const callsBefore = apiCalls;
await page.selectOption('#quiz-count', '3', { force: true });
await page.waitForTimeout(1500);
console.log('API calls before:', callsBefore, 'after:', apiCalls);
if (apiCalls !== callsBefore) throw new Error(`TEST 4 FAIL: đổi dropdown tự sinh lại quiz (API gọi thêm ${apiCalls - callsBefore} lần)`);

if (errors.length > 0) {
  console.log('LỖI TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA quiz count PASS');
await browser.close();
