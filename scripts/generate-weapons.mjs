/**
 * generate-weapons.mjs — 用 genshin-db 生成武器图鉴数据。
 *
 * 输出：
 *   content/weapons/<中文名>.json   每把武器一份资料（单一数据源，可手动微调）
 *   content/weapons/images/*.png    仅在传入 --icons 时下载（否则页面直接引用官方 CDN）
 *
 * 用法:
 *   node scripts/generate-weapons.mjs           # 增量生成（已存在的条目跳过）
 *   node scripts/generate-weapons.mjs --force   # 全部重新生成
 *   node scripts/generate-weapons.mjs --icons   # 同时把图标下载到本地（离线可用）
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
const OUT_DIR = join(ROOT, 'content', 'weapons');
const IMG_DIR = join(OUT_DIR, 'images');
const INDEX_FILE = join(ROOT, 'src', 'data', 'weapons-index.json');
const META_FILE = join(ROOT, 'content', 'meta', 'weapons-meta.json');

const FORCE = process.argv.includes('--force');
const WITH_ICONS = process.argv.includes('--icons');

mkdirSync(OUT_DIR, { recursive: true });

/* 官方图标 CDN（enka 体积更小，与角色头像同源） */
const ICON_BASE = 'https://enka.network/ui/';

/* 获取方式：先读 content/meta/weapons-meta.json 的手动映射，再按星级回退 */
const META = existsSync(META_FILE) ? JSON.parse(readFileSync(META_FILE, 'utf-8')) : {};
const SOURCE_MAP = META.sources || {};
const SOURCE_BY_RARITY = { 5: '限定抽取', 3: '常驻抽取', 2: '开地图', 1: '开地图' };
const resolveSource = (name, rarity) => SOURCE_MAP[name] || SOURCE_BY_RARITY[rarity] || '';

/* 百分比类主属性（其余为固定值，如元素精通） */
const PERCENT_STATS = new Set([
  'FIGHT_PROP_ATTACK_PERCENT', 'FIGHT_PROP_CHARGE_EFFICIENCY',
  'FIGHT_PROP_CRITICAL', 'FIGHT_PROP_CRITICAL_HURT',
  'FIGHT_PROP_DEFENSE_PERCENT', 'FIGHT_PROP_HP_PERCENT',
  'FIGHT_PROP_PHYSICAL_ADD_HURT',
]);

const sanitize = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim();

const round = (v, d = 1) => Number(Number(v).toFixed(d));

/* 主属性满级数值：百分比 → "49.6%"，元素精通 → "165" */
function formatSpecialized(type, value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return PERCENT_STATS.has(type) ? `${round(value * 100, 1)}%` : String(Math.round(value));
}

/* 升到满级的基础攻击力与副属性 */
function maxStats(weapon) {
  const [lv, asc] = maxLevelOf(weapon);
  try {
    const s = weapon.stats?.(lv, asc);
    if (s && typeof s.attack === 'number') {
      return {
        level: s.level,
        attack: round(s.attack, 1),
        specializedText: formatSpecialized(weapon.mainStatType, s.specialized),
      };
    }
  } catch { /* 落到默认 */ }
  return null;
}

/* 武器的等级上限与突破次数上限：1~2 星只能到 70 级 / 4 次突破，其余 90 级 / 6 次 */
function maxLevelOf(weapon) {
  return weapon.rarity <= 2 ? [70, 4] : [90, 6];
}

/* 突破节点（与游戏一致：20 / 40 / 50 / 60 / 70 / 80） */
const ASC_CAPS = [20, 40, 50, 60, 70, 80];

/* 逐级属性曲线：
 *   attack[lv-1] / specialized[lv-1]  —— 该等级「已尽可能突破」时的值
 *   preAttack[cap] / preSpecialized[cap] —— 恰好停在突破节点、尚未突破时的值
 * 二者不同即为「同等级、是否突破」的差异，供页面滑块 + 突破勾选使用。 */
function buildCurve(weapon) {
  const [maxLv, maxAsc] = maxLevelOf(weapon);
  const stat = (lv, asc) => {
    try {
      const s = weapon.stats?.(lv, asc);
      return s && typeof s.attack === 'number' ? s : null;
    } catch { return null; }
  };

  const attack = [];
  const specialized = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    const asc = Math.min(ASC_CAPS.filter(c => c <= lv).length, maxAsc);
    const s = stat(lv, asc);
    attack.push(s ? round(s.attack, 1) : null);
    specialized.push(s ? round(s.specialized ?? 0, 5) : null);
  }

  const preAttack = {};
  const preSpecialized = {};
  ASC_CAPS.forEach((cap, i) => {
    if (cap > maxLv) return;
    const s = stat(cap, i);
    if (!s) return;
    preAttack[cap] = round(s.attack, 1);
    preSpecialized[cap] = round(s.specialized ?? 0, 5);
  });

  return { maxLevel: maxLv, maxAscension: maxAsc, attack, specialized, preAttack, preSpecialized };
}

/* 精炼 1~5 阶 */
function buildRefinements(weapon) {
  const list = [];
  for (let r = 1; r <= 5; r++) {
    const ref = weapon[`r${r}`];
    if (ref && ref.description) {
      list.push({ level: r, description: ref.description, values: ref.values || [] });
    }
  }
  return list;
}

/* 突破材料（ascend1~6） */
function buildCosts(weapon) {
  const costs = [];
  for (let i = 1; i <= 6; i++) {
    const items = weapon.costs?.[`ascend${i}`];
    if (!items || !items.length) continue;
    // 低星武器会出现 摩拉×0 这类空条目，直接剔除
    const cleaned = items
      .filter(it => Number(it.count) > 0)
      .map(it => ({ name: String(it.name).trim(), count: it.count }));
    if (!cleaned.length) continue;
    costs.push({ stage: i, items: cleaned });
  }
  return costs;
}

/* 纯数值数组压成单行，避免逐级曲线把 JSON 撑成 90 倍的缩进行 */
function compactNumberArrays(json) {
  return json.replace(/\[[^[\]{}]*\]/g, (m) => {
    if (!/^\s*\[\s*(?:-?\d+(?:\.\d+)?|null)(?:\s*,\s*(?:-?\d+(?:\.\d+)?|null))*\s*\]\s*$/.test(m)) return m;
    return '[' + m.replace(/[[\]\s]/g, ' ').trim().split(/\s*,\s*/).join(', ') + ']';
  });
}

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
    .filter(f => f.endsWith('.json'))
    .map(f => {
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
  console.log('正在建立武器中英文映射…');
  const enNames = GDB.weapons('names', { matchCategories: true });
  const weapons = [];
  const seen = new Set();
  for (const en of enNames) {
    const info = GDB.weapons(en, { resultLanguage: 'ChineseSimplified' });
    if (!info?.name) continue;
    if (seen.has(info.name)) continue;
    seen.add(info.name);
    weapons.push(info);
  }
  console.log(`共 ${weapons.length} 把武器`);

  mkdirSync(IMG_DIR, { recursive: true });

  let written = 0, skipped = 0, iconOk = 0, iconFail = 0;

  for (const w of weapons) {
    const file = join(OUT_DIR, `${sanitize(w.name)}.json`);
    const iconFile = w.images?.filename_icon ? `${w.images.filename_icon}.png` : '';
    const iconUrl = iconFile ? `${ICON_BASE}${w.images.filename_icon}.png` : '';

    if (!FORCE && existsSync(file)) { skipped++; continue; }

    const stats = maxStats(w);
    const curve = stats ? buildCurve(w) : null;
    const source = resolveSource(w.name, w.rarity);
    const out = {
      name: w.name,
      id: w.id,
      rarity: w.rarity,
      type: w.weaponText,
      typeId: w.weaponType,
      baseAtk: round(w.baseAtkValue, 1),
      mainStat: w.mainStatText || '',
      mainStatValue: w.baseStatText || '',
      mainStatPercent: PERCENT_STATS.has(w.mainStatType),
      mainStatMax: stats?.specializedText || '',
      atkMax: stats?.attack ?? null,
      maxLevel: stats?.level ?? 90,
      source: source,
      effectName: w.effectName || '',
      description: w.description || '',
      story: w.story || '',
      refinements: buildRefinements(w),
      costs: buildCosts(w),
      curve,
      icon: iconFile,
      iconUrl,
      version: w.version || '',
    };

    // 去掉空槽位，保持 JSON 精简
    if (!out.refinements.length) delete out.refinements;
    if (!out.costs.length) delete out.costs;
    if (!out.source) delete out.source;
    if (!curve) delete out.curve;

    writeFileSync(file, compactNumberArrays(JSON.stringify(out, null, 2)) + '\n', 'utf-8');
    written++;

    if (WITH_ICONS && iconUrl) {
      const ok = await downloadIcon(iconFile, iconUrl);
      ok ? iconOk++ : iconFail++;
      if (!ok) console.warn(`  ⚠️ 图标下载失败: ${w.name} (${iconUrl})`);
      await new Promise(r => setTimeout(r, 60));
    }
  }

  console.log(`✅ 武器数据：新增/更新 ${written} 条，跳过已存在 ${skipped} 条 → ${OUT_DIR}`);
  const indexed = writeIndex();
  console.log(`✅ 索引：${indexed} 条 → ${INDEX_FILE}`);
  const untagged = weapons.filter(w => !resolveSource(w.name, w.rarity));
  if (untagged.length) {
    console.log(`⚠️ 未标注获取方式：${untagged.length} 把（见 content/meta/weapons-meta.json 的 _todo 说明）`);
  }
  if (WITH_ICONS) console.log(`   图标：成功 ${iconOk}，失败 ${iconFail} → ${IMG_DIR}`);
  else console.log('   （未下载图标，页面将直接引用官方 CDN；如需离线可加 --icons）');
}

main();
