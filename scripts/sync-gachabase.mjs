/**
 * sync-gachabase.mjs — 从 gachabase 同步「最新」图鉴数据（含测试服未实装内容）。
 *
 * 定位：本项目唯一的外部数据同步入口，不再区分正式服 / 测试服 —— 每次跑都按当前最新数据补齐。
 *   已实装的角色/武器/圣遗物仍然以本地文件（ genshin-db 生成，含逐级曲线、等级数值表）为准，
 *   本脚本只负责把「本地还没有的」新内容抓回来，因此不会覆盖已实装条目的高精度数据。
 *
 * 数据源：https://gi.gachabase.net （社区站点，robots.txt 允许抓取；脚本已限速，请勿加大频率）
 *   清单：/<类别>/beta/__data.json?lang=chs      → 全部条目（含未实装），含 id→真实 slug
 *   日志：/changelog/beta?lang=chs               → 本次测试服改动到的条目 id
 *   详情：/<类别>/<id>/<slug>/beta/__data.json?lang=chs
 *         SvelteKit 的多行 NDJSON，取 type==='chunk' 那行的 data —— 扁平数组，
 *         数组/对象里出现的整数都是「指向同数组的下标」，递归解引用即可还原成对象。
 *
 * 输出（新条目都带 "beta": true 与 version = 下一版本号，便于页面按版本倒序排在最前）：
 *   content/weapons/<中文名>.json      新武器（缺 lv1 数值与逐级曲线）
 *   content/artifacts/<中文名>.json    新圣遗物套装（2/4 件套效果 + 5 部位含故事）
 *   content/characters/<中文名>.json   新角色（称号/星级/技能 15 级数值/固有天赋/命座）
 *   content/characters/images/<名>.png 新角色头像
 *   content/attachment/元素附着及产球.md 为新角色追加占位小节（幂等，附着/产球数据待人工补）
 *   content/meta/gachabase-new.json    本次同步明细（便于复查）
 *
 * 用法：
 *   node scripts/sync-gachabase.mjs          # 同步（已纳入 npm run data）
 *   node scripts/sync-gachabase.mjs --dry    # 只抓取与打印，不写任何文件
 */
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  weapons: join(ROOT, 'content', 'weapons'),
  artifacts: join(ROOT, 'content', 'artifacts'),
  characters: join(ROOT, 'content', 'characters'),
  images: join(ROOT, 'content', 'characters', 'images'),
};
const MD_FILE = join(ROOT, 'content', 'attachment', '元素附着及产球.md');
const META_FILE = join(ROOT, 'content', 'meta', 'gachabase-new.json');

const BASE = 'https://gi.gachabase.net';
const LANG = 'chs';
const DRY = process.argv.includes('--dry');
/** --force：连之前同步过的测试服条目一起重抓（测试服数值会被后续 revision 调整） */
const FORCE = process.argv.includes('--force');

/**
 * 测试服条目归属的版本（写进 JSON 的 version 字段，页面按它倒序排列）。
 * gachabase 的 beta 修订号形如 7.0.54 —— 这批 beta 里「首次出现」的内容属于下一个版本（7.1），
 * 而同一批里标 updated 的（如救赎之斩、血红之证）才是 7.0 已实装内容，与 genshin-db 对得上。
 * 需要手写时用环境变量覆盖：$env:BETA_VERSION='7.2'; npm run data:sync
 */
let BETA_VERSION = process.env.BETA_VERSION || '';

async function resolveBetaVersion() {
  if (BETA_VERSION) return BETA_VERSION;
  try {
    const { data } = await fetchJson('/changelog/beta');
    const rev = data?.revisions?.find((r) => r.revision?.version)?.revision?.version || '';
    const m = rev.match(/^(\d+)\.(\d+)/);
    if (m) BETA_VERSION = `${m[1]}.${Number(m[2]) + 1}`;
  } catch {
    // 拿不到就留空：条目仍然会写入，只是没有版本号（页面排在最后）
  }
  return BETA_VERSION;
}

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
    const out = Array.isArray(raw)
      ? raw.map(resolve)
      : Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, resolve(x)]));
    cache.set(v, out);
    return out;
  };
  return resolve(0);
}

const fetchJson = async (path) => parseDataJson(await fetchText(`${BASE}${path}/__data.json?lang=${LANG}`));

/* ---------- 文本工具 ---------- */
const textOf = (v) => (v && typeof v === 'object' ? (v.text ?? '') : (v ?? ''));

/** 去掉 gachabase 的富文本标记（颜色 / LINK / 换行），保留纯文本 */
const cleanText = (s) =>
  String(s ?? '')
    .replace(/<color=#[0-9A-Fa-f]+>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/\{LINK#[^}]*\}/g, '')
    .replace(/\{\/LINK\}/g, '')
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

/* ---------- 本地已有序号 / 名称 ---------- */
function loadLocal(dir) {
  const ids = new Set();
  const names = new Set();
  const betaIds = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (d.id) {
        ids.add(String(d.id));
        if (d.beta) betaIds.add(String(d.id));
      }
      if (d.name) names.add(d.name);
    } catch { /* 忽略坏文件 */ }
  }
  return { ids, names, betaIds };
}

/** 已存在且不是本脚本同步来的（或未被 --force 要求重刷）就跳过 */
const isLocal = (local, id) => local.ids.has(String(id)) && !(FORCE && local.betaIds.has(String(id)));

const writeJson = (file, obj) => {
  if (DRY) {
    console.log(`   [dry] 会写入 ${file.replace(ROOT, '.')}`);
    return;
  }
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
};

async function download(url, file) {
  if (DRY) return;
  if (existsSync(file)) return;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/* ================= 武器 ================= */
async function syncWeapons() {
  const local = loadLocal(DIRS.weapons);
  const list = (await fetchJson('/weapons/beta')).data.entries || [];
  const slugById = new Map();
  for (const e of list) {
    if (e?.id != null && e.slug && !/^\d+$/.test(e.slug)) slugById.set(String(e.id), e.slug);
  }

  const changelog = await fetchText(`${BASE}/changelog/beta?lang=${LANG}`);
  const ids = [...new Set([...changelog.matchAll(/\/weapons\/(\d+)\//g)].map((m) => m[1]))];

  const made = [];
  for (const id of ids) {
    const slug = slugById.get(id);
    if (!slug || isLocal(local, id)) continue;
    const path = `/weapons/${id}/${slug}/beta`;
    try {
      const { data } = await fetchJson(path);
      const { dto, refs } = data || {};
      if (!dto?.name) throw new Error('缺少 dto');

      const name = textOf(dto.name);
      const typeName = textOf(refs.weapon_types?.[dto.weapon_type_id]?.name);
      const secondary = (dto.attributes || []).find((a) => refs.stats?.[a.attribute_id]?.format !== 'Integer');
      const mainStat = secondary ? textOf(refs.stats[secondary.attribute_id].name) : '';

      // 满级数值从详情页取：payload 里的 growth_curves 刻度与显示值不同量纲
      const page = htmlToText(await fetchText(`${BASE}${path}?lang=${LANG}`));
      const atkMax = Number((page.match(/基础攻击力\s*([\d.]+)/) || [])[1] || 0);
      const statRe = mainStat
        ? new RegExp(`(?<!基础)${mainStat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\d.]+%?)`)
        : null;
      const mainStatMax =
        (statRe && (page.match(statRe) || [])[1]) ||
        (page.match(/基础攻击力\s*[\d.]+(?:\([\d.]+\))?\s*([\d.]+%?)/) || [])[1] ||
        '';

      const refinements = (dto.refinements || []).map((r, i) => ({
        level: i + 1,
        description: cleanText(textOf(r.description)),
        values: [],
      }));
      const costs = (dto.promotions || [])
        .filter((p) => (p.upgrade_costs || []).length)
        .map((p, i) => ({
          stage: i + 1,
          items: p.upgrade_costs.map((c) => ({
            name: textOf(refs.items?.[c.item_id]?.name) || String(c.item_id),
            count: c.amount,
          })),
        }));

      const entry = {
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
        version: BETA_VERSION,
        beta: true,
      };
      writeJson(join(DIRS.weapons, `${name}.json`), entry);
      made.push(`武器 ${name}（${entry.rarity}★ ${typeName} ${atkMax}/${mainStatMax}）`);
      console.log(`   + 武器 ${name}（${entry.rarity}★ ${typeName} ${atkMax}/${mainStatMax}）`);
    } catch (err) {
      console.log(`   ✗ 武器 ${id}/${slug}：${err.message}`);
    }
    await sleep(350);
  }
  return made;
}

/* ================= 圣遗物 ================= */
const ARTIFACT_SLOTS = [
  { typeId: 1, slot: 'flower', slotText: '生之花' },
  { typeId: 2, slot: 'plume', slotText: '死之羽' },
  { typeId: 3, slot: 'sands', slotText: '时之沙' },
  { typeId: 4, slot: 'goblet', slotText: '空之杯' },
  { typeId: 5, slot: 'circlet', slotText: '理之冠' },
];

async function syncArtifacts() {
  const local = loadLocal(DIRS.artifacts);
  const payload = await fetchJson('/artifacts/beta');
  const { entries = [], refs = {} } = payload.data || {};

  const made = [];
  for (const e of entries) {
    if (!e?.id || isLocal(local, e.id)) continue;
    const name = textOf(e.name);
    if (!name) continue;

    const effectOf = (pieces) =>
      textOf((e.set_effects || []).find((s) => s.pieces === pieces)?.description);

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

    const entry = {
      name,
      id: Number(e.id),
      rarity: e.rarities || [4, 5],
      effect1Pc: effectOf(1),
      effect2Pc: effectOf(2),
      effect4Pc: effectOf(4),
      pieces,
      icon: '',
      iconUrl: refs.assets?.[e.icon_path_hash]?.url || '',
      version: BETA_VERSION,
      beta: true,
    };
    writeJson(join(DIRS.artifacts, `${name}.json`), entry);
    made.push(`圣遗物 ${name}（${(e.rarities || []).join('/')}★ ${pieces.length} 件）`);
    console.log(`   + 圣遗物 ${name}（${(e.rarities || []).join('/')}★ ${pieces.length} 件）`);
  }
  return made;
}

/* ================= 角色 ================= */
/** 元素id → 附着 md 的分节标题（以 gachabase 的 refs.elements 文案为准） */
const ELEMENT_SECTION = { 火元素: '火系', 水元素: '水系', 草元素: '草系', 雷元素: '雷系', 冰元素: '冰系', 风元素: '风系', 岩元素: '岩系' };
/** 天赋 id 尾数 → 本项目的技能 id（其余尾数是特殊天赋，页面不展示） */
const TALENT_KIND = { 1: 'attack', 2: 'skill', 5: 'burst' };
const TALENT_TYPE = { attack: '普通攻击', skill: '元素战技', burst: '元素爆发' };
/** gachabase 官方用字 → 本项目沿用的写法（项目内别名表口径） */
const NAME_ALIASES = { 茜特菈莉: '茜特拉莉' };
/** 旅行者/空荧/人偶 多形态条目：技能与资料由 genshin-db 单独处理，这里跳过 */
const SKIP_CHARACTER_SLUG = /^(aether|lumine|manekin)/;
const SKIP_CHARACTER_NAME = new Set(['旅行者', '空', '荧']);

/** 把新角色的小节插到对应元素分组的末尾（幂等：已存在同名小节则不动） */
function appendToAttachmentMd(name, weaponType, energy, sectionHead) {
  try {
    const md = readFileSync(MD_FILE, 'utf-8');
    if (md.includes(`## ${name}（`)) return false;
    if (!sectionHead || !md.includes(`# ${sectionHead}`)) return false;

    const start = md.indexOf(`# ${sectionHead}`);
    const next = md.indexOf('\n# ', start + 1);
    const end = next === -1 ? md.length : next;

    const block = [
      '',
      `## ${name}（${weaponType}/${energy || 0}）`,
      '',
      '| 技能 | 元素量 | 附着规则 | 产球 | 备注 | 抗打断 |',
      '| :-: | :-: | :-: | :-: | :-: | :-: |',
      '| E |  |  |  |  |  |',
      '| Q |  |  |  |  |  |',
      '',
    ].join('\n');

    if (DRY) {
      console.log(`   [dry] 会在「${sectionHead}」末尾追加 ${name} 的占位小节`);
      return true;
    }
    writeFileSync(MD_FILE, md.slice(0, end).replace(/\s*$/, '\n') + block + md.slice(end), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function syncCharacters() {
  const local = loadLocal(DIRS.characters);
  const payload = await fetchJson('/characters/beta');
  const { entries = [], refs = {} } = payload.data || {};
  mkdirSync(DIRS.images, { recursive: true });

  const made = [];
  for (const e of entries) {
    if (!e?.id || isLocal(local, e.id)) continue;
    const listName = textOf(e.name);
    if (!listName || !e.slug || /^\d+$/.test(e.slug) || SKIP_CHARACTER_SLUG.test(e.slug)) continue;

    try {
      const { data } = await fetchJson(`/characters/${e.id}/${e.slug}/beta`);
      const dto = data?.dto;
      const refs = data?.refs || payload.data?.refs || {};
      if (!dto?.name) throw new Error('缺少 dto');

      const name = textOf(dto.name);
      if (!SKIP_CHARACTER_NAME.has(name)) {
        const keepLocal = local.names.has(name) || local.names.has(NAME_ALIASES[name]);
        if (keepLocal && !(FORCE && local.betaIds.has(String(e.id)))) continue;
      } else {
        continue;
      }

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
          return {
            id: kind,
            type: TALENT_TYPE[kind],
            name: textOf(t.name),
            description: cleanText(textOf(t.description)),
            lore: '',
            states: [],
            levels,
          };
        });
      if (!skills.length) continue;

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

      const entry = {
        name,
        id: Number(dto.id || e.id),
        title: textOf(dto.profile?.title),
        rarity: dto.rarity,
        version: BETA_VERSION,
        description: cleanText(textOf(dto.description)),
        skills,
        passives,
        constellations,
        beta: true,
      };
      writeJson(join(DIRS.characters, `${name}.json`), entry);

      // 头像（方形立绘）
      const avatarUrl = refs.assets?.[dto.assets?.square_icon_path_hash]?.url || '';
      if (avatarUrl) {
        try {
          await download(avatarUrl, join(DIRS.images, `${name}.png`));
        } catch (err) {
          console.log(`     ⚠️ 头像下载失败：${err.message}`);
        }
      }

      const elementName = textOf(refs.elements?.[dto.elements?.[0]?.element_id]?.name);
      const weaponType = textOf(refs.weapon_types?.[dto.weapon_type_id]?.name);
      const burst = skills.find((s) => s.id === 'burst');
      const energyLevel = burst?.levels?.find((l) => l.label.includes('元素能量'));
      const energy = (energyLevel?.values?.[0] || '').replace(/[^\d]/g, '');
      const mdAdded = appendToAttachmentMd(name, weaponType, energy, ELEMENT_SECTION[elementName]);

      made.push(`角色 ${name}（${dto.rarity}★ ${elementName} ${weaponType}，技能 ${skills.length} 个${mdAdded ? '，已补附着表占位' : ''}）`);
      console.log(`   + 角色 ${name}（${dto.rarity}★ ${elementName} ${weaponType}，技能 ${skills.length} 个${mdAdded ? '，已补附着表占位' : ''}）`);
    } catch (err) {
      console.log(`   ✗ 角色 ${e.id}/${e.slug}：${err.message}`);
    }
    await sleep(350);
  }
  return made;
}

/* ================= 主流程 ================= */
async function main() {
  console.log('从 gachabase 同步最新图鉴数据…');
  const added = [];
  await resolveBetaVersion();
  console.log(`   新条目将标注为版本 ${BETA_VERSION || '（未知，排最后）'}`);
  try {
    added.push(...(await syncWeapons()));
    added.push(...(await syncArtifacts()));
    added.push(...(await syncCharacters()));
  } catch (err) {
    console.log(`⚠️ 同步中断（不影响本地已有数据）：${err.message}`);
  }

  writeJson(META_FILE, {
    _comment: 'gachabase 同步明细（由 scripts/sync-gachabase.mjs 生成，可随时重跑覆盖）。',
    _fetchedAt: new Date().toISOString().slice(0, 10),
    _source: `${BASE}/changelog/beta`,
    _version: BETA_VERSION,
    added,
  });

  console.log(
    added.length
      ? `\n✅ 本次新增 ${added.length} 条；跑 npm run data 重建索引后即可在页面看到`
      : '\n✅ 没有新增内容（本地已是最新）',
  );
}
await main();
