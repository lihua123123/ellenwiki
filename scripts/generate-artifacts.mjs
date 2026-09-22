/**
 * generate-artifacts.mjs — 用 genshin-db 生成圣遗物图鉴数据。
 *
 * 输出：
 *   content/artifacts/<中文名>.json   每套圣遗物一份资料（单一数据源，可手动微调）
 *   content/artifacts/images/*.png    仅在传入 --icons 时下载（否则页面直接引用官方 CDN）
 *
 * 用法:
 *   node scripts/generate-artifacts.mjs           # 增量生成（已存在的条目跳过）
 *   node scripts/generate-artifacts.mjs --force   # 全部重新生成
 *   node scripts/generate-artifacts.mjs --icons   # 同时把图标下载到本地（离线可用）
 *
 * 数据来源：genshin-db（https://github.com/theBowja/genshin-db）
 */
import { createRequire } from 'module';
import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const GDB = require('genshin-db');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'content', 'artifacts');
const IMG_DIR = join(OUT_DIR, 'images');
const INDEX_FILE = join(ROOT, 'src', 'data', 'artifacts-index.json');

const FORCE = process.argv.includes('--force');
const WITH_ICONS = process.argv.includes('--icons');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(IMG_DIR, { recursive: true });

const ICON_BASE = 'https://enka.network/ui/';

/* 五个部位，顺序与游戏内一致 */
const SLOTS = [
  { key: 'flower', text: '生之花' },
  { key: 'plume', text: '死之羽' },
  { key: 'sands', text: '时之沙' },
  { key: 'goblet', text: '空之杯' },
  { key: 'circlet', text: '理之冠' },
];

const sanitize = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim();

/* 实装版本倒序（越新越靠前） */
const versionParts = (v) => String(v || '').split('.').map(Number);
const byVersionDesc = (a, b) => {
  const A = versionParts(a.version), B = versionParts(b.version);
  return (B[0] || 0) - (A[0] || 0)
    || (B[1] || 0) - (A[1] || 0)
    || (Math.max(...(b.rarity || [4])) - Math.max(...(a.rarity || [4])))
    || String(a.name).localeCompare(String(b.name), 'zh');
};

/* 从 content/artifacts/*.json 汇总轻量索引，供列表页直接使用（详情页才懒加载完整文件） */
function writeIndex() {
  const entries = readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const d = JSON.parse(readFileSync(join(OUT_DIR, f), 'utf-8'));
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
  console.log('正在建立圣遗物中英文映射…');
  const enNames = GDB.artifacts('names', { matchCategories: true });
  const sets = [];
  const seen = new Set();
  for (const en of enNames) {
    const info = GDB.artifacts(en, { resultLanguage: 'ChineseSimplified' });
    if (!info?.name) continue;
    if (seen.has(info.name)) continue;
    seen.add(info.name);
    sets.push(info);
  }
  console.log(`共 ${sets.length} 套圣遗物`);

  let written = 0, skipped = 0, iconOk = 0, iconFail = 0;

  for (const s of sets) {
    const file = join(OUT_DIR, `${sanitize(s.name)}.json`);
    if (!FORCE && existsSync(file)) { skipped++; continue; }

    const pieces = SLOTS.map(({ key, text }) => {
      const p = s[key];
      if (!p) return null;
      const filename = s.images?.[`filename_${key}`] || '';
      return {
        slot: key,
        slotText: p.relicText || text,
        name: p.name || '',
        description: p.description || '',
        story: p.story || '',
        icon: filename ? `${filename}.png` : '',
        iconUrl: filename ? `${ICON_BASE}${filename}.png` : '',
      };
    }).filter(Boolean);

    const cover = pieces[0] || { icon: '', iconUrl: '' };

    const out = {
      name: s.name,
      id: s.id,
      rarity: s.rarityList || [],
      effect1Pc: s.effect1Pc || '',
      effect2Pc: s.effect2Pc || '',
      effect4Pc: s.effect4Pc || '',
      pieces,
      icon: cover.icon,
      iconUrl: cover.iconUrl,
      version: s.version || '',
    };

    writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf-8');
    written++;

    if (WITH_ICONS) {
      for (const p of pieces) {
        if (!p.iconUrl) continue;
        const ok = await downloadIcon(p.icon, p.iconUrl);
        ok ? iconOk++ : iconFail++;
        if (!ok) console.warn(`  ⚠️ 图标下载失败: ${s.name} · ${p.name}`);
        await new Promise(r => setTimeout(r, 60));
      }
    }
  }

  console.log(`✅ 圣遗物数据：新增/更新 ${written} 条，跳过已存在 ${skipped} 条 → ${OUT_DIR}`);
  const indexed = writeIndex();
  console.log(`✅ 索引：${indexed} 套 → ${INDEX_FILE}`);
  if (WITH_ICONS) console.log(`   图标：成功 ${iconOk}，失败 ${iconFail} → ${IMG_DIR}`);
  else console.log('   （未下载图标，页面将直接引用官方 CDN；如需离线可加 --icons）');
}

main();
