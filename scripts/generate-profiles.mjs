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

const stripHtml = (s) => String(s || '')
  .replace(/\{LINK#[^}]*\}/g, '')   // 游戏内链接标记 {LINK#S11325}文字{/LINK}
  .replace(/\{\/LINK\}/g, '')
  .replace(/<color=[^>]*>/gi, '')   // 游戏内颜色标记 <color=#FF9999FF>
  .replace(/<\/color>/gi, '')
  .replace(/<[^>]+>/g, '')
  .trim();

/* ---------- 描述解析：正文 / 状态说明块 / 逸闻 ---------- */

/* 攻击动作类小节标题：保持正文可见，不转悬停 */
const ACTION_TITLES = new Set(['普通攻击', '重击', '下落攻击', '点按', '长按', '瞄准射击', '瞄准', '蓄力', '冲刺', '元素战技', '元素爆发', '连携技', '终结技', '空中攻击']);
/* 状态说明块正文特征 */
const STATE_BODY_RE = /状态|进入|解除|持续消耗|耗尽|存在期间|结束时|结束时/;
const isStateTitle = (t) => {
  const s = t.trim();
  return s.length >= 2 && s.length <= 14 && !/[。，、：]/.test(s) && !ACTION_TITLES.has(s);
};

/* 逸闻判定：去掉引文后不含机制词；且不以机制连接词开头。
 * 允许段内换行（逸闻常为多行连贯文本），换行仅作普通空白处理 */
const MECH_RE = /状态|伤害|攻击|元素|冷却|持续|回复|恢复|提升|降低|命中|触发|消耗|获得|倍率|夜魂|燃素|战意|护盾|治疗|暴击|防御|生命|月兆|队伍|\d|%|秒|点/;
const MECH_PREFIX = /^(此外|注|该效果|同时|并且|当|若|处于|施放|通过|点按|长按|短按|瞄准|在.+时)/;
const isLorePara = (p) => {
  const flat = p.replace(/\n+/g, '');
  return /「[^」]+」/.test(flat)
    ? !MECH_RE.test(flat.replace(/「[^」]*」/g, ''))
    : flat.includes('。') && flat.length >= 12 && !MECH_RE.test(flat) && !MECH_PREFIX.test(flat);
};

/* 把清洗后的描述拆成「正文 + 逸闻」：从末尾连续截取逸闻段落，至少给正文留一段 */
function splitLore(desc) {
  const paras = String(desc || '').split('\n\n');
  if (paras.length < 2) return { main: desc, lore: '' };
  let cut = paras.length;
  while (cut - 1 > 0 && isLorePara(paras[cut - 1])) cut--;
  if (cut === paras.length) return { main: desc, lore: '' };
  return {
    main: paras.slice(0, cut).join('\n\n'),
    lore: paras.slice(cut).join('\n\n'),
  };
}

/* 完整描述解析：提取「标题+正文」式状态说明块（转为悬停信息），剩余部分再拆逸闻 */
function parseDescription(raw) {
  const paras = stripHtml(raw).split('\n\n');
  const states = [];
  const kept = [];
  for (const para of paras) {
    const lines = para.split('\n');
    if (lines.length >= 2 && isStateTitle(lines[0]) && STATE_BODY_RE.test(lines.slice(1).join(''))) {
      states.push({ name: lines[0].trim(), text: lines.slice(1).join('\n') });
    } else {
      kept.push(para);
    }
  }
  const { main, lore } = splitLore(kept.join('\n\n'));
  return { description: main, lore, states };
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
      skills,
      passives,
      constellations: constellationList,
    };
    writeFileSync(join(OUT_DIR, `${zh}.json`), JSON.stringify(profile, null, 2), 'utf8');
    ok++;
  } catch (e) {
    failed.push(`${zh} (${en}): ${e.message}`);
  }
}

console.log(`\n生成成功 ${ok} 名角色资料`);
if (missing.length) console.log(`genshin-db 无数据（保持无资料页）: ${missing.join('、')}`);
if (failed.length) console.log(`失败:\n  ${failed.join('\n  ')}`);
