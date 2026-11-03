/**
 * gen-char-index.mjs — 生成「角色轻量索引」src/data/char-index.json。
 *
 * 用途：角色图鉴列表/排序只需要 名称→{version,rarity,title}，不需要 127 份完整资料 JSON。
 * 把这份小索引打进包（~30KB），完整资料改为运行时按需 fetch /api/characters/<名称>.json，
 * 从而把 127 个角色 JSON（~1.4MB）移出前端 bundle（见 P4 优化）。
 *
 * 运行时机：挂在 `npm run parse` 里，每次构建前随 content/characters/*.json 重新生成。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHAR_DIR = join(ROOT, 'content/characters');
const OUT = join(ROOT, 'src/data/char-index.json');

const index = {};
if (existsSync(CHAR_DIR)) {
  for (const file of readdirSync(CHAR_DIR).filter((f) => f.endsWith('.json'))) {
    try {
      const d = JSON.parse(readFileSync(join(CHAR_DIR, file), 'utf-8'));
      if (d?.name) {
        index[d.name] = {
          version: d.version ?? '',
          rarity: d.rarity ?? 0,
          title: d.title ?? '',
        };
      }
    } catch { /* 跳过坏文件 */ }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(index), 'utf-8');
console.log(`✅ 角色轻量索引 → src/data/char-index.json（${Object.keys(index).length} 名）`);
