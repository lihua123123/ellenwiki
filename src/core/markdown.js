/**
 * markdown.js — 统一 Markdown 渲染器（公式页 / 附着页共用）。
 * 支持：$$块公式$$ 与 $行内公式$（KaTeX）、==高亮==、元素配色 span、
 * 标题锚点 id、宽表格横向滚动包裹、按 h2 切分章节卡片。
 */
import { marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import '../styles/markdown.css';
import './colors.js';

// marked v14 不再生成标题 id，用自定义 heading renderer 从纯文本生成 id，
// 使文档内锚点链接（如 [加权规则](#加权规则)）可以跳转。
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = text
        .replace(/<[^>]+>/g, '')
        .replace(/["'<>\\/]/g, '')
        .trim();
      return id
        ? `<h${depth} id="${id}">${text}</h${depth}>\n`
        : `<h${depth}>${text}</h${depth}>\n`;
    },
  },
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 渲染 markdown 为 HTML。
 * @param {string} text md 源文本
 */
export function renderMarkdown(text) {
  text = String(text).replace(/^\uFEFF/, '');

  const blocks = [];
  let idx = 0;
  const placeholder = () => `\x00MATH_${idx++}\x00`;

  // 块公式 $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, math) => {
    const key = placeholder();
    try {
      const body = `\\def\\arraystretch{1.6} ${math.trim()}`;
      const rendered = katex.renderToString(body, {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
      blocks.push({ key, html: `<div class="katex-wrap">${rendered}</div>` });
    } catch (e) {
      blocks.push({ key, html: `<pre class="katex-error">${escapeHtml(math)}</pre>` });
    }
    return key;
  });

  // 行内公式 $...$（避开 $$）
  text = text.replace(/(?<!\$)\$(?!\$)([^\n]+?)(?<!\$)\$(?!\$)/g, (_m, math) => {
    const key = placeholder();
    try {
      blocks.push({
        key,
        html: `<span class="katex-inline">${katex.renderToString(math.trim(), {
          displayMode: false,
          throwOnError: false,
          strict: false,
        })}</span>`,
      });
    } catch (e) {
      blocks.push({
        key,
        html: `<span class="katex-inline"><code class="katex-error">${escapeHtml(math)}</code></span>`,
      });
    }
    return key;
  });

  // ==highlight== → <mark>
  text = text.replace(/==([^=]+?)==/g, '<mark>$1</mark>');

  // marked 在 CJK 文本中对 ** 定界符解析不可靠，提前统一转成 <strong>
  text = text.replace(/\*\*((?:(?!\*\*).)+?)\*\*/g, '<strong>$1</strong>');

  let html = marked.parse(text, { gfm: true, breaks: true });

  // 宽表格横向滚动包裹
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>');
  html = html.replace(/<\/table>/g, '</table></div>');

  // 还原公式占位符（全局按索引替换， marked 改写/重排也能还原）
  let result = html;
  result = result.replace(/\x00MATH_(\d+)\x00/g, (_m, n) => {
    const block = blocks[Number(n)];
    return block ? block.html : _m;
  });
  // 兜底：NUL 分隔符被剥离时的容错匹配
  result = result.replace(/([^\dA-Za-z]|^)MATH_(\d+)(?=\D|$)/g, (_m, pre, n) => {
    const block = blocks[Number(n)];
    return block ? `${pre}${block.html}` : _m;
  });

  // 章节卡片化：按 h2 切段，清理段间 <hr>
  result = result.replace(/<hr>\s*(?=<h2[\s>])/g, '');
  result = result
    .split(/(?=<h2[\s>])/)
    .map(seg => (seg.trim() ? `<div class="section-card">${seg}</div>` : ''))
    .join('');
  result = result.replace(/<hr>\s*<\/div>/g, '</div>');

  return result;
}
