/**
 * colors.js — 元素配色单一数据源注入。
 * 读取 content/meta/colors.json，按游戏分组生成带作用域的 CSS 选择器：
 *   .scope-genshin .pyro { color: ... }
 * 渐变色通过 background-clip:text 实现文字渐变（含 KaTeX 内联公式文本层）。
 */
import colors from '../../content/meta/colors.json';

if (typeof document !== 'undefined' && !document.getElementById('element-colors')) {
  const style = document.createElement('style');
  style.id = 'element-colors';
  style.textContent = Object.entries(colors)
    .flatMap(([game, map]) =>
      Object.entries(map).map(([name, color]) => {
        const sel = `.scope-${game} .${name}`;
        if (typeof color === 'string' && color.includes('linear-gradient')) {
          return `${sel} { background: ${color}; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }\n${sel} .katex-inline .katex-html .base { background: ${color}; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }`;
        }
        return `${sel} { color: ${color}; }`;
      })
    )
    .join('\n');
  document.head.appendChild(style);
}

export default colors;
