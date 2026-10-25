/**
 * charge-num.js — 产球数量的「精确表示」工具。
 *
 * 为什么需要：区间产球（如 0~1 个（1:2））的期望是 2/3 球，写成 0.67 就是错的。
 * 约定：
 *   · 内部计算一律用数值（2/3 → 0.6666…），不做四舍五入；
 *   · 填写与展示用最精确的写法 ——
 *       期望能写成有限小数的（0.45、2.25、3.5）就写小数；
 *       写不成有限小数的（2/3、4/3、10/3）写分数；
 *   · 只有最终计算结果（充能要求百分比）才保留 1 位小数。
 */

/** 解析填写值：支持数字、"2/3"、"9 / 20" 这类分数写法 */
export function parseCount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den === 0 ? 0 : Number(frac[1]) / den;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* 连分数找最小分母（容差 1e-9）；找不到返回 null */
function toFraction(x, maxDen = 64) {
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(x * d);
    if (Math.abs(x - n / d) < 1e-9) return { n, d };
  }
  return null;
}

/* 分母只含 2 和 5 时，该分数一定能写成有限小数 */
function terminates(d) {
  let x = d;
  while (x % 2 === 0) x /= 2;
  while (x % 5 === 0) x /= 5;
  return x === 1;
}

/**
 * 把数值编码成「最精确的填写 / 展示形式」：
 *   2/3 → "2/3"；4/3 → "4/3"；0.45 → "0.45"；3.5 → "3.5"；5 → 5（数字）
 */
export function encodeCount(v) {
  const x = parseCount(v) || 0;
  if (Number.isInteger(x)) return x;
  const f = toFraction(x);
  if (f && !terminates(f.d)) return `${f.n}/${f.d}`;
  return Math.round(x * 100) / 100;
}

/** 展示用：永远返回字符串（整数 → "5"，分数 → "2/3"） */
export function formatCount(v) {
  return String(encodeCount(v));
}
