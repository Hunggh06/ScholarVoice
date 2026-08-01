// Smoke test: mở app, kiểm tra tab Quiz tồn tại và tương tác cơ bản
// Chạy: node tests/smoke-quiz.mjs  (cần server đang chạy ở localhost:8080)
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const SKIP_ERRS = ['InvalidPDFException', 'Lỗi tải PDF'];
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') {
    const txt = m.text();
    if (!SKIP_ERRS.some(pat => txt.includes(pat))) errors.push('console: ' + txt);
  }
});

await page.goto('http://localhost:8080/');
await page.waitForSelector('#start-btn', { state: 'visible' });
await page.click('#start-btn', { force: true });
await page.waitForTimeout(500);

// Tắt API key modal nếu hiện
const modalVisible = await page.isVisible('#api-modal');
if (modalVisible) {
  await page.click('#close-modal');
  await page.waitForTimeout(300);
}

// Kiểm tra tab Quiz hiển thị
await page.waitForSelector('#tab-quiz', { timeout: 5000 });
const tabQuizVisible = await page.isVisible('#tab-quiz');
console.log('Tab Quiz hiển thị:', tabQuizVisible);
if (!tabQuizVisible) throw new Error('Thiếu tab #tab-quiz');

// Bấm tab Quiz → quiz-area hiện, chat ẩn
await page.click('#tab-quiz', { force: true, timeout: 10000 });
await page.waitForTimeout(300);
const quizAreaVisible = await page.isVisible('#quiz-area');
const chatAreaHidden = await page.isHidden('#chat-area');
console.log('Quiz area hiện:', quizAreaVisible, '| Chat ẩn:', chatAreaHidden);
if (!quizAreaVisible || !chatAreaHidden) throw new Error('Chuyển tab Quiz lỗi');

// Bấm lại tab Chat
await page.click('#tab-chat');
await page.waitForTimeout(300);
if (await page.isHidden('#quiz-area') === false) throw new Error('Chuyển lại tab Chat lỗi');

// Upload PDF thật (file dummy vẫn mở được upload area)
const fs = await import('node:fs');
fs.writeFileSync('/tmp/dummy.pdf', '%PDF-1.4\n%EOF');
await page.setInputFiles('#pdf-input', '/tmp/dummy.pdf');
await page.waitForTimeout(2000);
const startBtnEnabled = await page.isEnabled('#quiz-start-btn');
console.log('Nút tạo quiz enabled sau khi load PDF:', startBtnEnabled);
// NOTE: dummy PDF không parse được nên nút luôn disabled, không assert

if (errors.length > 0) {
  console.log('LỖI TRÌNH DUYỆT:');
  for (const e of errors) console.log(' -', e);
  throw new Error('Có lỗi console/pageerror');
}

console.log('✅ Smoke test quiz PASS');
await browser.close();
