/**
 * generate-profiles.mjs — 用 genshin-db 批量生成全角色本地资料 JSON
 *
 * 输出 content/characters/<中文名>.json，schema：
 *   { name, title, rarity, description,
 *     skills: [{ id: 'attack'|'skill'|'burst', type, name, description, levels: [{label, values[15]}] }],
 *     passives: [{ name, description, category: 'ascension'|'utility' }],
 *     constellations: [{ level, name, description }] }
 *
 * 用法: node scripts/generate-profiles.mjs
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const GDB = require('genshin-db');

import { parseDescription } from './lib/profile-text.mjs';
import { statsFromGenshin } from './lib/char-stats.mjs';
import { formatJson } from './lib/compact-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'content', 'characters');
mkdirSync(OUT_DIR, { recursive: true });

// 项目内 127 名角色（产球表）
const { characters: charData, elementIds } = await import('../src/data/characters.js');
const localNames = elementIds.flatMap(el => (charData[el] || []).map(c => c.name));

/* ---------- 中文名 → 英文名 映射 ---------- */
console.log('正在建立中英文映射…');
const enNames = GDB.characters('names', { matchCategories: true });
const zhToEn = {};
for (const en of enNames) {
  const info = GDB.characters(en, { resultLanguage: 'ChineseSimplified' });
  if (info && info.name) zhToEn[info.name] = en;
}
console.log(`映射完成：${Object.keys(zhToEn).length} 名`);

/* ---------- 数值格式化（genshin-db 格式码） ---------- */
function fmtValue(val, code) {
  if (typeof val !== 'number' || Number.isNaN(val)) return String(val ?? '-');
  switch (code) {
    case 'P':   return `${Math.round(val * 100)}%`;
    case 'F1P': return `${(val * 100).toFixed(1)}%`;
    case 'F2P': return `${(val * 100).toFixed(2)}%`;
    case 'F1':  return val.toFixed(1);
    case 'F2':  return val.toFixed(2);
    case 'I0':
    case 'I':   return String(Math.round(val));
    default:    return String(Math.round(val * 1000) / 1000);
  }
}

const PARAM_RE = /\{param(\d+):([A-Z0-9]+)\}/g;

/* 由 attributes { labels, parameters } 计算 1~15 级数值行 */
function buildLevels(attributes) {
  if (!attributes || !Array.isArray(attributes.labels) || !attributes.labels.length) return [];
  const params = attributes.parameters || {};
  const maxLevel = Math.max(15, ...Object.values(params).map(a => a?.length || 0));

  const rows = attributes.labels.map(rawLabel => {
    const parts = String(rawLabel).split('|');
    // 值模板：优先取含占位符的后续段，否则用首段
    let template = parts.slice(1).join('|');
    if (!template.includes('{param')) template = parts[0];
    const labelText = (PARAM_RE.lastIndex = 0, parts[0].replace(PARAM_RE, '').trim());
    // 模板中占位符以外的文字（如 "生命值上限"）并入 label
    PARAM_RE.lastIndex = 0;
    const extraText = template.replace(PARAM_RE, '').replace(/[:：\s]+/g, '');
    const label = extraText && extraText !== labelText ? `${labelText}（${extraText}）` : labelText;

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
  return rows.filter(r => r.label || r.values.some(v => v !== '-'));
}

function buildSkill(id, type, talent) {
  if (!talent || !talent.name) return null;
  const { description, lore, states } = parseDescription(talent.descriptionRaw || talent.description);
  return {
    id,
    type,
    name: talent.name,
    description,
    lore,
    states,
    levels: buildLevels(talent.attributes),
  };
}

/* 手动别名：本地名 → genshin-db 键（源数据错别字 / 旅行者按元素拆分） */
const ALIASES = {
  '茜特拉莉': 'Citlali',          // 源 md 写作「茜特拉莉」，官方为「茜特菈莉」

  '旅行者（冰）': 'Traveler (Cryo)',
  '旅行者（火）': 'Traveler (Pyro)',
  '旅行者（水）': 'Traveler (Hydro)',
  '旅行者（雷）': 'Traveler (Electro)',
  '旅行者（风）': 'Traveler (Anemo)',
  '旅行者（岩）': 'Traveler (Geo)',
  '旅行者（草）': 'Traveler (Dendro)',
};
// 旅行者基础资料（称号/稀有度/简介）统一取自 Aether
const INFO_ALIAS = { '旅行者（冰）': 'Aether' };

/* ---------- 主流程 ---------- */
let ok = 0, missing = [], failed = [];
for (const zh of localNames) {
  const en = zhToEn[zh] || ALIASES[zh];
  if (!en) { missing.push(zh); continue; }
  try {
    const infoEn = zh.startsWith('旅行者') ? 'Aether' : en;
    const info = GDB.characters(infoEn, { resultLanguage: 'ChineseSimplified' });
    const talents = GDB.talents(en, { resultLanguage: 'ChineseSimplified' }) || {};
    const consts = GDB.constellations(en, { resultLanguage: 'ChineseSimplified' }) || {};

    const skills = [
      buildSkill('attack', '普通攻击', talents.combat1),
      buildSkill('skill', '元素战技', talents.combat2),
      buildSkill('burst', '元素爆发', talents.combat3),
    ].filter(Boolean);

    // 战斗被动（突破天赋）passive1/2 + 生活被动（固有天赋）passive3
    const passives = [];
    for (const key of Object.keys(talents).filter(k => /^passive\d+$/.test(k)).sort()) {
      const p = talents[key];
      if (!p || !p.name) continue;
      const idx = parseInt(key.replace('passive', ''), 10);
      const { description, lore, states } = parseDescription(p.descriptionRaw || p.description);
      passives.push({
        name: p.name,
        description,
        lore,
        states,
        category: idx <= 2 ? 'ascension' : 'utility',
      });
    }

    const constellationList = [];
    for (const key of Object.keys(consts).filter(k => /^c\d+$/.test(k)).sort((a, b) => +a.slice(1) - +b.slice(1))) {
      const c = consts[key];
      if (!c || !c.name) continue;
      const { description, lore, states } = parseDescription(c.descriptionRaw || c.description);
      constellationList.push({
        level: parseInt(key.slice(1), 10),
        name: c.name,
        description,
        lore,
        states,
      });
    }

    const profile = {
      name: zh,
      title: info?.title || '',
      rarity: info?.rarity || '',
      description: info?.description || '',
      stats: statsFromGenshin(info) || undefined,
      skills,
      passives,
      constellations: constellationList,
    };
    if (!profile.stats) delete profile.stats;
    writeFileSync(join(OUT_DIR, `${zh}.json`), formatJson(profile), 'utf8');
    ok++;
  } catch (e) {
    failed.push(`${zh} (${en}): ${e.message}`);
  }
}

console.log(`\n生成成功 ${ok} 名角色资料`);
if (missing.length) console.log(`genshin-db 无数据（保持无资料页）: ${missing.join('、')}`);
if (failed.length) console.log(`失败:\n  ${failed.join('\n  ')}`);
