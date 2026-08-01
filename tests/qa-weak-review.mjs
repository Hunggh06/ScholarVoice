// QA: weak page review loop — network interception + real 3-page PDF via fpdf
// Chạy: node tests/qa-weak-review.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF 3 trang HỢP LỆ bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF()
# Page 1 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad - bc. Neu dinh thuc khac 0 thi ma tran kha nghich.')
# Page 2 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Khong gian vector', ln=1)
p.multi_cell(0, 8, 'Khong gian vector R^n la tap hop cac bo n so thuc. Co so chinh tac cua R^n gom n vector don vi e1, e2, ..., en.')
# Page 3 — nội dung đầy đủ
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: He phuong trinh', ln=1)
p.multi_cell(0, 8, 'He phuong trinh tuyen tinh Ax = b co nghiem duy nhat khi va chi khi ma tran A kha nghich. Phuong phap Gauss dung bien doi so cap de giai he.')
p.output('/tmp/qa-weak-review.pdf')`;
const r = spawnSync('python3', ['-c', py]);
if (r.status !== 0) throw new Error('fpdf failed: ' + r.stderr.toString());

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// --- Set settings + seed quiz_scores TRƯỚC khi page load ---
await page.addInitScript(() => {
  localStorage.setItem('ai_settings', JSON.stringify({ provider: 'gemini', apiKey: 'fake-key' }));
  // Seed: page 1 (2/3 = 66% -> >= 60%, NOT weak), page 2 (1/3 = 33% -> WEAK), page 3 (1/5 = 20% -> WEAK)
  localStorage.setItem('quiz_scores_qa-weak-review.pdf', JSON.stringify({
    '1': { best: 2, last: 2, lastTime: Date.now(), attempts: 1, total: 3 },
    '2': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 3 },
    '3': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 5 }
  }));
});

// --- Chặn request tới Gemini: trả về 3 câu hỏi (đáp án A) ---
let apiCalls = 0;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push({
      type: 'mcq',
      question: `Cau hoi ${i + 1} ve dai so tuyen tinh`,
      options: ['Dap an dung', 'Dap an sai A', 'Dap an sai B', 'Dap an sai C'],
      correct_index: 0,
      explanation: `Day la giai thich cho cau ${i + 1}`
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

// Upload PDF thật 3 trang
await page.setInputFiles('#pdf-input', '/tmp/qa-weak-review.pdf');
await page.waitForTimeout(2000);

// === TEST 1: Mở tab Quiz → nút "Ôn tập trang yếu" hiển thị ===
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(2000);
const reviewBtnVisible = await page.evaluate(() => {
  const btn = document.querySelector('#quiz-review-btn');
  return btn && !btn.classList.contains('hidden');
});
console.log(reviewBtnVisible ? 'TEST 1 PASS: Nút Ôn tập trang yếu hiển thị' : 'TEST 1 FAIL: nút không hiển thị');
if (!reviewBtnVisible) throw new Error('TEST 1 FAIL: #quiz-review-btn không hiển thị (mong đợi 2 trang yếu)');

// === TEST 2: Click "Ôn tập trang yếu" → quiz sinh cho trang yếu đầu tiên (page 2) ===
await page.click('#quiz-review-btn', { force: true });
await page.waitForTimeout(2500);
let qText = await page.textContent('#quiz-question-text');
console.log('Review page 2 — question text:', qText);
if (!qText || !qText.includes('Câu 1/')) throw new Error(`TEST 2 FAIL: quiz không sinh cho trang yếu đầu tiên, got "${qText}"`);
console.log('TEST 2 PASS: quiz sinh cho trang yếu đầu tiên');

// === TEST 3: Trả lời đúng hết 3 câu (đáp án A — index 0) ===
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('.quiz-option:not([disabled])', { timeout: 5000 });
  // Click đáp án A (index 0)
  await page.evaluate(() => {
    const btn = document.querySelector('.quiz-option[data-idx="0"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  if (i < 2) {
    // Click "Câu tiếp" (2 lần đầu)
    await page.click('#quiz-next-btn', { force: true });
    await page.waitForTimeout(300);
  }
}
// Click "Xem kết quả" (câu cuối)
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(2000);
console.log('TEST 3 PASS: trả lời đúng hết 3 câu trang yếu 1');

// === TEST 4: Tự chuyển sang trang yếu kế tiếp (page 3) ===
qText = await page.textContent('#quiz-question-text');
console.log('Review page 3 — question text:', qText);
if (!qText || !qText.includes('Câu 1/')) throw new Error(`TEST 4 FAIL: không tự chuyển sang trang yếu kế tiếp, got "${qText}"`);
console.log('TEST 4 PASS: tự chuyển sang trang yếu kế tiếp');

// === TEST 5: Trả lời đúng hết → báo cáo hiển thị ===
for (let i = 0; i < 3; i++) {
  await page.waitForSelector('.quiz-option:not([disabled])', { timeout: 5000 });
  await page.evaluate(() => {
    const btn = document.querySelector('.quiz-option[data-idx="0"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(300);
  if (i < 2) {
    await page.click('#quiz-next-btn', { force: true });
    await page.waitForTimeout(300);
  }
}
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(2000);
console.log('TEST 5 PASS: trả lời đúng hết 3 câu trang yếu 2');

// === TEST 6: Báo cáo hiển thị — có "Trang 2" và "Trang 3" với ✅ ===
const reportHtml = await page.evaluate(() => {
  const el = document.querySelector('#quiz-review-list');
  return el ? el.innerHTML : '';
});
console.log('Báo cáo review:', reportHtml);
if (!reportHtml.includes('Trang 2')) throw new Error('TEST 6 FAIL: báo cáo không chứa "Trang 2"');
if (!reportHtml.includes('Trang 3')) throw new Error('TEST 6 FAIL: báo cáo không chứa "Trang 3"');
if (!reportHtml.includes('✅')) throw new Error('TEST 6 FAIL: báo cáo không có ✅ (mong đợi điểm tất cả đạt >= 60%)');
console.log('TEST 6 PASS: báo cáo hiển thị đúng');

// === TEST 7: Đóng báo cáo → nút "Ôn tập trang yếu" ẩn (vì tất cả đã đạt) ===
await page.click('#quiz-review-done-btn', { force: true });
await page.waitForTimeout(500);
const reviewBtnHidden = await page.evaluate(() => {
  const btn = document.querySelector('#quiz-review-btn');
  return btn && btn.classList.contains('hidden');
});
console.log(reviewBtnHidden ? 'TEST 7 PASS: nút Ôn tập ẩn' : 'TEST 7 FAIL: nút vẫn hiển thị');
if (!reviewBtnHidden) throw new Error('TEST 7 FAIL: #quiz-review-btn vẫn hiển thị sau khi tất cả trang đã đạt');

if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA weak review PASS');
await browser.close();
