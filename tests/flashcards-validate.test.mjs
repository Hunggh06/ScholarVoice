import assert from 'node:assert';
import { validateFlashcards } from '../js/ai-engine.js';

// JSON hợp lệ: 5 cặp term-definition
const good = JSON.stringify({
  cards: [
    { term: 'Định thức', definition: 'Định thức của ma trận vuông cấp 2 A = [[a,b],[c,d]] được tính là ad - bc.' },
    { term: 'Ma trận đơn vị', definition: 'Ma trận vuông có các phần tử trên đường chéo chính bằng 1, còn lại bằng 0.' },
    { term: 'Vector', definition: 'Đại lượng có hướng và độ lớn.' },
    { term: 'Hàm số', definition: 'Quy tắc gán mỗi phần tử của tập A với duy nhất một phần tử của tập B.' },
    { term: 'Đạo hàm', definition: 'Giới hạn của tỉ số giữa số gia của hàm số và số gia của đối số.' }
  ]
});
let cards = validateFlashcards(good);
assert.strictEqual(cards.length, 5, 'giữ đủ 5 thẻ');
assert.strictEqual(cards[0].term, 'Định thức');
assert.strictEqual(cards[0].definition.startsWith('Định thức của'), true);
assert.strictEqual(cards[1].term, 'Ma trận đơn vị');

// JSON bị bọc trong markdown ```json ... ```
const wrapped = '```json\n' + good + '\n```';
assert.strictEqual(validateFlashcards(wrapped).length, 5, 'parse được JSON trong markdown block');

// JSON lỏng: thiếu term → câu đó bị loại
const missingTerm = JSON.stringify({ cards: [
  { term: '', definition: 'Không có term.' },
  { term: 'Hợp lệ', definition: 'Có term và definition.' }
]});
cards = validateFlashcards(missingTerm);
assert.strictEqual(cards.length, 1, 'loại thẻ không có term');
assert.strictEqual(cards[0].term, 'Hợp lệ');

// JSON lỏng: thiếu definition → câu đó bị loại
const missingDef = JSON.stringify({ cards: [
  { term: 'Không có def', definition: '' },
  { term: 'Có đủ', definition: 'Định nghĩa đầy đủ.' }
]});
cards = validateFlashcards(missingDef);
assert.strictEqual(cards.length, 1, 'loại thẻ không có definition');

// Definition > 200 ký tự → bị cắt
const longDef = JSON.stringify({ cards: [
  { term: 'Dài', definition: 'A'.repeat(250) }
]});
cards = validateFlashcards(longDef);
assert.strictEqual(cards.length, 1, 'giữ thẻ có definition dài (đã cắt)');
assert.strictEqual(cards[0].definition.length, 200, 'definition bị cắt về 200 ký tự');

// Trim term và definition
const hasWhitespace = JSON.stringify({ cards: [
  { term: '  Thuật ngữ   ', definition: '   Định nghĩa có khoảng trắng.   ' }
]});
cards = validateFlashcards(hasWhitespace);
assert.strictEqual(cards[0].term, 'Thuật ngữ', 'trim term');
assert.strictEqual(cards[0].definition, 'Định nghĩa có khoảng trắng.', 'trim definition');

// Không phải JSON → mảng rỗng
assert.strictEqual(validateFlashcards('không phải json').length, 0);
assert.strictEqual(validateFlashcards(null).length, 0);
assert.strictEqual(validateFlashcards(undefined).length, 0);
assert.strictEqual(validateFlashcards('').length, 0);

// Fallback regex block JSON
const regexBlock = 'Đây là text bên ngoài {"cards": [{"term": "X", "definition": "Y"}]} và text khác';
cards = validateFlashcards(regexBlock);
assert.strictEqual(cards.length, 1, 'fallback regex JSON block có "cards"');
assert.strictEqual(cards[0].term, 'X');

console.log('✅ flashcards-validate: tất cả test pass');
