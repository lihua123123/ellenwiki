/**
 * sources/gachabase.mjs — 数据源适配器：gachabase（https://gi.gachabase.net）。
 *
 * 社区站点，**含测试服未实装内容**，是本项目唯一能拿到 beta 修订的完整图鉴来源。
 * 角色侧还能给出「加强」文本（buffed_description），武器侧只有技能文本、没有 lv1 数值与逐级曲线
 * （缺的部分交给 lunaris 的 fill 动作补，见 sources/lunaris.mjs）。
 *
 * 接口（SvelteKit）：
 *   清单 /<类别>/beta/__data.json?lang=chs     → 全部条目（含未实装），带 id→真实 slug
 *   日志 /changelog/beta?lang=chs              → 本次 beta 修订涉及的条目 id（武器用它筛候选）
 *   详情 /<类别>/<id>/<slug>/beta/__data.json  → 多行 NDJSON，取 type==='chunk' 的那行，
 *       其 data 是扁平数组，数组/对象里出现的整数都是「指向同数组的下标」，递归解引用还原。
 *
 * 限速：每条间隔 350ms，请勿加大频率。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT, isPlaceholderName } from '../lib/local-store.mjs';

const BASE = 'https://gi.gachabase.net';
const LANG = 'chs';
const IMG_DIR = join(CONTENT, 'characters', 'images');

const UA = {
  'User-Agent': 'ellen-wiki-data-sync/1.0 (+https://github.com/lihua123123/ellenwiki)',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i === tries) throw err;
      await sleep(700 * i);
    }
  }
  throw new Error('unreachable');
}

/* ---------- SvelteKit __data.json 解析 ---------- */
function parseDataJson(text) {
  const chunk = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .find((c) => c.type === 'chunk');
  if (!chunk) throw new Error('未找到 chunk 负载');

  const { data } = chunk;
  const cache = new Map();
  const resolve = (v) => {
    if (typeof v !== 'number') return v;
    if (cache.has(v)) return cache.get(v);
    const raw = data[v];
    if (raw === null || typeof raw !== 'object') {
      cache.set(v, raw);
      return raw;
    }
    const out = Array.isArray(raw) ? raw.map(resolve) : Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, resolve(x)]));
    cache.set(v, out);
    return out;
  };
  return resolve(0);
}

const fetchJson = async (path) => parseDataJson(await fetchText(`${BASE}${path}/__data.json?lang=${LANG}`));

/* ---------- 文本工具 ---------- */
const textOf = (v) => (v && typeof v === 'object' ? (v.text ?? '') : (v ?? ''));

/** 去掉 gachabase 的富文本标记（颜色 / LINK），把字面量 \n 还原成真换行 */
const cleanText = (s) =>
  String(s ?? '')
    .replace(/<color=#[0-9A-Fa-f]+>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/\{LINK#[^}]*\}/g, '')
    .replace(/\{\/LINK\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();

const htmlToText = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/* 角色天赋参数格式化（对齐游戏内格式码） */
function formatParam(value, code) {
  if (typeof value !== 'number') return String(value ?? '');
  switch (code) {
    case 'P': return `${Math.round(value * 100)}%`;
    case 'F1P': return `${(value * 100).toFixed(1)}%`;
    case 'F2P': return `${(value * 100).toFixed(2)}%`;
    case 'F1': return value.toFixed(1);
    case 'F2': return value.toFixed(2);
    case 'I': return String(Math.round(value));
    default: return String(value);
  }
}

/** "一段伤害|{param1:F1P}" + 参数数组 → "36.7%" */
function renderTemplate(text, params) {
  const raw = String(text ?? '');
  const bar = raw.indexOf('|');
  const body = bar >= 0 ? raw.slice(bar + 1) : raw;
  return body.replace(/\{param(\d+):([A-Za-z0-9]+)\}/g, (m, n, code) => {
    const v = params?.[Number(n) - 1];
    return v === undefined ? m : formatParam(v, code);
  });
}

const labelOf = (text) => {
  const raw = String(text ?? '');
  const bar = raw.indexOf('|');
  return bar >= 0 ? raw.slice(0, bar) : raw;
};

/* ---------- 版本号 ---------- */
/**
 * 新条目归属的版本（写进 JSON 的 version 字段，页面按它倒序排列）。
 * beta 修订号形如 7.0.54 —— 这批里「首次出现」的内容属于下一版本（7.1）；
 * 同批标 updated 的（如救赎之斩、血红之证）才是已实装内容，与 genshin-db 对得上。
 * 需要手写时用环境变量覆盖：$env:BETA_VERSION='7.2'; npm run data -- gachabase add
 */
let BETA_VERSION = process.env.BETA_VERSION || '';
async function ensureVersion() {
  if (BETA_VERSION) return BETA_VERSION;
  try {
    const { data } = await fetchJson('/changelog/beta');
    const rev = data?.revisions?.find((r) => r.revision?.version)?.revision?.version || '';
    const m = rev.match(/^(\d+)\.(\d+)/);
    if (m) BETA_VERSION = `${m[1]}.${Number(m[2]) + 1}`;
  } catch { /* 拿不到就留空：条目仍然写入，只是没有版本号 */ }
  return BETA_VERSION;
}

/* ---------- 清单缓存 ---------- */
const cache = { weapons: null, artifacts: null, characters: null, changelogWeaponIds: null };

async function weaponEntries() {
  if (!cache.weapons) {
    const payload = await fetchJson('/weapons/beta');
    cache.weapons = (payload.data?.entries || [])
      .filter((e) => e?.id != null && e.slug && !/^\d+$/.test(e.slug))
      .map((e) => ({ id: e.id, slug: e.slug, enName: textOf(e.name) }))
      .filter((e) => !isPlaceholderName(e.enName));      // 未定名占位武器（Weapon: Catalyst）
  }
  return cache.weapons;
}

async function changelogWeaponIds() {
  if (!cache.changelogWeaponIds) {
    const html = await fetchText(`${BASE}/changelog/beta?lang=${LANG}`);
    cache.changelogWeaponIds = new Set([...html.matchAll(/\/weapons\/(\d+)\//g)].map((m) => m[1]));
  }
  return cache.changelogWeaponIds;
}

async function artifactPayload() {
  if (!cache.artifacts) cache.artifacts = (await fetchJson('/artifacts/beta')).data || {};
  return cache.artifacts;
}

async function characterPayload() {
  if (!cache.characters) cache.characters = (await fetchJson('/characters/beta')).data || {};
  return cache.characters;
}

/* ---------- 条目构造 ---------- */
const ARTIFACT_SLOTS = [
  { typeId: 1, slot: 'flower', slotText: '生之花' },
  { typeId: 2, slot: 'plume', slotText: '死之羽' },
  { typeId: 3, slot: 'sands', slotText: '时之沙' },
  { typeId: 4, slot: 'goblet', slotText: '空之杯' },
  { typeId: 5, slot: 'circlet', slotText: '理之冠' },
];

/** 天赋 id 尾数 → 本项目的技能 id（其余尾数是闪避/跳跃等特殊天赋，页面不展示） */
const TALENT_KIND = { 1: 'attack', 2: 'skill', 5: 'burst' };
const TALENT_TYPE = { attack: '普通攻击', skill: '元素战技', burst: '元素爆发' };

/** gachabase 官方用字 → 本项目沿用的写法 */
const NAME_ALIASES = { 茜特菈莉: '茜特拉莉' };
/** 旅行者/空荧/人偶/奇偶 等多形态或测试用条目：资料由别的来源处理，这里跳过 */
const SKIP_CHARACTER_SLUG = /^(aether|lumine|manekin|traveler)/;
const SKIP_CHARACTER_NAME = /^(旅行者|空|荧|奇偶·)/;

async function buildWeaponEntry({ id, slug }) {
  const path = `/weapons/${id}/${slug}/beta`;
  const { data } = await fetchJson(path);
  const { dto, refs } = data || {};
  if (!dto?.name) throw new Error('缺少 dto');

  const name = textOf(dto.name);
  const typeName = textOf(refs.weapon_types?.[dto.weapon_type_id]?.name);
  const secondary = (dto.attributes || []).find((a) => refs.stats?.[a.attribute_id]?.format !== 'Integer');
  const mainStat = secondary ? textOf(refs.stats[secondary.attribute_id].name) : '';

  // 满级数值从详情页 HTML 取：payload 里的 growth_curves 刻度与显示值不同量纲
  const page = htmlToText(await fetchText(`${BASE}${path}?lang=${LANG}`));
  const atkMax = Number((page.match(/基础攻击力\s*([\d.]+)/) || [])[1] || 0);
  const statRe = mainStat ? new RegExp(`(?<!基础)${mainStat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\d.]+%?)`) : null;
  const mainStatMax =
    (statRe && (page.match(statRe) || [])[1])
    || (page.match(/基础攻击力\s*[\d.]+(?:\([\d.]+\))?\s*([\d.]+%?)/) || [])[1]
    || '';

  const refinements = (dto.refinements || []).map((r, i) => ({ level: i + 1, description: cleanText(textOf(r.description)), values: [] }));
  const costs = (dto.promotions || [])
    .filter((p) => (p.upgrade_costs || []).length)
    .map((p, i) => ({
      stage: i + 1,
      items: p.upgrade_costs.map((c) => ({ name: textOf(refs.items?.[c.item_id]?.name) || String(c.item_id), count: c.amount })),
    }));

  return {
    name,
    id: Number(id),
    rarity: dto.rarity,
    type: typeName,
    typeId: '',
    baseAtk: null,
    mainStat,
    mainStatValue: '',
    mainStatPercent: mainStatMax.includes('%'),
    mainStatMax,
    atkMax,
    maxLevel: 90,
    source: '',
    effectName: refinements[0] ? textOf(dto.refinements[0].name) : '',
    description: cleanText(textOf(dto.description)),
    story: (dto.lore?.pages || []).map((p) => cleanText(textOf(p.content))).filter(Boolean).join('\n\n'),
    refinements,
    costs,
    icon: '',
    iconUrl: refs.assets?.[dto.assets?.icon_path_hash]?.url || '',
    version: await ensureVersion(),
    beta: true,
  };
}

async function buildArtifactEntry(id) {
  const { entries = [], refs = {} } = await artifactPayload();
  const e = entries.find((x) => String(x?.id) === String(id));
  if (!e) throw new Error('清单里没有该套装');
  const name = textOf(e.name);
  if (!name) throw new Error('缺少名称');

  const effectOf = (pieces) => textOf((e.set_effects || []).find((s) => s.pieces === pieces)?.description);
  const pieces = (e.pieces || []).map((p) => {
    const slot = ARTIFACT_SLOTS.find((s) => s.typeId === p.piece_type_id);
    return {
      slot: slot?.slot || '',
      slotText: slot?.slotText || '',
      name: textOf(p.name),
      description: cleanText(textOf(p.description)),
      story: (p.lore?.pages || []).map((x) => cleanText(textOf(x.content)).replace(/^\n+/, '')).join('\n\n'),
      icon: '',
      iconUrl: refs.assets?.[p.icon_path_hash]?.url || '',
    };
  });

  return {
    name,
    id: Number(e.id),
    rarity: e.rarities || [4, 5],
    effect1Pc: effectOf(1),
    effect2Pc: effectOf(2),
    effect4Pc: effectOf(4),
    pieces,
    icon: '',
    iconUrl: refs.assets?.[e.icon_path_hash]?.url || '',
    version: await ensureVersion(),
    beta: true,
  };
}

async function download(url, file) {
  if (!url || existsSync(file)) return false;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  mkdirSync(IMG_DIR, { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function buildCharacterEntry(entry, { dry = false } = {}) {
  const { data, refs: listRefs = {} } = await fetchJson(`/characters/${entry.id}/${entry.slug}/beta`);
  const dto = data?.dto;
  const refs = data?.refs || listRefs;
  if (!dto?.name) throw new Error('缺少 dto');

  const name = textOf(dto.name);

  /* 常规天赋 id 为 5 位（尾数 1=普攻 / 2=战技 / 5=爆发）；闪避、跳跃等特殊天赋是 6 位 */
  const seenKind = new Set();
  const skills = (dto.talents || [])
    .filter((t) => String(t.id).length === 5)
    .map((t) => ({ talent: t, kind: TALENT_KIND[Number(String(t.id).slice(-1))] }))
    .filter(({ kind }) => kind && !seenKind.has(kind) && seenKind.add(kind) !== undefined)
    .map(({ talent: t, kind }) => {
      const levels = [];
      (t.levels?.[0]?.descriptions || []).forEach((d, i) => {
        levels.push({
          label: labelOf(textOf(d.text)),
          values: (t.levels || []).map((lv) => renderTemplate(textOf(lv.descriptions?.[i]?.text), lv.parameters)),
        });
      });
      return { id: kind, type: TALENT_TYPE[kind], name: textOf(t.name), description: cleanText(textOf(t.description)), lore: '', states: [], levels };
    });

  const passives = (dto.passives || []).map((p) => ({
    name: textOf(p.name),
    description: cleanText(textOf(p.description)),
    category: Number(p.required_ascension) > 0 ? 'ascension' : 'utility',
  }));

  const constellations = (dto.constellations || []).map((c, i) => ({
    level: i + 1,
    name: textOf(c.name),
    description: cleanText(textOf(c.description)),
  }));

  /* 头像（方形立绘）：仅新增时下载 */
  const avatarUrl = refs.assets?.[dto.assets?.square_icon_path_hash]?.url || '';
  let avatar = '';
  if (avatarUrl && !dry) {
    try {
      avatar = (await download(avatarUrl, join(IMG_DIR, `${name}.png`))) ? `${name}.png` : '';
    } catch { /* 头像失败不影响数据 */ }
  }

  const element = textOf(refs.elements?.[dto.elements?.[0]?.element_id]?.name);
  const weaponType = textOf(refs.weapon_types?.[dto.weapon_type_id]?.name);
  const burst = skills.find((s) => s.id === 'burst');
  const energy = (burst?.levels?.find((l) => l.label.includes('元素能量'))?.values?.[0] || '').replace(/[^\d]/g, '');

  return {
    data: {
      name,
      id: Number(dto.id || entry.id),
      title: textOf(dto.profile?.title),
      rarity: dto.rarity,
      version: await ensureVersion(),
      description: cleanText(textOf(dto.description)),
      skills,
      passives,
      constellations,
      beta: true,
    },
    attach: { element, weaponType, energy },
    avatar,
  };
}

const matchName = (e, name) => e.name === name || e.name === NAME_ALIASES[name];

export default {
  id: 'gachabase',
  label: 'gachabase',
  note: '最新（含测试服未实装）· 角色带「加强」文本；武器缺数值（用 lunaris 补）',
  beta: true,
  kinds: ['character', 'weapon', 'artifact'],
  url: `${BASE}/changelog/beta`,

  /**
   * 扫描 / 导入用的候选：
   *   武器 = beta 日志里涉及的条目（避免把已实装武器按低精度数据抓回来）
   *   角色 / 圣遗物 = 全量清单（本地是否已有按 id / 名称判断）
   */
  async list(kind) {
    if (kind === 'weapon') {
      const [entries, ids] = await Promise.all([weaponEntries(), changelogWeaponIds()]);
      return entries.filter((e) => ids.has(String(e.id)));
    }
    if (kind === 'artifact') {
      const { entries = [] } = await artifactPayload();
      return entries.filter((e) => e?.id).map((e) => ({ id: e.id, name: textOf(e.name) }));
    }
    const { entries = [] } = await characterPayload();
    return entries
      .filter((e) => e?.id && e.slug && !/^\d+$/.test(e.slug) && !SKIP_CHARACTER_SLUG.test(e.slug))
      .map((e) => ({ id: e.id, name: NAME_ALIASES[textOf(e.name)] || textOf(e.name), slug: e.slug, enName: textOf(e.name) }))
      .filter((e) => e.name && !SKIP_CHARACTER_NAME.test(e.name));
  },

  /** 定位单条（复查用）：先 id，再名称 —— 这里用「完整清单」，不受 beta 日志限制 */
  async resolve(kind, { name, id } = {}) {
    let list;
    if (kind === 'weapon') list = await weaponEntries();
    else if (kind === 'artifact') {
      const { entries = [] } = await artifactPayload();
      list = entries.filter((e) => e?.id).map((e) => ({ id: e.id, name: textOf(e.name) }));
    } else {
      const { entries = [] } = await characterPayload();
      list = entries
        .filter((e) => e?.id && e.slug && !/^\d+$/.test(e.slug) && !SKIP_CHARACTER_SLUG.test(e.slug))
        .map((e) => ({ id: e.id, name: NAME_ALIASES[textOf(e.name)] || textOf(e.name), slug: e.slug, enName: textOf(e.name) }));
    }
    if (id != null) {
      const hit = list.find((e) => String(e.id) === String(id));
      if (hit) return hit;
    }
    if (!name) return null;
    return list.find((e) => matchName(e, name) || e.enName === name) || null;
  },

  async fetch(kind, entry, { dry = false } = {}) {
    if (!entry) return null;
    if (kind === 'weapon') {
      const data = await buildWeaponEntry(entry);
      return isPlaceholderName(data.name) ? null : { data };      // 未定名条目（如「武器-法器」）丢弃
    }
    if (kind === 'artifact') {
      const data = await buildArtifactEntry(entry.id);
      return isPlaceholderName(data.name) ? null : { data };
    }
    if (kind === 'character') {
      await sleep(350);
      const res = await buildCharacterEntry(entry, { dry });
      if (!res.data?.name || SKIP_CHARACTER_NAME.test(res.data.name) || isPlaceholderName(res.data.name) || !res.data.skills.length) return null;
      return res;
    }
    return null;
  },
};
