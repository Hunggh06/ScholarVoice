import assert from 'node:assert';
import { detectTitleSlide } from '../js/title-detect.js';

// Slide tiêu đề: <= 20 từ sau khi làm sạch
assert.strictEqual(detectTitleSlide('Chương 3: Hàm số bậc nhất'), true, 'tiêu đề ngắn');
assert.strictEqual(detectTitleSlide('PHẦN 2 — GIẢI TÍCH'), true, 'tiêu đề phần');
assert.strictEqual(detectTitleSlide('  Chương 1  '), true, 'tiêu đề có khoảng trắng thừa');

// Slide nội dung: > 20 từ
const content = 'Hàm số bậc nhất có dạng y = ax + b với a khác 0. Đồ thị của hàm số bậc nhất là một đường thẳng. Hệ số a quyết định độ dốc của đường thẳng đó.';
assert.strictEqual(detectTitleSlide(content), false, 'nội dung dài');

// Text rỗng / null / undefined → false (an toàn, giảng bình thường)
assert.strictEqual(detectTitleSlide(''), false, 'rỗng');
assert.strictEqual(detectTitleSlide(null), false, 'null');
assert.strictEqual(detectTitleSlide(undefined), false, 'undefined');
assert.strictEqual(detectTitleSlide('   '), false, 'chỉ khoảng trắng');

// Nhiều ký tự đặc biệt (markdown heading) vẫn đếm đúng
assert.strictEqual(detectTitleSlide('## Chương 5: Tích phân'), true, 'heading markdown');

console.log('✅ title-detect: tất cả test pass');
