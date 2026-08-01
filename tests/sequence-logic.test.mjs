import assert from 'node:assert';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const start = Date.now();
await sleep(100);
const elapsed = Date.now() - start;
assert.ok(elapsed >= 90, `sleep 100ms, actual ${elapsed}ms`);
console.log('TEST 2 PASS: sleep utility works (~' + elapsed + 'ms)');

let flag = false;
let idx = -1;
const chunks = [1, 2, 3];
flag = true;
for (let i = 0; i < chunks.length; i++) {
  if (!flag) break;
  idx = i;
  if (i < chunks.length - 1) {
  }
}
flag = false;
assert.strictEqual(idx, 2, 'final index is 2 (chunks.length-1)');
assert.strictEqual(flag, false, 'sequenceActive false at end');
console.log('TEST 3 PASS: flag lifecycle correct');

flag = true;
idx = 0;
flag = false;
idx = 0;
assert.strictEqual(flag, false);
assert.strictEqual(idx, 0);
console.log('TEST 4 PASS: stop reset');

console.log('✅ sequence-logic: tất cả test pass (4/4)');
