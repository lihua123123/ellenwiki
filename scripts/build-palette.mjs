#!/usr/bin/env node
/**
 * build-palette.mjs — 由 src/data/palette.json 生成 src/styles/tokens.css。
 * 配色单一数据源：改 palette.json → 跑 npm run palette（或 dev/build 自动跑）→ tokens.css 更新。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const palette = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/palette.json'), 'utf8'));

const hex = (v) => (typeof v === 'string' ? v : v?.hex ?? '');
const lines = [];

const push = (...xs) => lines.push(...xs);

push('/* 由 scripts/build-palette.mjs 从 src/data/palette.json 生成，请勿手改。 */');
push(':root {');

// ── 表面 ──
push('  /* 表面 */');
const surfaceMap = {
  body: '--bg-body',
  elevated: '--bg-elev',
  card: '--bg-card',
  code: '--bg-code',
  hover: '--bg-hover',
  nav: '--nav-bg',
  input: '--bg-input',
};
for (const [k, name] of Object.entries(surfaceMap)) {
  const v = palette.foundation.surface[k];
  if (v) push(`  ${name}: ${hex(v)};`);
}
push(
  `  --card-bg: linear-gradient(180deg, ${hex(palette.foundation.surface.cardTop)} 0%, rgba(255, 255, 255, 0.008) 100%), ${hex(palette.foundation.surface.card)};`,
  '  --card-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.05);',
);

// ── 文字 ──
push('  /* 文字 */');
const textMap = {
  primary: '--text-main',
  secondary: '--text-secondary',
  heading: '--text-heading',
  muted: '--text-muted',
  onAccent: '--text-on-accent',
};
for (const [k, name] of Object.entries(textMap)) {
  const v = palette.foundation.text[k];
  if (v) push(`  ${name}: ${hex(v)};`);
}

// ── 描边 ──
push('  /* 描边 */');
push(`  --border-color: ${hex(palette.foundation.border.hairline)};`);
push(`  --border-strong: ${hex(palette.foundation.border.strong)};`);

// ── 强调 ──
push('  /* 强调 */');
push(`  --accent: ${hex(palette.foundation.accent.base)};`);
push(`  --accent-light: ${hex(palette.foundation.accent.light)};`);
push(`  --accent-deep: ${hex(palette.foundation.accent.deep)};`);
push(`  --accent-soft: ${hex(palette.foundation.accent.soft)};`);
push(`  --accent-gradient: ${hex(palette.foundation.accent.gradient)};`);

// ── 状态 ──
push('  /* 状态 */');
for (const [k, v] of Object.entries(palette.foundation.state)) {
  push(`  --state-${k}: ${hex(v)};`);
}

// ── UI 语义 ──
push('  /* UI 语义 */');
push(`  --buff-color: ${hex(palette.ui.buff)};`);
push(`  --skill-color: ${hex(palette.ui.skill)};`);
push(`  --link-color: ${hex(palette.ui.link)};`);
push(`  --mark-bg: ${hex(palette.ui.mark)};`);
push(`  --mark-text: ${hex(palette.ui.markText)};`);
push(`  --bar-hp: ${hex(palette.ui.hpBar)};`);
push(`  --bar-hp-low: ${hex(palette.ui.lowHpBar)};`);
push(`  --bar-energy: ${hex(palette.ui.energyBar)};`);
push(`  --bar-stamina: ${hex(palette.ui.staminaBar)};`);
push(`  --shadow-color: ${hex(palette.ui.shadow)};`);
push(
  '  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);',
  '  --shadow-md: 0 6px 18px rgba(0, 0, 0, 0.35);',
  '  --shadow-lg: 0 14px 36px rgba(0, 0, 0, 0.45);',
);

// ── 元素 ──
push('  /* 元素 */');
for (const [key, el] of Object.entries(palette.element)) {
  const p = `--el-${key}`;
  push(`  ${p}: ${hex(el.color)};`);
  push(`  ${p}-soft: ${hex(el.soft)};`);
  push(`  ${p}-text: ${hex(el.text)};`);
  push(`  ${p}-number: ${hex(el.number)};`);
  push(`  ${p}-shield: ${hex(el.shield)};`);
  push(`  ${p}-vision: ${hex(el.vision)};`);
  push(`  ${p}-vision-border: ${hex(el.visionBorder)};`);
  push(`  ${p}-wish: ${hex(el.wish)};`);
  push(`  ${p}-tcg: ${hex(el.tcg)};`);
  push(`  ${p}-resonance: ${hex(el.resonance)};`);
}

// ── 稀有度 ──
push('  /* 稀有度 */');
for (const [star, r] of Object.entries(palette.rarity)) {
  const p = `--rarity-${star}`;
  push(`  ${p}-text: ${hex(r.text)};`);
  push(`  ${p}-bg: ${hex(r.bg)};`);
  push(`  ${p}-border: ${hex(r.border)};`);
  push(`  ${p}-item: ${hex(r.itemBg)};`);
}

// ── 反应（供富文本/图例使用）──
push('  /* 元素反应 */');
for (const [key, r] of Object.entries(palette.reaction)) {
  push(`  --rx-${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${r.hex};`);
  for (const [ek, ev] of Object.entries(r.extra || {})) {
    push(`  --rx-${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}-${ek}: ${ev};`);
  }
}

push('}');
push('');

// 元素文字类（.pyro / .rt-physical …）统一由 token 驱动
push('/* 元素文字类：正文里 **火元素** 之类 */');
const elClasses = [];
for (const [key, el] of Object.entries(palette.element)) {
  elClasses.push(`.${el.className} { color: var(--el-${key}); }`);
}
push(elClasses.join('\n'));
push('');

// 稀有度快捷类
push('/* 稀有度快捷类 */');
const rarityClasses = [];
for (const star of ['5', '4', '3', '2', '1']) {
  rarityClasses.push(`.rarity-${star} { color: var(--rarity-${star}-text); }`);
}
rarityClasses.push('.rarity-special5 { color: var(--rarity-special5-text); }');
push(rarityClasses.join('\n'));
push('');

const out = path.join(ROOT, 'src/styles/tokens.css');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`✅ tokens.css 已生成（${lines.length} 行，元素 ${Object.keys(palette.element).length} · 稀有度 ${Object.keys(palette.rarity).length}）`);
