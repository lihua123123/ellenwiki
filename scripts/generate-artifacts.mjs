/**
 * generate-artifacts.mjs — 用 genshin-db（正式服）生成圣遗物图鉴数据。
 *
 * 输出：
 *   content/artifacts/<中文名>.json   每套圣遗物一份资料（单一数据源，可手动微调）
 *   src/data/artifacts-index.json     列表页用的轻量索引（每次运行都重建）
 *   content/artifacts/images/*.png    仅在传入 --icons 时下载（否则页面引用官方 CDN）
 *
 * 字段映射在 lib/gdb.mjs（与数据源适配器 sources/genshin-db.mjs 共用同一套口径）。
 *
 * 用法:
 *   node scripts/generate-artifacts.mjs           # 增量生成（已存在的条目跳过）
 *   node scripts/generate-artifacts.mjs --force   # 全部重新生成（⚠️ 覆盖手工文案）
 *   node scripts/generate-artifacts.mjs --icons   # 同时把图标下载到本地（离线可用）
 */
import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { GDB, LANG, buildArtifact, artifactNames, isPlaceholderName } from './lib/gdb.mjs';
import { ROOT, DIRS, fileOf } from './lib/local-store.mjs';
import { formatJson } from './lib/compact-json.mjs';

const OUT_DIR = DIRS.artifact;
const IMG_DIR = join(OUT_DIR, 'images');
const INDEX_FILE = join(ROOT, 'src', 'data', 'artifacts-index.json');

const FORCE = process.argv.includes('--force');
const WITH_ICONS = process.argv.includes('--icons');

/* 实装版本倒序（越新越靠前） */
const versionParts = (v) => String(v || '').split('.').map(Number);
const byVersionDesc = (a, b) => {
  const A = versionParts(a.version), B = versionParts(b.version);
  return (B[0] || 0) - (A[0] || 0)
    || (B[1] || 0) - (A[1] || 0)
    || (Math.max(...(b.rarity || [4])) - Math.max(...(a.rarity || [4])))
    || String(a.name).localeCompare(String(b.name), 'zh');
};

/* 从 content/artifacts/*.json 汇总轻量索引，供列表页直接使用 */
function writeIndex() {
  const entries = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const d = JSON.parse(readFileSync(join(OUT_DIR, f), 'utf-8'));
      /* 五个部位的图标与**部位名**（名字后缀在游戏数据里是乱序的，必须按部位取）
         → 「我的角色」页用它把圣遗物名 / 图标对上：slotKey → iconUrl / name */
      const pieceIcons = {};
      const pieceNames = {};
      for (const p of Array.isArray(d.pieces) ? d.pieces : []) {
        if (!p.slot) continue;
        if (p.iconUrl) pieceIcons[p.slot] = p.iconUrl;
        if (p.name) pieceNames[p.slot] = p.name;
      }
      return {
        slug: f.replace(/\.json$/, ''),
        name: d.name,
        rarity: d.rarity,
        version: d.version || '',
        effect1Pc: d.effect1Pc || '',
        effect2Pc: d.effect2Pc || '',
        effect4Pc: d.effect4Pc || '',
        icon: d.icon,
        iconUrl: d.iconUrl,
        pieceIcons,
        pieceNames,
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
  mkdirSync(IMG_DIR, { recursive: true });

  console.log('正在建立圣遗物中英文映射…');
  const sets = [];
  const seen = new Set();
  for (const en of artifactNames()) {
    const info = GDB.artifacts(en, LANG);
    if (!info?.name || isPlaceholderName(info.name) || seen.has(info.name)) continue;
    seen.add(info.name);
    sets.push(info);
  }
  console.log(`共 ${sets.length} 套圣遗物`);

  let written = 0, skipped = 0, iconOk = 0, iconFail = 0;
  for (const s of sets) {
    const file = fileOf('artifact', s.name);
    if (!FORCE && existsSync(file)) {
      skipped++;
      continue;
    }
    const out = buildArtifact(s);
    writeFileSync(file, formatJson(out), 'utf-8');
    written++;

    if (WITH_ICONS) {
      for (const p of out.pieces) {
        if (!p.iconUrl) continue;
        const ok = await downloadIcon(p.icon, p.iconUrl);
        ok ? iconOk++ : iconFail++;
        if (!ok) console.warn(`  ⚠️ 图标下载失败: ${s.name} · ${p.name}`);
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  }

  console.log(`✅ 圣遗物数据：新增/更新 ${written} 条，跳过已存在 ${skipped} 条 → ${OUT_DIR}`);
  console.log(`✅ 索引：${writeIndex()} 套 → ${INDEX_FILE}`);
  if (WITH_ICONS) console.log(`   图标：成功 ${iconOk}，失败 ${iconFail} → ${IMG_DIR}`);
  else console.log('   （未下载图标，页面将直接引用官方 CDN；如需离线可加 --icons）');
}

main();
