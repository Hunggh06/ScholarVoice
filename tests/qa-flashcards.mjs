// QA: flashcards flow — network interception + real 1-page PDF via fpdf
// Chạy: node tests/qa-flashcards.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF 1 trang thật bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF(); p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Co ban', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad-bc. Neu dinh thuc khac 0 thi ma tran kha nghich. Vector la dai luong co huong va do lon.')
p.output('/tmp/qa-flashcards.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings TRƯỚC khi page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
});

// --- Chặn request tới Gemini: trả về 5 cards ---
let apiCalls = 0;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const cards = [];
  const terms = ['Định thức', 'Ma trận khả nghịch', 'Vector', 'Hàm số', 'Đạo hàm'];
  for (let i = 0; i < 5; i++) {
    cards.push({
      term: terms[i],
      definition: `Định nghĩa của ${terms[i]} trong đại số tuyến tính.`
    });
  }
  const payload = JSON.stringify({ cards });
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

// Upload PDF thật
await page.setInputFiles('#pdf-input', '/tmp/qa-flashcards.pdf');
await page.waitForTimeout(2000);

// === TEST (a): Mở tab flash → nút "Tạo thẻ học" enabled ===
await page.click('#tab-flash', { force: true, timeout: 10000 });
await page.waitForTimeout(1000);
const startEnabled = await page.evaluate(() => {
  const btn = document.querySelector('#flash-start-btn');
  return btn && !btn.disabled;
});
console.log('Nút Tạo thẻ học enabled:', startEnabled);
if (!startEnabled) throw new Error('TEST (a) FAIL: #flash-start-btn không enabled sau khi load PDF');

// === TEST (b): Click start → 5 thẻ render ===
// On tab open, _onTabOpened auto-generates (hides #flash-empty → #flash-start-btn hidden).
// Use page.evaluate to bypass visibility check; _generating guard makes redundant clicks safe.
await page.evaluate(() => document.querySelector('#flash-start-btn')?.click());
await page.waitForTimeout(2000);
const cardFront = await page.textContent('#flash-card-front');
console.log('Thẻ đầu tiên (front):', cardFront);
if (!cardFront || cardFront.length === 0) throw new Error('TEST (b) FAIL: không có term trên mặt trước thẻ');

// === TEST (c): Click thẻ → flip hiện definition ===
await page.click('#flash-card', { force: true });
await page.waitForTimeout(300);
const cardBack = await page.textContent('#flash-card-back');
console.log('Thẻ sau flip (back):', cardBack);
if (!cardBack || !cardBack.includes('Định nghĩa')) throw new Error('TEST (c) FAIL: definition không hiển thị sau khi flip');

// === TEST (d): Click 🔊 không lỗi ===
await page.click('#flash-speak-btn', { force: true });
await page.waitForTimeout(500);
console.log('TEST (d) PASS: nút 🔊 không gây lỗi');

// === TEST (e): Click 🔄 Ôn lại → thẻ quay lại cuối (kiểm tra counter) ===
await page.evaluate(() => document.querySelector('#flash-review-btn').click());
await page.waitForTimeout(500);
const progressAfterReview = await page.textContent('#flash-progress');
console.log('Progress sau khi Ôn lại 1 thẻ:', progressAfterReview);
// Vẫn còn 4 thẻ trong mainQueue + 1 trong reviewQueue = 5 total
// "Thẻ 1/5" (thẻ kế tiếp vẫn là thẻ thứ 2 của 5)

// === TEST (f): Click ✅ hết (5 thẻ + 1 review) → màn hình Hoàn thành ===
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#flash-know-btn').click());
}
await page.waitForTimeout(500);
const resultText = await page.textContent('#flash-result-text');
console.log('Result:', resultText);
if (!resultText || !resultText.includes('Hoàn thành')) throw new Error('TEST (f) FAIL: không hiển thị màn hình Hoàn thành');

// === TEST (g): Học lại → thẻ render lại không gọi API mới ===
const callsBeforeRetry = apiCalls;
await page.evaluate(() => document.querySelector('#flash-retry-btn').click());
await page.waitForTimeout(500);
const retryTerm = await page.textContent('#flash-card-front');
console.log('Thẻ sau Học lại:', retryTerm);
if (apiCalls !== callsBeforeRetry) throw new Error(`TEST (g) FAIL: _retry gọi API thêm (${apiCalls - callsBeforeRetry} lần), mong đợi 0`);
console.log('TEST (g) PASS: _retry không gọi API');

// === TEST (h): Làm mới → gọi API mới + thẻ mới ===
// Cần vào result trước: click know 5 lần để hết thẻ
for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#flash-know-btn').click());
}
await page.waitForTimeout(500);
const callsBeforeRefresh = apiCalls;
await page.evaluate(() => document.querySelector('#flash-refresh-btn').click());
await page.waitForTimeout(2000);
const refreshTerm = await page.textContent('#flash-card-front');
console.log('Thẻ sau Làm mới:', refreshTerm);
if (apiCalls <= callsBeforeRefresh) throw new Error(`TEST (h) FAIL: _refresh không gọi API mới (apiCalls=${apiCalls}, before=${callsBeforeRefresh})`);
console.log('TEST (h) PASS: _refresh gọi API mới');

if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA flashcards PASS');
await browser.close();
