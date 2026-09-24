/**
 * good.js — 导入 GOODScanner / Genshin Optimizer 等工具导出的 **GOOD v3** JSON。
 *
 * 为什么用它：GOODScanner（https://github.com/Anyrainel/GOODScanner，yas 的加强分支）会抓包或 OCR 扫描，
 * 把**账号下的全部角色 / 武器 / 圣遗物**导出成 `GOODv3.json`。这是网页唯一能拿到「全部角色」的途径 ——
 * 米游社战绩接口与 Enka 都只能看到游戏内展示柜（前者还受账号风控）。
 *
 * GOOD v3 结构（Rust 模型 GoodArtifact / GoodCharacter，只列用得到的字段）：
 *   { format: 'GOOD', version: 3, source: 'yas-GOODScanner',
 *     characters: [ { key: 'HuTao', level: 90, constellation: 6, ascension: 6,
 *                     talent: { auto: 10, skill: 10, burst: 10 },
 *                     weapon: { key: 'StaffOfHoma', level: 90, refinement: 1 } } ],
 *     artifacts: [ { setKey: 'CrimsonWitchOfFlames', slotKey: 'flower', level: 20, rarity: 5,
 *                    mainStatKey: 'hp', location: 'HuTao', lock: true,
 *                    substats: [ { key: 'critRate_', value: 3.5, initialValue: 3.5 } ],
 *                    unactivatedSubstats: [] } ],   // 顶层是全量清单，装备中的也会带 location
 *     weapons: [...] }
 *
 * 注意：GOOD **不含主词条数值**（只有 mainStatKey），也不含面板数值 —— 导入后卡片里主词条只显示属性名；
 * 副词条统计不受影响（那是本页的核心）。
 * 英文键 → 中文名靠 src/data/game-ids.json（`npm run game-ids` 生成，键统一小写）。
 */
import gameIds from '../data/game-ids.json';
import { makeArtifact, makeBundle, propIdOf, propLabel, propText, substatOf } from './substats.js';

/** GOOD 的 slotKey → 圣遗物部位编号 */
const SLOT_BY_KEY = { flower: 1, plume: 2, sands: 3, goblet: 4, circlet: 5 };

/** 未装备的圣遗物归到这个「角色」下（GOOD 的 location 为空） */
export const UNEQUIPPED = '未装备';

const lower = (s) => String(s || '').toLowerCase();
const charName = (key) => gameIds.goodChars?.[lower(key)]?.name || `角色 ${key || '?'}`;
const setName = (key) => gameIds.goodSets?.[lower(key)]?.name || (key ? `套装 ${key}` : '');
const weaponName = (key) => gameIds.goodWeapons?.[lower(key)]?.name || (key ? `武器 ${key}` : '');
const weaponEntry = (key) => gameIds.goodWeapons?.[lower(key)] || null;

/**
 * 解析 GOOD JSON → 本站 bundle。
 * @param {object|string} input GOOD 对象或 JSON 文本
 * @returns {{ bundle?: object, error?: string, note?: string }}
 */
export function parseGood(input) {
  let json = input;
  if (typeof input === 'string') {
    try {
      json = JSON.parse(input);
    } catch {
      return { error: '不是合法 JSON —— 请选择 GOODScanner 导出的 GOODv3.json。' };
    }
  }
  if (!json || typeof json !== 'object') return { error: '读不到 JSON 内容。' };
  if (json.format && String(json.format).toUpperCase() !== 'GOOD') {
    return { error: `这不是 GOOD 格式（format = ${json.format}）。星穹铁道的导出（HSR-Scanner）本页用不上。` };
  }

  const goodChars = Array.isArray(json.characters) ? json.characters : [];
  const byName = new Map();
  const characters = [];
  const addCharacter = (name, goodChar = null) => {
    if (byName.has(name)) return byName.get(name);
    const ch = blankCharacter(name, goodChar);
    byName.set(name, ch);
    characters.push(ch);
    return ch;
  };
  for (const c of goodChars) addCharacter(charName(c.key), c);

  /* 全量清单：优先用顶层 artifacts；没有就退回各角色自带的 artifacts */
  const topLevel = Array.isArray(json.artifacts) ? json.artifacts : null;
  const list = topLevel?.length ? topLevel : goodChars.flatMap((c) => (Array.isArray(c.artifacts) ? c.artifacts : []));

  let skipped = 0;
  for (const raw of list) {
    const artifact = artifactFrom(raw);
    if (!artifact) {
      skipped += 1;
      continue;
    }
    addCharacter(raw?.location ? charName(raw.location) : UNEQUIPPED).artifacts.push(artifact);
  }

  /* 页面只展示有圣遗物的角色；「未装备」永远排在最后 */
  const withArtifacts = characters
    .filter((c) => c.artifacts.length)
    .sort((a, b) => (a.name === UNEQUIPPED ? 1 : 0) - (b.name === UNEQUIPPED ? 1 : 0));
  if (!withArtifacts.length) {
    return { error: '这份数据里没有圣遗物 —— 用 GOODScanner 时记得扫描「圣遗物」（默认扫描全部）。' };
  }

  const bundle = makeBundle({
    characters: withArtifacts,
    meta: {
      source: 'good',
      format: json.format || 'GOOD',
      version: json.version ?? '',
      exportedBy: json.source || '',
      scanned: list.length,
      /* GOOD 没有主词条数值，页面据此说明 */
      noMainStatValue: true,
    },
  });

  const notes = [];
  if (!topLevel?.length) notes.push('这份 GOOD 没有顶层 artifacts 清单，只能看到角色已装备的圣遗物（GOODScanner 扫描「圣遗物」可拿到全部）。');
  if (skipped) notes.push(`有 ${skipped} 件圣遗物没有副词条，已跳过。`);
  return { bundle, note: notes.join(' ') };
}

/** 一个空角色壳子（之后往里塞圣遗物） */
function blankCharacter(name, goodChar) {
  const w = goodChar?.weapon?.key ? goodChar.weapon : null;
  const entry = w ? weaponEntry(w.key) : null;
  return {
    name,
    level: goodChar?.level ?? '',
    rarity: '',
    artifacts: [],
    extra: {
      source: 'good',
      level: goodChar?.level ?? '',
      constellation: goodChar?.constellation ?? '',
      weapon: w
        ? {
          name: weaponName(w.key),
          slug: entry?.slug || '',
          level: w.level ?? '',
          refinement: w.refinement ?? '',
          rarity: entry?.rarity ?? '',
          icon: entry?.iconUrl || '',
          attrs: [],
        }
        : null,
      attrs: [],
    },
  };
}

/** GOOD 的一件圣遗物 → 统一结构（主词条通常只有属性名，没有数值） */
function artifactFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mainProp = propIdOf(raw.mainStatKey);
  const mainValue = Number(raw.mainStatValue ?? raw.mainStatValueRaw);
  const main = mainProp === null
    ? null
    : {
      prop: mainProp,
      label: propLabel(mainProp),
      /* GOOD v3 标准里没有这个字段；别的工具若补了就用上 */
      value: Number.isFinite(mainValue) ? mainValue : null,
      raw: Number.isFinite(mainValue) ? propText(mainProp, mainValue) : '',
    };
  const substats = (Array.isArray(raw.substats) ? raw.substats : [])
    .map((s) => (propIdOf(s?.key) === null || !Number.isFinite(Number(s?.value)) ? null : substatOf(s.key, s.value)));
  return makeArtifact({
    slot: SLOT_BY_KEY[raw.slotKey] ?? 0,
    slotKey: SLOT_BY_KEY[raw.slotKey] ? raw.slotKey : '',
    setName: setName(raw.setKey),
    setSlug: gameIds.goodSets?.[lower(raw.setKey)]?.slug || '',
    level: raw.level ?? '',
    rarity: raw.rarity ?? '',
    main,
    substats,
    /* GOOD 独有、以后可能有用 */
    lock: raw.lock ?? null,
    totalRolls: raw.totalRolls ?? null,
  });
}
