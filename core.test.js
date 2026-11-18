const test = require('node:test');
const assert = require('node:assert');
const C = require('./core.js');

test('100% は かならず クリア、0% にはならない', () => {
  assert.strictEqual(C.clearProb(100), 1);
  assert.ok(Math.abs(C.clearProb(99) - 0.99) < 1e-12);
  assert.ok(C.clearProb(1) > 0);
});

test('1% ↑ は 100% までに かならず あたる', () => {
  assert.ok(Math.abs(C.hitByProb(1) - 0.01) < 1e-12);
  assert.strictEqual(C.hitByProb(100), 1);
});

test('止まった場所がみどりの中なら あたり。玉の角度は止まった場所に合う', () => {
  assert.deepStrictEqual(C.spinOnce(50, 0.25), { ok: true, deg: 90 });
  assert.strictEqual(C.spinOnce(50, 0.5).ok, false);
  assert.strictEqual(C.spinOnce(100, 0.9999).ok, true);
  assert.strictEqual(C.spinOnce(1, 0.0101).ok, false);
});

test('画面に出す確率は、実際に遊んだ割合と合う (20 万回)', () => {
  const rng = C.mulberry32(11);
  const N = 200000;
  // 100% ↓: 何% まで来られたか
  let reach90 = 0;
  // 1% ↑: 10% までに あたったか
  let hit10 = 0;
  for (let n = 0; n < N; n++) {
    let p = 100;
    while (p > 0 && C.spinOnce(p, rng()).ok) p--;
    if (p + 1 <= 90) reach90++;
    let q = 1;
    while (!C.spinOnce(q, rng()).ok) q++;
    if (q <= 10) hit10++;
  }
  const a = reach90 / N, b = hit10 / N;
  assert.ok(Math.abs(a - C.clearProb(90)) < 0.005, `90% まで: 実際 ${a.toFixed(4)} / 計算 ${C.clearProb(90).toFixed(4)}`);
  assert.ok(Math.abs(b - C.hitByProb(10)) < 0.005, `10% までに: 実際 ${b.toFixed(4)} / 計算 ${C.hitByProb(10).toFixed(4)}`);
});
