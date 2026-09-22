/**
 * fetch-avatars2.mjs — 用 genshin-db 的 filename_icon 从 enka CDN 补齐缺失头像。
 * 文件名规则：https://enka.network/ui/<filename_icon>.png
 */
import { createRequire } from 'module';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const GDB = require('genshin-db');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = join(ROOT, 'content', 'characters', 'images');

const { characters: charData, elementIds } = await import('../src/data/characters.js');
const localNames = elementIds.flatMap(el => (charData[el] || []).map(c => c.name));

const ALIASES = {
  '茜特拉莉': 'Citlali',

  '旅行者（冰）': 'Traveler (Cryo)',
  '旅行者（火）': 'Traveler (Pyro)',
  '旅行者（水）': 'Traveler (Hydro)',
  '旅行者（雷）': 'Traveler (Electro)',
  '旅行者（风）': 'Traveler (Anemo)',
  '旅行者（岩）': 'Traveler (Geo)',
  '旅行者（草）': 'Traveler (Dendro)',
};

/* 中文名 → 英文名 */
const enNames = GDB.characters('names', { matchCategories: true });
const zhToEn = {};
for (const en of enNames) {
  const info = GDB.characters(en, { resultLanguage: 'ChineseSimplified' });
  if (info?.name) zhToEn[info.name] = en;
}

let ok = 0, skipped = [], failed = [];
for (const zh of localNames) {
  const file = join(IMG_DIR, `${zh}.png`);
  if (existsSync(file)) continue;
  const en = zhToEn[zh] || ALIASES[zh];
  if (!en) { skipped.push(zh); continue; }
  const infoEn = zh.startsWith('旅行者') ? 'Aether' : en;
  const icon = GDB.characters(infoEn, { resultLanguage: 'ChineseSimplified' })?.images?.filename_icon;
  if (!icon) { failed.push(`${zh}: 无 filename_icon`); continue; }
  try {
    const res = await fetch(`https://enka.network/ui/${icon}.png`);
    if (!res.ok) { failed.push(`${zh}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
    ok++;
    await new Promise(r => setTimeout(r, 150));
  } catch (e) {
    failed.push(`${zh}: ${e.message}`);
  }
}
console.log(`补齐 ${ok} 个头像`);
if (skipped.length) console.log('genshin-db 无数据，跳过:', skipped.join('、'));
if (failed.length) console.log('失败:', failed.join('；'));
