/*!
 * core.js — 確率の計算。DOM を触らないので node でテストできる。
 * ブラウザでは window.Core、node からは require() で使う。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') module.exports = factory();
  else root.Core = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 100% ↓: 100% から level% まで、ぜんぶ当てつづける確率 */
  function clearProb(level) {
    let q = 1;
    for (let k = 100; k >= level; k--) q *= k / 100;
    return q;
  }

  /** 1% ↑: 1%, 2%, … と上げていき、level% までのどこかで当たる確率 */
  function hitByProb(level) {
    let miss = 1;
    for (let k = 1; k <= level; k++) miss *= 1 - k / 100;
    return 1 - miss;
  }

  /** 1 回まわす。r は 0〜1 の乱数。止まった場所 (0〜100) がみどり (p% ぶん) なら当たり */
  function spinOnce(p, r) {
    const at = r * 100;
    return { ok: at < p, deg: at / 100 * 360 };
  }

  /** 決まった順番で数を出す乱数 (テスト用) */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { clearProb, hitByProb, spinOnce, mulberry32 };
});
