/**
 * generate-profiles.mjs — 用 genshin-db（正式服）批量生成全角色本地资料 JSON。
 *
 * 输出 content/characters/<中文名>.json（schema 与字段映射见 lib/gdb.mjs）：
 *   { name, title, rarity, description, stats?, skills[], passives[], constellations[] }
 *
 * 注意：本脚本是**无条件全量覆盖**（不跳过已存在文件），会吃掉手工补写的文案，
 * 也会清掉 `buffs`（来自 gachabase）—— 跑完请补 `npm run data:buffs`。
 * 只想改某一条时不要跑这里，用数据源入口按名称精确复查/覆盖：
 *   npm run data -- genshin-db check 胡桃
 *
 * 用法: node scripts/generate-profiles.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildCharacter, charZhToEn } from './lib/gdb.mjs';
import { DIRS, fileOf } from './lib/local-store.mjs';
import { formatJson } from './lib/compact-json.mjs';

const OUT_DIR = DIRS.character;
mkdirSync(OUT_DIR, { recursive: true });

/* 项目内角色清单（含产球表与旅行者各元素形态），以 src/data/characters.js 为准 */
const { characters: charData, elementIds } = await import('../src/data/characters.js');
const localNames = elementIds.flatMap((el) => (charData[el] || []).map((c) => c.name));

console.log('正在建立角色中英文映射…');
const zhToEn = charZhToEn();
console.log(`映射完成：${zhToEn.size} 名`);

let ok = 0;
const missing = [];
const failed = [];

for (const zh of localNames) {
  try {
    const profile = buildCharacter(zh, { zhToEn });
    if (!profile) {
      missing.push(zh);
      continue;
    }
    writeFileSync(fileOf('character', zh), formatJson(profile), 'utf-8');
    ok++;
  } catch (e) {
    failed.push(`${zh}: ${e.message}`);
  }
}

console.log(`\n生成成功 ${ok} 名角色资料 → ${OUT_DIR}`);
if (missing.length) console.log(`genshin-db 无数据（保持无资料页）: ${missing.join('、')}`);
if (failed.length) console.log(`失败:\n  ${failed.join('\n  ')}`);
