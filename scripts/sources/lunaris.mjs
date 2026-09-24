/**
 * sources/lunaris.mjs — 数据源适配器：lunaris.moe（api.lunaris.moe，有 CHS 中文）。
 *
 * 定位：**补全型**第三方源。适合
 *   · 武器 / 圣遗物：本地还没有的新条目（含武器逐级数值）
 *   · 角色：整体覆盖会给不出 title/rarity/技能等级表，所以角色只提供「补全（fill）」：
 *     基础属性曲线、本地缺的固有天赋、状态说明词条（hyperlinks）、逸闻（<i> 斜体段）
 *
 * 接口：/data/version.json、/data/<版本>/{charlist,weaponlist,artifactlist}.json、
 *       /data/<版本>/chs/{char|weapon|artifact}/<id>.json
 *
 * 清单里混有历史遗留（如 15004「冰之川与雪之砂」= 1.2 beta 残留），因此 list() 只取
 * 「当前版本清单有、上一个 X.Y.0 正式快照没有」的 id。
 */
import { parseDescription } from '../lib/profile-text.mjs';
import { statsFromLunaris } from '../lib/char-stats.mjs';
import { isPlaceholderName } from '../lib/local-store.mjs';
import { API, fetchJson, cleanText, buildWeapon, buildArtifact } from '../lib/lunaris.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本项目角色名 → lunaris 角色 id（旅行者按元素拆开，文案与男女无关，统一取男主角） */
const TRAVELERS = {
  '旅行者（风）': '10000005_ANEMO',
  '旅行者（岩）': '10000005_GEO',
  '旅行者（雷）': '10000005_ELECTRO',
  '旅行者（草）': '10000005_DENDRO',
  '旅行者（水）': '10000005_HYDRO',
  '旅行者（火）': '10000005_PYRO',
  '旅行者（冰）': '10000005_CRYO',
};

/** 本项目角色名 → lunaris 角色名（两边用字不同时） */
const CHAR_ALIASES = { '茜特拉莉': '茜特菈莉' };
/** lunaris 用字 → 本项目用字（反向） */
const LOCAL_NAMES = Object.fromEntries(Object.entries(CHAR_ALIASES).map(([local, remote]) => [remote, local]));
/** 多形态 / 非可玩条目：不参与角色清单与复查 */
const SKIP_CHARACTERS = /^(旅行者|空|荧|奇偶·)/;

/* ---------- 版本与清单缓存 ---------- */
let verCache = null;
async function versionInfo() {
  if (!verCache) {
    const info = await fetchJson(`${API}/version.json`);
    const ver = process.env.LUNARIS_VERSION || info.version;
    const refVer = (info.versions || []).find((v) => /^\d+\.\d+\.0$/.test(v) && v !== ver) || '';
    verCache = { ver, latest: info.version, refVer };
  }
  return verCache;
}

const listCache = new Map();
async function rawList(file) {
  if (!listCache.has(file)) {
    const { ver } = await versionInfo();
    listCache.set(file, await fetchJson(`${API}/${ver}/${file}`));
  }
  return listCache.get(file);
}

/** "7.1.0" → "7.1"（写进 version 字段，用于图鉴排序） */
const verMajor = (v) => {
  const m = String(v).match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : String(v);
};

/** 只保留「当前版本有、上一个正式快照没有」且带中文名的条目 */
async function freshEntries(file) {
  const [list, { refVer }] = [await rawList(file), await versionInfo()];
  let refIds = new Set();
  if (refVer) {
    try {
      refIds = new Set(Object.keys(await fetchJson(`${API}/${refVer}/${file}`)));
    } catch { /* 拿不到参考版本就不做历史过滤 */ }
  }
  return Object.entries(list)
    .map(([id, v]) => ({ ...v, id, name: cleanText(v.chsName || '') }))
    .filter((e) => e.name && /\p{Script=Han}/u.test(e.name) && !isPlaceholderName(e.name) && !isPlaceholderName(e.enName))
    .filter((e) => !(refIds.size && refIds.has(e.id)));
}

async function characterList() {
  const list = await rawList('charlist.json');
  return Object.entries(list)
    .map(([id, v]) => ({ id, name: cleanText(v.chsName || v.enName || '') }))
    .map((e) => ({ ...e, name: LOCAL_NAMES[e.name] || e.name }))
    .filter((e) => e.name && !SKIP_CHARACTERS.test(e.name));
}

/* ---------- 角色补全（fill） ---------- */

/** 从 lunaris 正文里取出 {LINK#N<id>} 引用的词条（按出现顺序去重；S 类链接无量词条定义） */
function linkedEntries(raw, glossary) {
  const out = [];
  const seen = new Set();
  for (const m of String(raw || '').matchAll(/\{LINK#([NS]?)(\d+)\}/g)) {
    if (m[1] === 'S') continue;                 // {LINK#S11402} 指向技能本体，没有词条定义
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const g = glossary.get(m[2]);
    if (g) out.push(g);
  }
  return out;
}

/**
 * 按「该条目正文真正 LINK 引用了哪些词条」同步 states（补缺 + 收掉误挂的）。
 * 判据必须是 LINK 标记而不是「名字在正文里出现过」：沃雅妮莎元素爆发里的「领唱」是领唱者（主语），
 * 与固有天赋里叠层的「领唱」同名不同义 —— 前者没有 LINK，不应当挂叠层说明。
 */
function applyStates(item, entries, glossaryList) {
  let changed = 0;
  const byName = new Map(glossaryList.map((g) => [g.name, g]));
  for (const holder of [item, item.buffs].filter(Boolean)) {
    const states = holder.states || [];
    const have = new Set(states.map((s) => s.name));
    const desc = holder.description || '';
    const kept = states.filter((s) => {
      const g = byName.get(s.name);
      return !g || g.text !== s.text || entries.some((w) => w.name === s.name);
    });
    const add = entries.filter((g) => !have.has(g.name) && desc.includes(g.name)).map((g) => ({ name: g.name, text: g.text }));
    const next = [...kept, ...add];
    if (JSON.stringify(next) === JSON.stringify(states)) continue;
    holder.states = next;
    changed++;
  }
  return changed;
}

/** 逸闻：lunaris 放在正文的 <i>…</i> 里；本地缺（或没有同一段）时补上，不覆盖手工文案 */
function applyLore(item, raw) {
  const italics = [...String(raw || '').matchAll(/<i>([\s\S]*?)<\/i>/g)].map((m) => cleanText(m[1]).trim()).filter(Boolean);
  if (!italics.length) return 0;
  const text = italics.join('\n');
  const probe = italics[0].slice(0, 12);
  let changed = 0;
  for (const holder of [item, item.buffs].filter(Boolean)) {
    const have = String(holder.lore || '');
    if (have && have.includes(probe)) continue;
    if (String(holder.description || '').includes(probe)) continue;
    holder.lore = text;
    changed++;
  }
  return changed;
}

/** 天赋分类：lunaris 图标编号 _05/_06 = 突破天赋，_07/_08 = 固有天赋 */
function categoryOf(raw) {
  const icon = String(raw?.icon || raw?.iconName || raw?.iconPath || '');
  const m = icon.match(/_(\d\d)$/);
  if (!m) return 'utility';
  return ['05', '06'].includes(m[1]) ? 'ascension' : 'utility';
}

/** 用 lunaris 的单角色数据补全本地角色：基础属性 + 缺失天赋 + 状态说明 + 逸闻 */
function enrichCharacter(local, dto) {
  const next = JSON.parse(JSON.stringify(local));
  const notes = [];

  /* 1) 基础属性曲线：genshin-db 没有的角色（旅行者 / 未实装）本地没有 stats */
  if (!next.stats) {
    const stats = statsFromLunaris(dto.info?.attributes);
    if (stats) {
      next.stats = stats;
      notes.push(`基础属性（${stats.label}）`);
    }
  }

  /* 2) 本地缺失的天赋 / 固有天赋 / 命座（如旅行者的「异邦的××」） */
  const localNames = new Set([...(next.skills || []), ...(next.passives || []), ...(next.constellations || [])].map((x) => x.name));
  for (const src of Object.values(dto.passives || {})) {
    const name = cleanText(src?.name);
    if (!name || localNames.has(name)) continue;
    const { description, lore, states } = parseDescription(cleanText(src.description));
    next.passives = [...(next.passives || []), { name, description, lore, states, category: categoryOf(src) }];
    localNames.add(name);
    notes.push(`固有天赋「${name}」`);
  }

  /* 3) 状态说明词条 + 逸闻：按正文里的 {LINK#N<id>} 标记与 <i> 斜体段同步 */
  const glossary = new Map();
  for (const h of dto.hyperlinks || []) {
    const gName = cleanText(h.name);
    const gText = cleanText(h.description);
    if (gName.length >= 2 && gText) glossary.set(String(h.id), { name: gName, text: gText });
  }
  const glossaryList = [...glossary.values()];
  const locals = new Map();
  for (const it of [...(next.skills || []), ...(next.passives || []), ...(next.constellations || [])]) {
    if (it.name) locals.set(it.name, it);
  }
  let states = 0;
  let lore = 0;
  for (const src of [...Object.values(dto.skills || {}), ...Object.values(dto.passives || {}), ...Object.values(dto.constellations || {})]) {
    const target = locals.get(cleanText(src?.name));
    if (!target) continue;
    if (glossary.size) states += applyStates(target, linkedEntries(src.description, glossary), glossaryList);
    lore += applyLore(target, src.description);
  }
  if (states) notes.push(`状态说明 ${states} 处`);
  if (lore) notes.push(`逸闻 ${lore} 处`);

  if (!notes.length) return null;
  return { data: next, notes };
}

/* ---------- 并发池（对第三方接口保持克制：并发 4 + 每条 120ms） ---------- */
async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
      await sleep(120);
    }
  });
  await Promise.all(runners);
}

/** 角色：本地名（含旅行者）→ lunaris id（清单名已归一成本项目写法） */
async function charIdOf(name, list) {
  if (TRAVELERS[name]) return TRAVELERS[name];
  const direct = list.find((e) => e.name === name);
  if (direct) return direct.id;
  const remote = CHAR_ALIASES[name];              // 本项目用字 → lunaris 用字
  if (!remote) return '';
  return list.find((e) => e.name === (LOCAL_NAMES[remote] || remote))?.id || '';
}

export default {
  id: 'lunaris',
  label: 'lunaris.moe',
  note: '第三方图鉴（CHS，含体验服）· 武器/圣遗物可整体覆盖，角色只能补全',
  beta: true,
  kinds: ['character', 'weapon', 'artifact'],
  /** 可整体抓取并被 check 覆盖的类别（角色只能 fill） */
  full: ['weapon', 'artifact'],
  url: `${API}/version.json`,

  async list(kind) {
    if (kind === 'character') return characterList();
    if (kind === 'weapon') return freshEntries('weaponlist.json');
    if (kind === 'artifact') return freshEntries('artifactlist.json');
    return [];
  },

  async resolve(kind, { name, id } = {}) {
    if (kind === 'character') {
      const list = await characterList();
      if (id != null) {
        const hit = list.find((e) => String(e.id) === String(id));
        if (hit) return hit;
      }
      const cid = name ? await charIdOf(name, list) : '';
      return cid ? { id: cid, name } : null;
    }
    const file = kind === 'weapon' ? 'weaponlist.json' : 'artifactlist.json';
    const list = await rawList(file);
    const entries = Object.entries(list)
      .map(([eid, v]) => ({ ...v, id: eid, name: cleanText(v.chsName || '') }))
      .filter((e) => e.name && !isPlaceholderName(e.name));
    if (id != null) {
      const hit = entries.find((e) => String(e.id) === String(id));
      if (hit) return hit;
    }
    if (!name) return null;
    return entries.find((e) => e.name === name || e.chsName === name) || null;
  },

  async fetch(kind, entry) {
    if (!entry) return null;
    const { ver } = await versionInfo();
    if (kind === 'weapon' || kind === 'artifact') {
      const dto = await fetchJson(`${API}/${ver}/chs/${kind}/${entry.id}.json`);
      const data = kind === 'weapon'
        ? buildWeapon(entry, dto, { version: verMajor(ver), beta: true })
        : buildArtifact(entry, dto, { version: verMajor(ver), beta: true });
      return data?.name ? { data } : null;
    }
    return null;                       // 角色由 fill 处理，见 enrich()
  },

  /**
   * 补全本地条目（不改已有值，只填空）。
   * character：基础属性 / 缺失天赋 / 状态说明 / 逸闻
   * weapon：beta 且缺数值（baseAtk 为空或没有 curve）时，用 lunaris 的逐级数值补上，保留本地突破材料与故事
   */
  async enrich(kind, entry, local) {
    if (!entry || !local) return null;
    const { ver } = await versionInfo();
    if (kind === 'character') {
      const dto = await fetchJson(`${API}/${ver}/chs/char/${entry.id}.json`);
      return enrichCharacter(local, dto);
    }
    if (kind === 'weapon') {
      const incomplete = local.beta && (local.baseAtk === null || local.baseAtk === undefined || !local.curve);
      if (!incomplete) return null;
      const dto = await fetchJson(`${API}/${ver}/chs/weapon/${entry.id}.json`);
      const remote = buildWeapon(entry, dto, { version: local.version || verMajor(ver), beta: true });
      if (!remote?.name || !remote.curve) return null;
      const data = { ...remote, id: local.id ?? remote.id };
      if (local.costs?.length) data.costs = local.costs;
      if (local.story) data.story = local.story;
      if (local.source) data.source = local.source;
      if (!data.costs?.length) delete data.costs;
      return { data, notes: ['武器逐级数值'] };
    }
    return null;                       // 圣遗物：lunaris 没有部位描述与故事，没有可补的
  },

  /** 并发池：给 registry 的 fill 批量动作使用 */
  runPool,
};
