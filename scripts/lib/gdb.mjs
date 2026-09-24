/**
 * gdb.mjs — genshin-db（正式服）客户端与「genshin-db → 本项目 JSON」的字段映射。
 *
 * 抽出来是为了让三处共用同一套口径（否则「精确复查覆盖单条」写出的文件会与「全量重刷」不一致）：
 *   · scripts/generate-profiles / -weapons / -artifacts.mjs   批量生成
 *   · scripts/sources/genshin-db.mjs                          数据源适配器（按名称查单条）
 *
 * genshin-db 只有正式服数据（npm 包），且是该项目的权威数据源：含武器逐级曲线、
 * 角色 1~90 级属性表 —— 所以适配器把它标为「正式服」，同步时应当覆盖体验服条目。
 */
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseDescription } from './profile-text.mjs';
import { statsFromGenshin } from './char-stats.mjs';
import { CONTENT, isPlaceholderName } from './local-store.mjs';

const require = createRequire(import.meta.url);
export const GDB = require('genshin-db');
export const LANG = { resultLanguage: 'ChineseSimplified' };
export const ICON_BASE = 'https://enka.network/ui/';

const round = (v, d = 1) => Number(Number(v).toFixed(d));

/* 占位条目判断（定义在 local-store.mjs，三个数据源共用），这里转出便于调用方从一处导入 */
export { isPlaceholderName };

/* ===================== 武器 ===================== */

/* 百分比类主属性（其余为固定值，如元素精通） */
const PERCENT_STATS = new Set([
  'FIGHT_PROP_ATTACK_PERCENT', 'FIGHT_PROP_CHARGE_EFFICIENCY',
  'FIGHT_PROP_CRITICAL', 'FIGHT_PROP_CRITICAL_HURT',
  'FIGHT_PROP_DEFENSE_PERCENT', 'FIGHT_PROP_HP_PERCENT',
  'FIGHT_PROP_PHYSICAL_ADD_HURT',
]);

/* 突破节点（与游戏一致：20 / 40 / 50 / 60 / 70 / 80） */
const ASC_CAPS = [20, 40, 50, 60, 70, 80];

/* 获取方式：先读 content/meta/weapons-meta.json 的手动映射，再按星级回退 */
const WEAPON_META_FILE = join(CONTENT, 'meta', 'weapons-meta.json');
const SOURCE_BY_RARITY = { 5: '限定抽取', 3: '常驻抽取', 2: '开地图', 1: '开地图' };

export function weaponSourceMap() {
  try {
    return JSON.parse(readFileSync(WEAPON_META_FILE, 'utf-8')).sources || {};
  } catch {
    return {};
  }
}
export const resolveWeaponSource = (name, rarity, map = weaponSourceMap()) => map[name] || SOURCE_BY_RARITY[rarity] || '';

/** 武器的等级上限与突破次数上限：1~2 星只能到 70 级 / 4 次突破 */
const maxLevelOf = (weapon) => (weapon.rarity <= 2 ? [70, 4] : [90, 6]);

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
      return { level: s.level, attack: round(s.attack, 1), specializedText: formatSpecialized(weapon.mainStatType, s.specialized) };
    }
  } catch { /* 落到默认 */ }
  return null;
}

/* 逐级属性曲线：
 *   attack[lv-1] / specialized[lv-1]      —— 该等级「已尽可能突破」时的值
 *   preAttack[cap] / preSpecialized[cap]  —— 恰好停在突破节点、尚未突破时的值
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
    const asc = Math.min(ASC_CAPS.filter((c) => c <= lv).length, maxAsc);
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
    if (ref && ref.description) list.push({ level: r, description: ref.description, values: ref.values || [] });
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
    const cleaned = items.filter((it) => Number(it.count) > 0).map((it) => ({ name: String(it.name).trim(), count: it.count }));
    if (!cleaned.length) continue;
    costs.push({ stage: i, items: cleaned });
  }
  return costs;
}

/** genshin-db 武器对象 → 本项目 content/weapons/<名称>.json */
export function buildWeapon(w, sourceMap = weaponSourceMap()) {
  const stats = maxStats(w);
  const curve = stats ? buildCurve(w) : null;
  const iconFile = w.images?.filename_icon ? `${w.images.filename_icon}.png` : '';
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
    source: resolveWeaponSource(w.name, w.rarity, sourceMap),
    effectName: w.effectName || '',
    description: w.description || '',
    story: w.story || '',
    refinements: buildRefinements(w),
    costs: buildCosts(w),
    curve,
    icon: iconFile,
    iconUrl: iconFile ? `${ICON_BASE}${w.images.filename_icon}.png` : '',
    version: w.version || '',
  };
  // 去掉空槽位，保持 JSON 精简
  if (!out.refinements.length) delete out.refinements;
  if (!out.costs.length) delete out.costs;
  if (!out.source) delete out.source;
  if (!curve) delete out.curve;
  return out;
}

export const weaponNames = () => GDB.weapons('names', { matchCategories: true }) || [];

/** 武器：中文名 → genshin-db 英文键 */
export function weaponZhToEn() {
  const map = new Map();
  for (const en of weaponNames()) {
    const info = GDB.weapons(en, LANG);
    if (info?.name && !isPlaceholderName(info.name) && !map.has(info.name)) map.set(info.name, en);
  }
  return map;
}

/* ===================== 圣遗物 ===================== */

/* 五个部位，顺序与游戏内一致 */
const SLOTS = [
  { key: 'flower', text: '生之花' },
  { key: 'plume', text: '死之羽' },
  { key: 'sands', text: '时之沙' },
  { key: 'goblet', text: '空之杯' },
  { key: 'circlet', text: '理之冠' },
];

/** genshin-db 圣遗物对象 → 本项目 content/artifacts/<名称>.json */
export function buildArtifact(s) {
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
  return {
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
}

export const artifactNames = () => GDB.artifacts('names', { matchCategories: true }) || [];

/** 圣遗物：中文名 → genshin-db 英文键 */
export function artifactZhToEn() {
  const map = new Map();
  for (const en of artifactNames()) {
    const info = GDB.artifacts(en, LANG);
    if (info?.name && !isPlaceholderName(info.name) && !map.has(info.name)) map.set(info.name, en);
  }
  return map;
}

/* ===================== 角色 ===================== */

/* 数值格式化（genshin-db 格式码） */
function fmtValue(val, code) {
  if (typeof val !== 'number' || Number.isNaN(val)) return String(val ?? '-');
  switch (code) {
    case 'P': return `${Math.round(val * 100)}%`;
    case 'F1P': return `${(val * 100).toFixed(1)}%`;
    case 'F2P': return `${(val * 100).toFixed(2)}%`;
    case 'F1': return val.toFixed(1);
    case 'F2': return val.toFixed(2);
    case 'I0':
    case 'I': return String(Math.round(val));
    default: return String(Math.round(val * 1000) / 1000);
  }
}

const PARAM_RE = /\{param(\d+):([A-Z0-9]+)\}/g;

/* 由 attributes { labels, parameters } 计算 1~15 级数值行 */
function buildLevels(attributes) {
  if (!attributes || !Array.isArray(attributes.labels) || !attributes.labels.length) return [];
  const params = attributes.parameters || {};
  const maxLevel = Math.max(15, ...Object.values(params).map((a) => a?.length || 0));

  const rows = attributes.labels.map((rawLabel) => {
    const parts = String(rawLabel).split('|');
    // 值模板：优先取含占位符的后续段，否则用首段
    let template = parts.slice(1).join('|');
    if (!template.includes('{param')) template = parts[0];
    /* 标签只取「|」前的名字：单位/说明文字留在值里（如「持续时间 → 15.0秒」），
     * 与 gachabase 来源的角色口径一致，也不重复出现两次 */
    const label = (PARAM_RE.lastIndex = 0, parts[0].replace(PARAM_RE, '').trim());

    const values = Array.from({ length: 15 }, (_, lv) => {
      let missing = false;
      const str = template.replace(PARAM_RE, (_, n, code) => {
        const arr = params[`param${n}`];
        if (!arr || arr[lv] === undefined) { missing = true; return '-'; }
        return fmtValue(arr[lv], code);
      });
      return missing && !str.replace(/-/g, '').trim() ? '-' : str;
    });
    return { label, values };
  });
  return rows.filter((r) => r.label || r.values.some((v) => v !== '-'));
}

function buildSkill(id, type, talent) {
  if (!talent || !talent.name) return null;
  const { description, lore, states } = parseDescription(talent.descriptionRaw || talent.description);
  return { id, type, name: talent.name, description, lore, states, levels: buildLevels(talent.attributes) };
}

/* 手动别名：本地名 → genshin-db 键（源数据错别字 / 旅行者按元素拆分） */
export const CHAR_ALIASES = {
  '茜特拉莉': 'Citlali',              // 源 md 写作「茜特拉莉」，官方为「茜特菈莉」

  '旅行者（冰）': 'Traveler (Cryo)',
  '旅行者（火）': 'Traveler (Pyro)',
  '旅行者（水）': 'Traveler (Hydro)',
  '旅行者（雷）': 'Traveler (Electro)',
  '旅行者（风）': 'Traveler (Anemo)',
  '旅行者（岩）': 'Traveler (Geo)',
  '旅行者（草）': 'Traveler (Dendro)',
};

/* 旅行者基础资料（称号/稀有度/简介）统一取自 Aether */
export const CHAR_INFO_ALIAS = { '旅行者（冰）': 'Aether' };

/* genshin-db 版本号滞后的条目（手工维护，优先于数据源）：
 * 冰旅行者实装在 7.0，但 talents('Traveler (Cryo)').version 仍写作 5.6 */
export const CHAR_VERSION_OVERRIDE = { '旅行者（冰）': '7.0' };

/** 实装版本：旅行者取 talents 的版本，其余取 characters 的版本 */
export function charVersion(name, en) {
  if (CHAR_VERSION_OVERRIDE[name]) return CHAR_VERSION_OVERRIDE[name];
  const info = String(name).startsWith('旅行者') ? GDB.talents(en, LANG) : GDB.characters(en, LANG);
  return info?.version || '';
}

/** 角色：中文名 → genshin-db 英文键（genshin-db 自带中文名，绝大多数可直接命中） */
export function charZhToEn() {
  const map = new Map();
  for (const en of GDB.characters('names', { matchCategories: true }) || []) {
    const info = GDB.characters(en, LANG);
    if (info?.name && !isPlaceholderName(info.name) && !map.has(info.name)) map.set(info.name, en);
  }
  return map;
}

/**
 * 生成单个角色资料（与 generate-profiles.mjs 完全同口径）。
 * 名称既可以是本地写法（含别名），也可以是 genshin-db 的中文名；
 * genshin-db 没有该角色时返回 null。
 *
 * 注意：不写 version 字段（由 sync-character-versions.mjs 统一补），
 * 也不含 `buffs`（由 sync-buffs.mjs 从 gachabase 生成）。
 */
export function buildCharacter(name, { zhToEn = charZhToEn() } = {}) {
  const en = zhToEn.get(name) || CHAR_ALIASES[name] || name;
  if (!GDB.characters(en, LANG)?.name && !GDB.talents(en, LANG)) return null;

  const infoEn = String(name).startsWith('旅行者') ? 'Aether' : en;
  const info = GDB.characters(infoEn, LANG);
  const talents = GDB.talents(en, LANG) || {};
  const consts = GDB.constellations(en, LANG) || {};
  if (!info?.name && !talents?.combat1) return null;

  const skills = [
    buildSkill('attack', '普通攻击', talents.combat1),
    buildSkill('skill', '元素战技', talents.combat2),
    buildSkill('burst', '元素爆发', talents.combat3),
  ].filter(Boolean);

  // 战斗被动（突破天赋）passive1/2 + 生活被动（固有天赋）passive3
  const passives = [];
  for (const key of Object.keys(talents).filter((k) => /^passive\d+$/.test(k)).sort()) {
    const p = talents[key];
    if (!p || !p.name) continue;
    const idx = parseInt(key.replace('passive', ''), 10);
    const { description, lore, states } = parseDescription(p.descriptionRaw || p.description);
    passives.push({ name: p.name, description, lore, states, category: idx <= 2 ? 'ascension' : 'utility' });
  }

  const constellations = [];
  for (const key of Object.keys(consts).filter((k) => /^c\d+$/.test(k)).sort((a, b) => +a.slice(1) - +b.slice(1))) {
    const c = consts[key];
    if (!c || !c.name) continue;
    const { description, lore, states } = parseDescription(c.descriptionRaw || c.description);
    constellations.push({ level: parseInt(key.slice(1), 10), name: c.name, description, lore, states });
  }

  const stats = statsFromGenshin(info);
  const out = {
    name,
    title: info?.title || '',
    rarity: info?.rarity || '',
    version: charVersion(name, en),
    description: info?.description || '',
    stats,
    skills,
    passives,
    constellations,
  };
  if (!stats) delete out.stats;
  return out;
}
