/**
 * compact-json.mjs — 逐级数值数组压行的共用工具。
 * 90 级的属性曲线如果按常规缩进写会占 90 行，这里把「纯数值/纯 null 的数组」压成单行。
 * 只处理不含嵌套的数组，避免影响技能等级表这类对象数组。
 */

const NUMBER_ARRAY_RE = /\[[^[\]{}]*\]/g;
const PURE_NUMBERS_RE = /^\s*\[\s*(?:-?\d+(?:\.\d+)?|null)(?:\s*,\s*(?:-?\d+(?:\.\d+)?|null))*\s*\]\s*$/;

export function compactNumberArrays(json) {
  return json.replace(NUMBER_ARRAY_RE, (m) => {
    if (!PURE_NUMBERS_RE.test(m)) return m;
    return '[' + m.replace(/[[\]\s]/g, ' ').trim().split(/\s*,\s*/).join(', ') + ']';
  });
}

/** 写文件用：格式化 + 压行 */
export const formatJson = (obj) => compactNumberArrays(JSON.stringify(obj, null, 2)) + '\n';
