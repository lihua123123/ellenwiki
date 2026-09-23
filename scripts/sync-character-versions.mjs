/**
 * sync-character-versions.mjs — 给 content/characters/<名称>.json 补上 version（实装版本）字段。
 *
 * 只增改 version 一个字段，其余内容原样保留（不会覆盖手工补写的文案），
 * 因此可以安全地反复执行 —— 版本已一致的文件直接跳过。
 *
 * 用法: node scripts/sync-character-versions.mjs
 */
import { createRequire } from 'module';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatJson } from './lib/compact-json.mjs';

const require = createRequire(import.meta.url);
const GDB = require('genshin-db');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'content', 'characters');
const LANG = { resultLanguage: 'ChineseSimplified' };

/* 与 generate-profiles 保持一致的手动别名 */
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

/* genshin-db 版本号滞后的条目（手工维护，优先于数据源）：冰旅行者实装在 7.0，
 * genshin-db 的 talents('Traveler (Cryo)').version 仍写作 5.6，会导致图鉴排序错位 */
const VERSION_OVERRIDE = {
  '旅行者（冰）': '7.0',
};

console.log('正在建立角色中英文映射…');
const enNames = GDB.characters('names', { matchCategories: true });
const zhToEn = {};
for (const en of enNames) {
  const info = GDB.characters(en, LANG);
  if (info?.name) zhToEn[info.name] = en;
}

let updated = 0, unchanged = 0;
const missing = [];

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const zh = file.replace(/\.json$/, '');
  const path = join(DIR, file);
  const data = JSON.parse(readFileSync(path, 'utf-8'));

  const en = zhToEn[zh] || ALIASES[zh];
  let version = '';
  if (en) {
    // 旅行者的战斗天赋在 talents 文件夹，其余走 characters
    version = (zh.startsWith('旅行者') ? GDB.talents(en, LANG) : GDB.characters(en, LANG))?.version || '';
  }
  version = VERSION_OVERRIDE[zh] || version;

  if (!version) { missing.push(zh); continue; }
  if (data.version === version) { unchanged++; continue; }

  // 保持键序稳定：version 紧跟在 rarity 之后
  // （旧 version 键必须跳过，否则后面的循环会把刚写入的新值又覆盖回旧值）
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'version') continue;
    out[k] = v;
    if (k === 'rarity') out.version = version;
  }
  if (!Object.prototype.hasOwnProperty.call(out, 'version')) out.version = version;

  writeFileSync(path, formatJson(out), 'utf-8');
  updated++;
}

console.log(`✅ 角色实装版本：更新 ${updated} 个，已是最新 ${unchanged} 个`);
if (missing.length) console.log('⚠️ genshin-db 无版本数据（跳过）:', missing.join('、'));
