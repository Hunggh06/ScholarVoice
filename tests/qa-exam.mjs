// QA: cumulative exam flow — network interception + real 3-page PDF via fpdf
// Chạy: node tests/qa-exam.mjs  (cần server localhost:8080; tạo PDF thật bằng python3 fpdf)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

// --- Tạo PDF 3 trang HỢP LỆ bằng python3 + fpdf (đã cài sẵn 2.8.7) ---
const py = `from fpdf import FPDF
p = FPDF()
# Page 1 — nội dung đầy đủ (80% → không yếu)
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Ma tran', ln=1)
p.multi_cell(0, 8, 'Ma tran A cap 2x2 co dang [[a,b],[c,d]]. Dinh thuc cua ma tran A la ad - bc.')
# Page 2 — nội dung đầy đủ (33% → YẾU)
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: Khong gian vector', ln=1)
p.multi_cell(0, 8, 'Khong gian vector R^n la tap hop cac bo n so thuc. Co so chinh tac cua R^n gom n vector don vi.')
# Page 3 — nội dung đầy đủ (20% → YẾU)
p.add_page(); p.set_font('Helvetica', size=14)
p.cell(0, 10, 'Dai so tuyen tinh: He phuong trinh', ln=1)
p.multi_cell(0, 8, 'He phuong trinh tuyen tinh Ax = b co nghiem duy nhat khi va chi khi ma tran A kha nghich.')
p.output('/tmp/qa-exam.pdf')`;
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
  // Seed: page 1 (80% → NOT weak), page 2 (33% → WEAK), page 3 (20% → WEAK)
  localStorage.setItem('quiz_scores_qa-exam.pdf', JSON.stringify({
    '1': { best: 4, last: 4, lastTime: Date.now(), attempts: 1, total: 5 },
    '2': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 3 },
    '3': { best: 1, last: 1, lastTime: Date.now(), attempts: 1, total: 5 }
  }));
});

// --- Chặn request tới Gemini: trả về 3 câu hỏi mỗi lần gọi ---
let apiCalls = 0;
await page.route('**generativelanguage.googleapis.com/**', async (route) => {
  apiCalls++;
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push({
      type: 'mcq',
      question: `Cau hoi ${apiCalls}-${i + 1} ve dai so tuyen tinh`,
      options: ['Dap an dung', 'Dap an sai A', 'Dap an sai B', 'Dap an sai C'],
      correct_index: 0,
      explanation: `Day la giai thich cho cau API call ${apiCalls}, cau ${i + 1}`
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
await page.setInputFiles('#pdf-input', '/tmp/qa-exam.pdf');
await page.waitForTimeout(2000);

// === TEST (a): Exam button enabled after PDF load ===
const examEnabled = await page.evaluate(() => {
  const btn = document.querySelector('#exam-start-btn');
  return btn && !btn.disabled;
});
console.log('TEST (a): exam-start-btn enabled =', examEnabled);
if (!examEnabled) throw new Error('TEST (a) FAIL: #exam-start-btn not enabled after PDF load with weak pages');

// === PRE-FLIGHT: single-page quiz on page 2 (1 API call) ===
// Navigate to page 2 via #next-page button (no thumbnails in this app)
await page.click('#next-page', { force: true });
await page.waitForTimeout(1500);

// Open quiz tab (auto-generates for page 2)
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(3000);

let qText = await page.textContent('#quiz-question-text');
console.log('Page 2 quiz question:', qText);

const apiBeforeExam = apiCalls;
console.log(`API calls before exam: ${apiBeforeExam} (expected: 1 for page-2 quiz)`);

// Close quiz without answering (scores NOT saved)
await page.evaluate(() => document.querySelector('#quiz-close-btn')?.click());
await page.waitForTimeout(300);

// === TEST (b): Start exam → first question shows page-2 source label ===
await page.evaluate(() => document.querySelector('#exam-start-btn')?.click());
await page.waitForTimeout(5000);

qText = await page.textContent('#quiz-question-text');
console.log('First exam question:', qText);
if (!qText.includes('Đề ôn')) throw new Error(`TEST (b) FAIL: exam header not shown, got "${qText}"`);
if (!qText.includes('Trang 2')) throw new Error(`TEST (b) FAIL: source label for page 2 not shown, got "${qText}"`);

// === TEST (c): Questions sequential by page — page-2 questions before page-3 ===
// Answer first 3 questions (page 2) — check they have page-2 source
for (let i = 0; i < 3; i++) {
  qText = await page.textContent('#quiz-question-text');
  if (!qText.includes('Trang 2') && !qText.includes('(Trang 2)')) {
    throw new Error(`TEST (c) FAIL: question ${i + 1} not from page 2, got "${qText}"`);
  }
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

// Answer last 3 questions (page 3)
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(300);
for (let i = 0; i < 3; i++) {
  qText = await page.textContent('#quiz-question-text');
  if (!qText.includes('Trang 3') && !qText.includes('(Trang 3)')) {
    throw new Error(`TEST (c) FAIL: question ${4 + i} not from page 3, got "${qText}"`);
  }
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
console.log('TEST (c) PASS: questions sequential by page (page-2 before page-3)');

// Last click → "Xem kết quả"
await page.click('#quiz-next-btn', { force: true });
await page.waitForTimeout(1000);

// === TEST (d): Result shows "6/6" + per-page report ===
const resultHtml = await page.evaluate(() => {
  const el = document.querySelector('#quiz-result-score');
  return el ? el.innerHTML : '';
});
console.log('Exam result HTML:', resultHtml);
if (!resultHtml.includes('6/6')) throw new Error(`TEST (d) FAIL: expected 6/6 in result, got "${resultHtml}"`);
if (!resultHtml.includes('Trang 2')) throw new Error('TEST (d) FAIL: result missing "Trang 2" report line');
if (!resultHtml.includes('Trang 3')) throw new Error('TEST (d) FAIL: result missing "Trang 3" report line');
console.log('TEST (d) PASS: result shows 6/6 + per-page report');

// === TEST (e): quiz_scores in localStorage UNCHANGED after exam ===
const scoresAfter = await page.evaluate(() => {
  return JSON.parse(localStorage.getItem('quiz_scores_qa-exam.pdf') || '{}');
});
// Page 2 should still be {best:1,total:3}, page 3 should still be {best:1,total:5}
if (scoresAfter['2'].best !== 1 || scoresAfter['2'].total !== 3) {
  throw new Error(`TEST (e) FAIL: page 2 scores modified: best=${scoresAfter['2'].best}, total=${scoresAfter['2'].total}`);
}
if (scoresAfter['3'].best !== 1 || scoresAfter['3'].total !== 5) {
  throw new Error(`TEST (e) FAIL: page 3 scores modified: best=${scoresAfter['3'].best}, total=${scoresAfter['3'].total}`);
}
console.log('TEST (e) PASS: quiz_scores unchanged after exam');

// === TEST (f): API call count proves cache was cleared ===
// Before exam: 1 call (single-page quiz on page 2)
// Exam: 2 calls (1 for page 2 + 1 for page 3 = fresh questions for each)
const apiAfterExam = apiCalls;
console.log(`API calls: before=${apiBeforeExam}, after=${apiAfterExam}, total=${apiAfterExam}`);
if (apiAfterExam < apiBeforeExam + 2) {
  throw new Error(`TEST (f) FAIL: expected at least ${apiBeforeExam + 2} total API calls (1 quiz + 2 exam pages fresh), got ${apiAfterExam}`);
}
console.log('TEST (f) PASS: API call count proves cache was cleared (2 new calls for 2 weak pages)');

// === TEST (g): After closing exam, single-page quiz still works (no _examMode leak) ===
await page.evaluate(() => document.querySelector('#quiz-close-btn')?.click());
await page.waitForTimeout(500);

// Navigate to page 1 via prev-page button (exam left us on page 3, need 2 clicks)
await page.click('#prev-page', { force: true });
await page.waitForTimeout(1000);
await page.click('#prev-page', { force: true });
await page.waitForTimeout(1000);

// Open quiz tab → should auto-generate quiz for page 1 normally
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(3000);

qText = await page.textContent('#quiz-question-text');
console.log('Post-exam quiz question:', qText);
if (!qText || !qText.includes('Câu 1/')) {
  throw new Error(`TEST (g) FAIL: single-page quiz not working after exam, got "${qText}"`);
}
console.log('TEST (g) PASS: single-page quiz works after closing exam (no _examMode leak)');

if (errors.length > 0) {
  console.log('ERRORS TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ QA exam PASS');
await browser.close();
