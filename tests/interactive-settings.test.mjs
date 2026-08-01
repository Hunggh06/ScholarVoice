// Node v20 không có global localStorage (Node 22+) — AIEngine constructor đọc ai_settings từ localStorage
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

import assert from 'node:assert';
import { AIEngine } from '../js/ai-engine.js';

// Cleanup
localStorage.clear();

// TEST 1: default true khi chưa có setting
let engine = new AIEngine();
assert.strictEqual(engine.interactiveTeach, true, 'default is true');
console.log('TEST 1 PASS: default true');

// TEST 2: đọc từ localStorage false
localStorage.setItem('ai_settings', JSON.stringify({ interactiveTeach: false }));
engine = new AIEngine();
assert.strictEqual(engine.interactiveTeach, false, 'reads false from localStorage');
console.log('TEST 2 PASS: reads false');

// TEST 3: saveSettings ghi + getSettings export
engine.saveSettings({ interactiveTeach: false });
const settings = engine.getSettings();
assert.strictEqual(settings.interactiveTeach, false, 'saveSettings + getSettings roundtrip');
const raw = JSON.parse(localStorage.getItem('ai_settings'));
assert.strictEqual(raw.interactiveTeach, false, 'localStorage persisted');
console.log('TEST 3 PASS: saveSettings + getSettings roundtrip');

// TEST 4: saveSettings exclude → keep current value
engine.saveSettings({ apiKey: 'test-key' });
const s4 = engine.getSettings();
assert.strictEqual(s4.interactiveTeach, false, 'unchanged when not in saveSettings params');
console.log('TEST 4 PASS: unchanged when excluded from saveSettings');

// TEST 5: saveSettings toggle back to true
engine.saveSettings({ interactiveTeach: true });
assert.strictEqual(engine.interactiveTeach, true, 'toggle back to true');
console.log('TEST 5 PASS: toggle back to true');

localStorage.clear();
console.log('✅ interactive-settings: tất cả test pass (5/5)');
