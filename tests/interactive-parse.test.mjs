// Node v20 không có global localStorage (Node 22+) — AIEngine constructor đọc ai_settings từ localStorage
const store2 = new Map();
global.localStorage = {
  getItem: (k) => (store2.has(k) ? store2.get(k) : null),
  setItem: (k, v) => store2.set(k, String(v)),
  removeItem: (k) => store2.delete(k),
  clear: () => store2.clear(),
};

import assert from 'node:assert';
import { AIEngine } from '../js/ai-engine.js';

const engine = new AIEngine();

// ====================
// _extractVoiceChunks
// ====================

// TEST V1: valid voice_chunks
const validJson = {
  voice_chunks: [
    { text: 'Chunk 1', region_vert: [0, 0.3] },
    { text: 'Chunk 2', region_vert: [0.3, 0.7] },
    { text: 'Chunk 3', region_vert: [0.7, 1.0] }
  ]
};
let chunks = engine._extractVoiceChunks(validJson, 'fallback text');
assert.strictEqual(chunks.length, 3, 'V1: 3 chunks');
assert.strictEqual(chunks[0].text, 'Chunk 1');
assert.deepStrictEqual(chunks[0].regionVert, [0, 0.3]);
assert.strictEqual(chunks[2].text, 'Chunk 3');
console.log('TEST V1 PASS: valid voice_chunks (3 chunks)');

// TEST V2: voice_chunks là array rỗng → fallback single chunk
let jsonEmpty = { voice_chunks: [] };
chunks = engine._extractVoiceChunks(jsonEmpty, 'fallback text');
assert.strictEqual(chunks.length, 1, 'V2: fallback single chunk');
assert.strictEqual(chunks[0].text, 'fallback text');
assert.deepStrictEqual(chunks[0].regionVert, [0, 1]);
console.log('TEST V2 PASS: empty voice_chunks → fallback');

// TEST V3: thiếu field voice_chunks → fallback
chunks = engine._extractVoiceChunks({}, 'fallback');
assert.strictEqual(chunks.length, 1, 'V3: missing field → fallback');
assert.strictEqual(chunks[0].text, 'fallback');
console.log('TEST V3 PASS: missing voice_chunks → fallback');

// TEST V4: voice_chunks không phải array → fallback
chunks = engine._extractVoiceChunks({ voice_chunks: 'not-array' }, 'fb');
assert.strictEqual(chunks.length, 1, 'V4: non-array → fallback');
assert.strictEqual(chunks[0].text, 'fb');
console.log('TEST V4 PASS: non-array voice_chunks → fallback');

// TEST V5: chunk thiếu text → bỏ qua chunk đó (không thêm vào kết quả)
let jsonBadChunk = {
  voice_chunks: [
    { region_vert: [0, 0.3] },
    { text: 'Good chunk', region_vert: [0.3, 0.7] },
    { text: '' },
    { text: null }
  ]
};
chunks = engine._extractVoiceChunks(jsonBadChunk, 'fb');
assert.strictEqual(chunks.length, 1, 'V5: only valid chunk kept');
assert.strictEqual(chunks[0].text, 'Good chunk');
console.log('TEST V5 PASS: chunk missing/empty text → filtered out');

// TEST V6: null json → fallback
chunks = engine._extractVoiceChunks(null, 'fb');
assert.strictEqual(chunks.length, 1, 'V6: null → fallback');
console.log('TEST V6 PASS: null json → fallback');

// ============================
// _extractInteractiveQuestions
// ============================

const voiceChunks = [
  { text: 'Chunk 0', regionVert: [0, 0.3] },
  { text: 'Chunk 1', regionVert: [0.3, 0.7] },
  { text: 'Chunk 2', regionVert: [0.7, 1.0] }
];

// TEST Q1: valid interactive_questions
const validIQ = {
  interactive_questions: [
    { after_chunk: 0, question: 'Câu hỏi 1?', options: ['A', 'B', 'C', 'D'], correct_index: 1, explanation: 'Giải thích.' },
    { after_chunk: 1, question: 'Câu hỏi 2?', options: ['D1', 'D2', 'D3', 'D4'], correct_index: 0, explanation: 'exp' }
  ]
};
// Note: voiceChunks has 3 chunks (indices 0,1,2), after_chunk up to 2 (max = length-1 = 2)
let questions = engine._extractInteractiveQuestions(validIQ, voiceChunks);
assert.strictEqual(questions.length, 2, 'Q1: 2 questions');
assert.strictEqual(questions[0].after_chunk, 0);
assert.strictEqual(questions[0].question, 'Câu hỏi 1?');
assert.strictEqual(questions[0].options.length, 4);
assert.strictEqual(questions[0].correct_index, 1);
assert.strictEqual(questions[0].explanation, 'Giải thích.');
console.log('TEST Q1 PASS: valid interactive_questions (2 questions)');

// TEST Q2: interactive_questions empty array → []
questions = engine._extractInteractiveQuestions({ interactive_questions: [] }, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q2: empty → []');
console.log('TEST Q2 PASS: empty array → []');

// TEST Q3: missing field → []
questions = engine._extractInteractiveQuestions({}, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q3: missing → []');
console.log('TEST Q3 PASS: missing field → []');

// TEST Q4: not array → []
questions = engine._extractInteractiveQuestions({ interactive_questions: 'wrong' }, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q4: non-array → []');
console.log('TEST Q4 PASS: non-array → []');

// TEST Q5: after_chunk out of range (> length-1) → filtered; last chunk index (length-1) is valid now
let jsonBadAC = {
  interactive_questions: [
    { after_chunk: 0, question: 'Q1', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' },
    { after_chunk: 2, question: 'Q2', options: ['X', 'Y', 'Z', 'W'], correct_index: 0, explanation: 'e' }, // = length-1 → valid
    { after_chunk: 3, question: 'Q3', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' }, // out of range: max = 3-1=2
    { after_chunk: -1, question: 'Q4', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' } // negative
  ]
};
questions = engine._extractInteractiveQuestions(jsonBadAC, voiceChunks);
assert.strictEqual(questions.length, 2, 'Q5: 2 valid questions (after_chunk 0 and 2)');
assert.strictEqual(questions[0].after_chunk, 0);
assert.strictEqual(questions[1].after_chunk, 2);
console.log('TEST Q5 PASS: after_chunk = length-1 valid, out-of-range/negative filtered');

// TEST Q6: correct_index out of 0-3 → filtered
let jsonBadCI = {
  interactive_questions: [
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' },
    { after_chunk: 1, question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 5, explanation: 'e' }
  ]
};
questions = engine._extractInteractiveQuestions(jsonBadCI, voiceChunks);
assert.strictEqual(questions.length, 1, 'Q6: bad correct_index filtered');
console.log('TEST Q6 PASS: out-of-range correct_index filtered');

// TEST Q7: options.length !== 4 → filtered
let jsonBadOpts = {
  interactive_questions: [
    { after_chunk: 0, question: 'Q', options: ['A', 'B'], correct_index: 0, explanation: 'e' },
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D', 'E'], correct_index: 0, explanation: 'e' },
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' }
  ]
};
questions = engine._extractInteractiveQuestions(jsonBadOpts, voiceChunks);
assert.strictEqual(questions.length, 1, 'Q7: wrong option length filtered');
console.log('TEST Q7 PASS: options.length !== 4 filtered');

// TEST Q8: missing required field → filtered
let jsonBadField = {
  interactive_questions: [
    { question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' }, // missing after_chunk
    { after_chunk: 0, options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' }, // missing question
    { after_chunk: 0, question: 'Q', correct_index: 0, explanation: 'e' }, // missing options
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D'], explanation: 'e' }, // missing correct_index
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 0 } // missing explanation
  ]
};
questions = engine._extractInteractiveQuestions(jsonBadField, voiceChunks);
assert.strictEqual(questions.length, 0, 'Q8: all filtered due to missing fields');
console.log('TEST Q8 PASS: missing required fields → filtered');

// TEST Q9: null json → []
questions = engine._extractInteractiveQuestions(null, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q9: null → []');
console.log('TEST Q9 PASS: null json → []');

// TEST Q10: voiceChunks is null/empty → all questions filtered (after_chunk validation fails)
questions = engine._extractInteractiveQuestions(validIQ, null);
assert.deepStrictEqual(questions, [], 'Q10: null voiceChunks → all filtered');
questions = engine._extractInteractiveQuestions(validIQ, []);
assert.deepStrictEqual(questions, [], 'Q10b: empty voiceChunks → all filtered');
console.log('TEST Q10 PASS: null/empty voiceChunks → all filtered');

// TEST Q11: single chunk voiceChunks → only after_chunk 0 allowed (max = 1-1 = 0)
questions = engine._extractInteractiveQuestions(validIQ, [{ text: 'Single', regionVert: [0, 1] }]);
assert.strictEqual(questions.length, 1, 'Q11: single chunk → after_chunk 0 (last chunk) allowed');
assert.strictEqual(questions[0].after_chunk, 0);
console.log('TEST Q11 PASS: single chunk → question at last chunk allowed');

// TEST Q12: voiceChunks.length = 2 → after_chunk max = 1 (last chunk index = 1 also allowed)
const twoChunks = [{ text: 'C0' }, { text: 'C1' }];
let jsonQ12 = {
  interactive_questions: [
    { after_chunk: 0, question: 'Q', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' }
  ]
};
questions = engine._extractInteractiveQuestions(jsonQ12, twoChunks);
assert.strictEqual(questions.length, 1, 'Q12: 2 chunks, after_chunk 0 is valid');
console.log('TEST Q12 PASS: 2 chunks, after_chunk 0 valid');

// TEST Q13: strictly increasing after_chunk enforced — duplicate → []
let jsonDup = {
  interactive_questions: [
    { after_chunk: 0, question: 'Q1', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' },
    { after_chunk: 0, question: 'Q2', options: ['X', 'Y', 'Z', 'W'], correct_index: 1, explanation: 'e' } // duplicate after_chunk
  ]
};
questions = engine._extractInteractiveQuestions(jsonDup, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q13: duplicate after_chunk → []');
console.log('TEST Q13 PASS: duplicate after_chunk → []');

// TEST Q14: non-monotonic after_chunk — decreasing → []
let jsonDec = {
  interactive_questions: [
    { after_chunk: 1, question: 'Q1', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'e' },
    { after_chunk: 0, question: 'Q2', options: ['X', 'Y', 'Z', 'W'], correct_index: 0, explanation: 'e' } // smaller after_chunk
  ]
};
questions = engine._extractInteractiveQuestions(jsonDec, voiceChunks);
assert.deepStrictEqual(questions, [], 'Q14: non-monotonic after_chunk → []');
console.log('TEST Q14 PASS: non-monotonic after_chunk → []');

// TEST Q15: DeepSeek real output — 5 chunks, question after final chunk (after_chunk = 4 = length-1)
const deepseekChunks = [
  { text: 'C0', regionVert: [0, 0.2] },
  { text: 'C1', regionVert: [0.2, 0.4] },
  { text: 'C2', regionVert: [0.4, 0.6] },
  { text: 'C3', regionVert: [0.6, 0.8] },
  { text: 'C4', regionVert: [0.8, 1.0] }
];
let jsonDeepseek = {
  voice_chunks: deepseekChunks,
  interactive_questions: [
    { after_chunk: 4, question: 'Hỏi cuối bài?', options: ['A', 'B', 'C', 'D'], correct_index: 2, explanation: 'Vì DeepSeek đặt câu hỏi cuối.' }
  ]
};
questions = engine._extractInteractiveQuestions(jsonDeepseek, deepseekChunks);
assert.strictEqual(questions.length, 1, 'Q15: question after final chunk accepted');
assert.strictEqual(questions[0].after_chunk, 4);
console.log('TEST Q15 PASS: DeepSeek question after final chunk accepted');

console.log('✅ interactive-parse: tất cả test pass (V1-V6 + Q1-Q15 = 21/21)');
