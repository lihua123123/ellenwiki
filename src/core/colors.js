/**
 * colors.js — 元素配色注入。
 * 基础八元素取 src/data/palette.json（与 tokens.css 同一数据源），
 * 月反应 / 星超导等渐变仍由 content/meta/colors.json 提供。
 * 生成带作用域的 CSS 选择器： .scope-genshin .pyro { color: ... }
 * 渐变色通过 background-clip:text 实现文字渐变（含 KaTeX 内联公式文本层）。
 */
import baseColors from '../../content/meta/colors.json';
import palette from '../data/palette.json';

/* genshin 基础元素色 = palette.element[*].color（保留原有键名与顺序） */
const genshin = { ...baseColors.genshin };
for (const [key, el] of Object.entries(palette.element)) {
  genshin[key] = el.color.hex;
}

const colors = { ...baseColors, genshin };

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
