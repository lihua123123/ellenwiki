/**
 * json-diff.mjs — 两个 JSON 对象的递归差异（供「精确复查单条」把本地条目与数据源条目对比）。
 *
 * 输出「路径 + 本地值 → 数据源值」的清单；纯数值数组（武器逐级曲线、90 级属性等）
 * 压成一条摘要（哪一项不同、示例几处），避免刷屏。
 *
 * 差异条目 kind：
 *   changed     普通值不同
 *   onlyRemote  本地没有、数据源有（覆盖后会新增该字段）
 *   onlyLocal   本地有、数据源没有（覆盖后会保留该字段，见 sources 的 mergeEntry）
 *   length      数组长度不同
 *   items       纯数值数组里有若干处不同
 */

const isPrimitive = (v) => v === null || typeof v !== 'object';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 空值：报告里不值得单独列出来的字段（空串 / null / 空数组 / 空对象） */
export const isEmptyValue = (v) => v === undefined || v === null || v === ''
  || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

export const showValue = (v, max = 60) => {
  if (v === undefined) return '（无）';
  if (v === null) return 'null';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export function diffJson(a, b, path = '') {
  /* 空值（'' / null / [] / {}）与「没有」等价：本地有、源空 = 源给不出（覆盖后保留本地值）；
   * 本地空、源有 = 源新增内容。这样报告里不会出现一堆「值 → 空」的伪差异。 */
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty && bEmpty) return [];
  if (!aEmpty && bEmpty) return [{ path: path || '(根)', kind: 'onlyLocal', from: a }];
  if (aEmpty && !bEmpty) return [{ path: path || '(根)', kind: 'onlyRemote', to: b }];

  if (isPrimitive(a) || isPrimitive(b)) {
    if (same(a, b)) return [];
    /* 长文本：只报「长度 + 首处差异」，不然整段刷屏 */
    if (typeof a === 'string' && typeof b === 'string' && (a.length > 40 || b.length > 40)) {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      const at = Math.max(0, i - 10);
      return [{
        path: path || '(根)',
        kind: 'text',
        from: `${a.length} 字`,
        to: `${b.length} 字`,
        snippetFrom: a.slice(at, at + 40),
        snippetTo: b.slice(at, at + 40),
        at,
      }];
    }
    return [{ path: path || '(根)', kind: 'changed', from: a, to: b }];
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return [{ path, kind: 'length', from: `${a.length} 项`, to: `${b.length} 项` }];
    }
    if (a.every(isPrimitive) && b.every(isPrimitive)) {
      const idx = a.map((_, i) => i).filter((i) => !same(a[i], b[i]));
      if (!idx.length) return [];
      return [{
        path,
        kind: 'items',
        total: a.length,
        count: idx.length,
        sample: idx.slice(0, 3).map((i) => ({ i, from: a[i], to: b[i] })),
      }];
    }
    const out = [];
    a.forEach((v, i) => out.push(...diffJson(v, b[i], `${path}[${i}]`)));
    return out;
  }

  const out = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a)) {
      if (!isEmptyValue(b[k])) out.push({ path: p, kind: 'onlyRemote', to: b[k] });
    } else if (!(k in b)) {
      /* 本地是空值（'' / null / [] / {}）的不算差异，否则每个条目都会多几十行噪音 */
      if (!isEmptyValue(a[k])) out.push({ path: p, kind: 'onlyLocal', from: a[k] });
    } else out.push(...diffJson(a[k], b[k], p));
  }
  return out;
}

/** 差异清单 → 可读文本 */
export function formatDiff(changes, { indent = '   ' } = {}) {
  if (!changes.length) return `${indent}（无差异）`;
  return changes
    .map((c) => {
      switch (c.kind) {
        case 'onlyRemote':
          return `${indent}+ ${c.path}：本地无 → 源 ${showValue(c.to)}`;
        case 'onlyLocal':
          return `${indent}− ${c.path}：本地 ${showValue(c.from)} → 源无（覆盖后保留本地值）`;
        case 'length':
          return `${indent}~ ${c.path}：数组 ${c.from} → ${c.to}`;
        case 'items':
          return `${indent}~ ${c.path}：${c.total} 项中 ${c.count} 处不同`
            + c.sample.map((s) => `\n${indent}    [${s.i}] ${showValue(s.from, 30)} → ${showValue(s.to, 30)}`).join('');
        case 'text':
          return `${indent}~ ${c.path}：文本不同（本地 ${c.from} → 源 ${c.to}，首个差异在第 ${c.at} 字）`
            + `\n${indent}    本地：…${c.snippetFrom}…`
            + `\n${indent}    　源：…${c.snippetTo}…`;
        default:
          return `${indent}~ ${c.path}：${showValue(c.from)} → ${showValue(c.to)}`;
      }
    })
    .join('\n');
}

/** 一句话摘要（用于批量场景） */
export const diffSummary = (changes) => {
  if (!changes.length) return '一致';
  const n = (k) => changes.filter((c) => c.kind === k).length;
  const parts = [`${changes.length} 处不同`];
  if (n('onlyRemote')) parts.push(`新增字段 ${n('onlyRemote')}`);
  if (n('onlyLocal')) parts.push(`源缺字段 ${n('onlyLocal')}`);
  return parts.join('，');
};
