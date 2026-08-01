import assert from 'node:assert';
import { getWeakPagesFromScores } from '../js/quiz.js';

// === TEST 1: Normal mix — page 1 (80% → NOT weak), page 2 (33% → WEAK), page 5 (20% → WEAK) ===
const normal = {
  '1': { best: 4, total: 5 },
  '2': { best: 1, total: 3 },
  '5': { best: 1, total: 5 }
};
let result = getWeakPagesFromScores(normal);
assert.deepStrictEqual(result, [2, 5], 'TEST 1: only pages 2 and 5 are weak');
console.log('TEST 1 PASS: normal weak pages');

// === TEST 2: All-pass — all >= 60% → empty ===
const allPass = {
  '1': { best: 3, total: 3 },
  '2': { best: 4, total: 5 },
  '3': { best: 5, total: 5 }
};
result = getWeakPagesFromScores(allPass);
assert.deepStrictEqual(result, [], 'TEST 2: no weak pages');
console.log('TEST 2 PASS: all-pass pages → empty');

// === TEST 3: Empty scores → empty ===
result = getWeakPagesFromScores({});
assert.deepStrictEqual(result, [], 'TEST 3: empty scores → empty');
console.log('TEST 3 PASS: empty scores');

// === TEST 4: Mixed with total = 0 (no attempts yet) → NOT weak ===
const mixed = {
  '1': { best: 0, total: 0 },
  '2': { best: 1, total: 3 },
  '5': { best: 0, total: 0 }
};
result = getWeakPagesFromScores(mixed);
assert.deepStrictEqual(result, [2], 'TEST 4: total=0 pages excluded, page 2 is weak');
console.log('TEST 4 PASS: mixed with total=0');

// === TEST 5: Threshold edge — exactly 60% → NOT weak ===
const edge = {
  '1': { best: 3, total: 5 },  // 60% exactly → NOT weak
  '2': { best: 2, total: 5 }   // 40% → WEAK
};
result = getWeakPagesFromScores(edge);
assert.deepStrictEqual(result, [2], 'TEST 5: exactly 60% is NOT weak');
console.log('TEST 5 PASS: threshold edge (60% not weak)');

// === TEST 6: Missing total field → treated as 0, excluded ===
const missingTotal = {
  '1': { best: 1 },           // no total → total=0 → excluded
  '2': { best: 1, total: 3 }  // 33% → WEAK
};
result = getWeakPagesFromScores(missingTotal);
assert.deepStrictEqual(result, [2], 'TEST 6: missing total → excluded');
console.log('TEST 6 PASS: missing total field');

// === TEST 7: Custom threshold (0.5) — page 1 (80% no), page 2 (33% yes), page 5 (20% yes) ===
// NOTE: plan expected [2] but that omits page 5 (1/5 = 20% < 0.5). Implementation correctly includes it.
result = getWeakPagesFromScores(normal, 0.5);
assert.deepStrictEqual(result, [2, 5], 'TEST 7: with threshold 0.5, both pages 2 (33%) and 5 (20%) are weak');
console.log('TEST 7 PASS: custom threshold');

// === TEST 8: Large page number ordering — page 10 (20%), page 2 (33%), page 25 (0%) all weak, sorted ===
// NOTE: plan expected [2, 25] but that omits page 10 (1/5 = 20% < 0.6). Implementation correctly includes it.
const largePage = {
  '10': { best: 1, total: 5 },
  '2': { best: 1, total: 3 },
  '25': { best: 0, total: 5 }
};
result = getWeakPagesFromScores(largePage);
assert.deepStrictEqual(result, [2, 10, 25], 'TEST 8: sorted ascending [2, 10, 25] (all three under 60%)');
console.log('TEST 8 PASS: large page number ordering');

// === TEST 9: null/undefined score entries → filtered ===
const badEntries = {
  '1': null,
  '2': { best: 1, total: 3 },
  '3': undefined
};
result = getWeakPagesFromScores(badEntries);
assert.deepStrictEqual(result, [2], 'TEST 9: null/undefined entries filtered');
console.log('TEST 9 PASS: null/undefined entries');

console.log('✅ exam-weak-pages: tất cả test pass (9/9)');
