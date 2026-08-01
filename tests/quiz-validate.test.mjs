import assert from 'node:assert';
import { validateQuizQuestions } from '../js/ai-engine.js';

// JSON hợp lệ: 3 câu trộn MCQ + TF
const good = JSON.stringify({
  questions: [
    { type: 'mcq', question: 'Hàm số bậc nhất có dạng?', options: ['y=ax+b', 'y=ax²', 'y=a/x', 'y=|x|'], correct_index: 0, explanation: 'Vì dạng tổng quát là y=ax+b với a khác 0.' },
    { type: 'tf', question: 'Đồ thị hàm bậc nhất là đường thẳng.', correct: true, explanation: 'Đúng vậy.' },
    { type: 'mcq', question: 'Hệ số a quyết định?', options: ['Độ dốc', 'Màu sắc', 'Kích thước', 'Vị trí'], correct_index: 0, explanation: 'a quyết định độ dốc.' }
  ]
});
let q = validateQuizQuestions(good);
assert.strictEqual(q.length, 3, 'giữ đủ 3 câu');
assert.strictEqual(q[0].type, 'mcq');
assert.strictEqual(q[1].type, 'tf');
assert.strictEqual(q[1].correct, true);
assert.strictEqual(q[0].options.length, 4);

// JSON bị bọc trong markdown ```json ... ```
const wrapped = '```json\n' + good + '\n```';
assert.strictEqual(validateQuizQuestions(wrapped).length, 3, 'parse được JSON trong markdown block');

// JSON lỏng: thiếu trường → câu đó bị loại, câu còn lại giữ
const messy = JSON.stringify({ questions: [
  { type: 'mcq', question: 'Câu hỏi không đủ đáp án', options: ['A'], correct_index: 0, explanation: 'x' },
  { type: 'tf', question: 'Đúng hay sai?', correct: false, explanation: 'y' }
]});
q = validateQuizQuestions(messy);
assert.strictEqual(q.length, 1, 'chỉ giữ câu TF hợp lệ');
assert.strictEqual(q[0].type, 'tf');

// correct_index ngoài phạm vi → loại câu
const badIdx = JSON.stringify({ questions: [
  { type: 'mcq', question: 'x', options: ['A','B','C','D'], correct_index: 9, explanation: 'z' }
]});
assert.strictEqual(validateQuizQuestions(badIdx).length, 0, 'loại câu correct_index sai');

// Không phải JSON → mảng rỗng
assert.strictEqual(validateQuizQuestions('không phải json').length, 0);
assert.strictEqual(validateQuizQuestions(null).length, 0);
assert.strictEqual(validateQuizQuestions(undefined).length, 0);
assert.strictEqual(validateQuizQuestions('').length, 0);

// type không hợp lệ → loại
const badType = JSON.stringify({ questions: [
  { type: 'essay', question: 'x', correct: true, explanation: 'z' }
]});
assert.strictEqual(validateQuizQuestions(badType).length, 0, 'loại câu type lạ');

console.log('✅ quiz-validate: tất cả test pass');
