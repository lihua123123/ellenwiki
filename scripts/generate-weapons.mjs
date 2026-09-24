/**
 * generate-weapons.mjs — 用 genshin-db（正式服）批量生成武器图鉴数据。
 *
 * 输出：
 *   content/weapons/<中文名>.json   每把武器一份资料（单一数据源，可手动微调）
 *   src/data/weapons-index.json     列表页用的轻量索引（每次运行都重建）
 *   content/weapons/images/*.png    仅在传入 --icons 时下载（否则页面引用官方 CDN）
 *
 * 字段映射在 lib/gdb.mjs（与数据源适配器 sources/genshin-db.mjs 共用同一套口径），
 * 因此「批量重刷」与「按名称精确复查覆盖单条」写出的文件格式完全一致。
 *
 * 用法:
 *   node scripts/generate-weapons.mjs           # 增量生成（已存在的条目跳过）
 *   node scripts/generate-weapons.mjs --force   # 全部重新生成（⚠️ 覆盖手工文案）
 *   node scripts/generate-weapons.mjs --icons   # 同时把图标下载到本地（离线可用）
 */
import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { GDB, LANG, ICON_BASE, buildWeapon, weaponNames, weaponSourceMap, resolveWeaponSource, isPlaceholderName } from './lib/gdb.mjs';
import { ROOT, DIRS, fileOf } from './lib/local-store.mjs';
import { formatJson } from './lib/compact-json.mjs';

const OUT_DIR = DIRS.weapon;
const IMG_DIR = join(OUT_DIR, 'images');
const INDEX_FILE = join(ROOT, 'src', 'data', 'weapons-index.json');

const FORCE = process.argv.includes('--force');
const WITH_ICONS = process.argv.includes('--icons');

/* 实装版本倒序（越新越靠前），同版本按星级、名称排 */
const versionParts = (v) => String(v || '').split('.').map(Number);
const byVersionDesc = (a, b) => {
  const A = versionParts(a.version), B = versionParts(b.version);
  return (B[0] || 0) - (A[0] || 0)
    || (B[1] || 0) - (A[1] || 0)
    || (b.rarity || 0) - (a.rarity || 0)
    || String(a.name).localeCompare(String(b.name), 'zh');
};

/* 从 content/weapons/*.json 汇总轻量索引，供列表页直接使用（详情页才懒加载完整文件） */
function writeIndex() {
  const entries = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const d = JSON.parse(readFileSync(join(OUT_DIR, f), 'utf-8'));
      return {
        slug: f.replace(/\.json$/, ''),
        name: d.name,
        rarity: d.rarity,
        type: d.type,
        version: d.version || '',
        baseAtk: d.baseAtk,
        mainStat: d.mainStat,
        mainStatValue: d.mainStatValue,
        /* 满级（Lv.90）属性：列表页展示与「我的角色」演示数据都用它 */
        atkMax: d.atkMax,
        mainStatMax: d.mainStatMax,
        maxLevel: d.maxLevel,
        effectName: d.effectName,
        source: d.source || '',
        icon: d.icon,
        iconUrl: d.iconUrl,
      };
    })
    .sort(byVersionDesc);
  writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
  return entries.length;
}

async function downloadIcon(file, url) {
  const target = join(IMG_DIR, file);
  if (existsSync(target)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sourceMap = weaponSourceMap();

  console.log('正在建立武器中英文映射…');
  const weapons = [];
  const seen = new Set();
  for (const en of weaponNames()) {
    const info = GDB.weapons(en, LANG);
    if (!info?.name || isPlaceholderName(info.name) || seen.has(info.name)) continue;
    seen.add(info.name);
    weapons.push(info);
  }
  console.log(`共 ${weapons.length} 把武器`);

  mkdirSync(IMG_DIR, { recursive: true });

  let written = 0, skipped = 0, iconOk = 0, iconFail = 0;
  for (const w of weapons) {
    const file = fileOf('weapon', w.name);
    if (!FORCE && existsSync(file)) {
      skipped++;
      continue;
    }
    const out = buildWeapon(w, sourceMap);
    writeFileSync(file, formatJson(out), 'utf-8');
    written++;

    if (WITH_ICONS && out.iconUrl) {
      const ok = await downloadIcon(out.icon, out.iconUrl);
      ok ? iconOk++ : iconFail++;
      if (!ok) console.warn(`  ⚠️ 图标下载失败: ${w.name} (${out.iconUrl})`);
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  console.log(`✅ 武器数据：新增/更新 ${written} 条，跳过已存在 ${skipped} 条 → ${OUT_DIR}`);
  console.log(`✅ 索引：${writeIndex()} 条 → ${INDEX_FILE}`);
  const untagged = weapons.filter((w) => !resolveWeaponSource(w.name, w.rarity, sourceMap));
  if (untagged.length) console.log(`⚠️ 未标注获取方式：${untagged.length} 把（见 content/meta/weapons-meta.json）`);
  if (WITH_ICONS) console.log(`   图标：成功 ${iconOk}，失败 ${iconFail} → ${IMG_DIR}`);
  else console.log('   （未下载图标，页面将直接引用官方 CDN；如需离线可加 --icons）');
}

main();
