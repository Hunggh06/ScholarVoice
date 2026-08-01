const store = new Map();
global.localStorage = {
  getItem: (k) => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

import assert from 'node:assert';
import { AIEngine } from '../js/ai-engine.js';

const engine = new AIEngine();

const fakeImage = 'data:image/png;base64,' + 'A'.repeat(200);

const mockResponse = JSON.stringify({
  voice_chunks: [
    { text: 'Nội dung giảng cho chunk 0.', region_vert: [0, 0.3] },
    { text: 'Nội dung cho chunk 1.', region_vert: [0.3, 0.7] },
    { text: 'Nội dung cho chunk 2.', region_vert: [0.7, 1.0] }
  ],
  interactive_questions: [
    {
      after_chunk: 0,
      question: 'Câu hỏi kiểm tra?',
      options: ['A', 'B', 'C', 'D'],
      correct_index: 1,
      explanation: 'Giải thích đáp án.'
    }
  ]
});

let capturedSystemPrompt = null;
const origCallAPI = engine._callAPI;
engine._callAPI = async (prompt, image, systemPrompt, jsonMode, pageText) => {
  capturedSystemPrompt = systemPrompt;
  return mockResponse;
};

const result = await engine.teachPage(fakeImage, 1, 'Test page content');
assert.ok(result, 'T1: result exists');
assert.ok(result.voice_text, 'T1: voice_text exists');
assert.ok(Array.isArray(result.voice_chunks), 'T1: voice_chunks is array');
assert.strictEqual(result.voice_chunks.length, 3, 'T1: 3 voice chunks');
assert.strictEqual(result.voice_chunks[0].text, 'Nội dung giảng cho chunk 0.');
assert.deepStrictEqual(result.voice_chunks[0].regionVert, [0, 0.3]);
assert.ok(Array.isArray(result.interactive_questions), 'T1: interactive_questions is array');
assert.strictEqual(result.interactive_questions.length, 1, 'T1: 1 interactive question');
assert.strictEqual(result.interactive_questions[0].after_chunk, 0);
assert.strictEqual(result.interactive_questions[0].question, 'Câu hỏi kiểm tra?');
assert.strictEqual(result.isTitleSlide, false, 'T1: isTitleSlide false');
console.log('PASS T1: teachPage parses voice_chunks + interactive_questions from mock response');

assert.ok(capturedSystemPrompt && capturedSystemPrompt.includes('TƯƠNG TÁC HỎI ĐÁP'),
  'T2: system prompt contains TƯƠNG TÁC HỎI ĐÁP');
console.log('PASS T2: system prompt has TƯƠNG TÁC HỎI ĐÁP instructions');

engine.pageCache.clear();
engine.pageCache.set('page_2_gemini_medium', 'old cached string value');
const cachedStr = await engine.teachPage(null, 2, 'test');
assert.strictEqual(typeof cachedStr, 'object', 'T3: string cache returns object');
assert.strictEqual(cachedStr.voice_text, 'old cached string value', 'T3: voice_text from string');
assert.ok(!cachedStr.voice_chunks, 'T3: no voice_chunks in legacy string cache');
assert.ok(!cachedStr.interactive_questions, 'T3: no interactive_questions in legacy string cache');
console.log('PASS T3: legacy string cache entry → object without new fields');

engine.pageCache.clear();
engine.pageCache.set('page_3_gemini_medium', { voice_text: 'cached text', segments: null, isTitleSlide: false });
const cachedOld = await engine.teachPage(null, 3, 'test');
assert.strictEqual(cachedOld.voice_text, 'cached text', 'T4: old object cache hit');
assert.strictEqual(cachedOld.segments, null, 'T4: segments null');
assert.strictEqual(cachedOld.isTitleSlide, false, 'T4: isTitleSlide false');
assert.ok(!cachedOld.voice_chunks, 'T4: no voice_chunks in old cache entry');
assert.ok(!cachedOld.interactive_questions, 'T4: no interactive_questions in old cache entry');
console.log('PASS T4: old cache entry (no new fields) → works unchanged');

engine._callAPI = origCallAPI;

console.log('✅ teach-page-response: tất cả test pass (4/4)');
