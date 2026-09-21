/**
 * richtext.js — Boss 技能行富文本渲染（KaTeX + 元素颜色 + 代码强调）。
 * 数据源写法（content/boss/幽境boss.md 的技能引用行内）：
 *   - 元素/反应词着色：<span class="pyro">**火元素**</span>
 *   - 行内数学：$45%$、$0.4s$（KaTeX）
 *   - 特殊名词：反引号 `深黯护盾`
 *   - 加粗：**文字**
 */
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './colors.js';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderRichText(text) {
  const blocks = [];
  let idx = 0;
  const ph = () => `\x00RICH${'y'.repeat(++idx)}\x00`;

  // 1) 块公式 $$…$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, math) => {
    const key = ph();
    try {
      blocks.push({ key, html: `<div class="katex-wrap">${katex.renderToString(math.trim(), { displayMode: true, throwOnError: false, strict: false })}</div>` });
    } catch (e) {
      blocks.push({ key, html: `<pre class="katex-error">${escapeHtml(math)}</pre>` });
    }
    return key;
  });

  // 2) 行内公式 $…$
  text = text.replace(/(?<!\$)\$(?!\$)([^\n]+?)(?<!\$)\$(?!\$)/g, (_m, math) => {
    const key = ph();
    try {
      blocks.push({ key, html: `<span class="katex-inline">${katex.renderToString(math.trim(), { displayMode: false, throwOnError: false, strict: false })}</span>` });
    } catch (e) {
      blocks.push({ key, html: `<span class="katex-inline"><code class="katex-error">${escapeHtml(math)}</code></span>` });
    }
    return key;
  });

  // 3) 反引号代码 `…`
  text = text.replace(/`([^`]+?)`/g, (_m, code) => {
    const key = ph();
    blocks.push({ key, html: `<code>${escapeHtml(code)}</code>` });
    return key;
  });

  // 4) 颜色块 <span class="X">**文字**</span>
  text = text.replace(/<span class="([\w-]+)">((?:(?!<\/span>).)+?)<\/span>/g, (_m, cls, inner) => {
    const key = ph();
    inner = inner.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    blocks.push({ key, html: `<span class="${cls}">${inner}</span>` });
    return key;
  });

  // 5) 剩余 **加粗**
  text = text.replace(/\*\*(.+?)\*\*/g, (_m, inner) => {
    const key = ph();
    blocks.push({ key, html: `<strong>${escapeHtml(inner)}</strong>` });
    return key;
  });

  // 6) 转义剩余纯文本
  text = escapeHtml(text);

  // 7) 循环还原（支持嵌套占位）
  let result = text;
  const restoreOnce = () =>
    result.replace(/\x00RICH(y+)\x00/g, (_m, ys) => (blocks[ys.length - 1] ? blocks[ys.length - 1].html : _m));
  for (let guard = 0; guard <= blocks.length + 1; guard++) {
    const next = restoreOnce();
    if (next === result) break;
    result = next;
  }
  return result;
}
