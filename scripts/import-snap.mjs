/**
 * import-snap.mjs — 从 Snap.Metadata 元数据仓库导入角色资料（补 genshin-db 未收录的新角色）。
 *
 * 数据源：https://raw.githubusercontent.com/SnapHutaoRemasteringProject/Snap.Metadata/main/Genshin/CHS/Avatar/<id>.json
 * 输出 content/characters/<本地名>.json（与本项目 generate-profiles 产物同 schema），
 * 并从 enka CDN 抓头像 content/characters/images/<本地名>.png。
 *
 * 用法: node scripts/import-snap.mjs
 */
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'content', 'characters');
const IMG_DIR = join(OUT_DIR, 'images');
mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/SnapHutaoRemasteringProject/Snap.Metadata/main/Genshin/CHS/Avatar';
const ENKA_UI = 'https://enka.network/ui';

/* 本地名 → { id: Snap.Metadata Avatar Id, snap: 元数据里的官方名 } */
const TARGETS = [
  { name: '雅柯达', id: 10000124, snap: '雅珂达' },   // md 用字与官方不同，沿用本地名
];

/* ---------- 与 generate-profiles 相同的清洗/拆分逻辑 ---------- */
const stripHtml = (s) => String(s || '')
  .replace(/\{LINK#[^}]*\}/g, '')
  .replace(/\{\/LINK\}/g, '')
  .replace(/<color=[^>]*>/gi, '')
  .replace(/<\/color>/gi, '')
  .replace(/<[^>]+>/g, '')
  .trim();

const ACTION_TITLES = new Set(['普通攻击', '重击', '下落攻击', '点按', '长按', '瞄准射击', '瞄准', '蓄力', '冲刺', '元素战技', '元素爆发', '连携技', '终结技', '空中攻击']);
const STATE_BODY_RE = /状态|进入|解除|持续消耗|耗尽|存在期间|结束时/;
const isStateTitle = (t) => {
  const s = t.trim();
  return s.length >= 2 && s.length <= 14 && !/[。，、：]/.test(s) && !ACTION_TITLES.has(s);
};
const MECH_RE = /状态|伤害|攻击|元素|冷却|持续|回复|恢复|提升|降低|命中|触发|消耗|获得|倍率|夜魂|燃素|战意|护盾|治疗|暴击|防御|生命|月兆|队伍|\d|%|秒|点/;
const MECH_PREFIX = /^(此外|注|该效果|同时|并且|当|若|处于|施放|通过|点按|长按|短按|瞄准|在.+时)/;
/* 逸闻判定：去掉引文后不含机制词；且不以机制连接词开头。
 * 允许段内换行（逸闻常为多行连贯文本），换行仅作普通空白处理 */
const isLorePara = (p) => {
  const flat = p.replace(/\n+/g, '');
  return /「[^」]+」/.test(flat)
    ? !MECH_RE.test(flat.replace(/「[^」]*」/g, ''))
    : flat.includes('。') && flat.length >= 12 && !MECH_RE.test(flat) && !MECH_PREFIX.test(flat);
};

function splitLore(desc) {
  const paras = String(desc || '').split('\n\n');
  if (paras.length < 2) return { main: desc, lore: '' };
  let cut = paras.length;
  while (cut - 1 > 0 && isLorePara(paras[cut - 1])) cut--;
  if (cut === paras.length) return { main: desc, lore: '' };
  return { main: paras.slice(0, cut).join('\n\n'), lore: paras.slice(cut).join('\n\n') };
}

function parseDescription(raw) {
  const paras = stripHtml(raw).split('\n\n');
  const states = [];
  const kept = [];
  for (const para of paras) {
    const lines = para.split('\n');
    if (lines.length >= 2 && isStateTitle(lines[0]) && STATE_BODY_RE.test(lines.slice(1).join(''))) {
      states.push({ name: lines[0].trim(), text: lines.slice(1).join('\n') });
    } else kept.push(para);
  }
  const { main, lore } = splitLore(kept.join('\n\n'));
  return { description: main, lore, states };
}

/* ---------- 数值格式化与等级行 ---------- */
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

/* Snap.Metadata Proud: Descriptions[label|{paramN:FMT}], Parameters[{Id,Level,Parameters[param1..]}] */
function buildLevels(proud) {
  if (!proud?.Descriptions?.length || !proud?.Parameters?.length) return [];
  const byLevel = new Map(proud.Parameters.map(p => [p.Level, p.Parameters]));
  const maxLevel = Math.max(...proud.Parameters.map(p => p.Level), 15);

  return proud.Descriptions.map(rawLabel => {
    const parts = String(rawLabel).split('|');
    let template = parts.slice(1).join('|');
    if (!template.includes('{param')) template = parts[0];
    const labelText = (PARAM_RE.lastIndex = 0, parts[0].replace(PARAM_RE, '').trim());
    PARAM_RE.lastIndex = 0;
    const extraText = template.replace(PARAM_RE, '').replace(/[:：\s]+/g, '');
    const label = extraText && extraText !== labelText ? `${labelText}（${extraText}）` : labelText;

    const values = Array.from({ length: 15 }, (_, lv) => {
      const params = byLevel.get(lv + 1);
      if (!params) return '-';
      return template.replace(PARAM_RE, (_, n, code) => {
        const v = params[parseInt(n, 10) - 1];
        return v === undefined ? '-' : fmtValue(v, code);
      });
    });
    return { label, values };
  }).filter(r => r.label || r.values.some(v => v !== '-'));
}

/* 带重试的抓取；连续失败时回退到本地缓存文件 .snap-<id>.json */
async function fetchJson(url, cacheName) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        writeFileSync(join(ROOT, cacheName), text, 'utf8');
        return JSON.parse(text);
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  const cached = join(ROOT, cacheName);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  throw new Error(`无法获取 ${url}`);
}

/* ---------- 主流程 ---------- */
for (const t of TARGETS) {
  const d = await fetchJson(`${BASE}/${t.id}.json`, `.snap-${t.id}.json`);
  const depot = d.SkillDepot;

  const skills = [];
  if (depot.Skills?.[0]) skills.push({ id: 'attack', type: '普通攻击', s: depot.Skills[0] });
  if (depot.Skills?.[1]) skills.push({ id: 'skill', type: '元素战技', s: depot.Skills[1] });
  if (depot.EnergySkill) skills.push({ id: 'burst', type: '元素爆发', s: depot.EnergySkill });

  const skillList = skills.map(({ id, type, s }) => {
    const { description, lore, states } = parseDescription(s.Description);
    return { id, type, name: s.Name, description, lore, states, levels: buildLevels(s.Proud) };
  });

  /* Inherents：前 2 个为战斗被动（突破天赋），其后为固有天赋（含月兆祝礼/生活类） */
  const passives = (depot.Inherents || []).map((p, i) => {
    const { description, lore, states } = parseDescription(p.Description);
    return { name: p.Name, description, lore, states, category: i < 2 ? 'ascension' : 'utility' };
  });

  const constellationList = (depot.Talents || []).map((c, i) => {
    const { description, lore, states } = parseDescription(c.Description);
    return { level: i + 1, name: c.Name, description, lore, states };
  });

  const profile = {
    name: t.name,
    title: d.FetterInfo?.Title || '',
    rarity: d.Quality || '',
    description: stripHtml(d.Description || d.FetterInfo?.Detail || ''),
    skills: skillList,
    passives,
    constellations: constellationList,
  };
  writeFileSync(join(OUT_DIR, `${t.name}.json`), JSON.stringify(profile, null, 2), 'utf8');
  console.log(`✓ 资料 ${t.name}（${d.Name}）: skills=${skillList.length} passives=${passives.length} constellations=${constellationList.length}`);

  /* 头像 */
  const imgFile = join(IMG_DIR, `${t.name}.png`);
  if (!existsSync(imgFile) && d.Icon) {
    try {
      const r2 = await fetch(`${ENKA_UI}/${d.Icon}.png`);
      if (r2.ok) {
        writeFileSync(imgFile, Buffer.from(await r2.arrayBuffer()));
        console.log(`✓ 头像 ${d.Icon}.png`);
      } else console.log(`✗ 头像 HTTP ${r2.status}`);
    } catch (e) { console.log(`✗ 头像 ${e.message}`); }
  }
}
