/**
 * substats.js — 圣遗物副词条统计与「角色数据」的统一结构（纯本地计算，不外传）。
 *
 * 数据来源有两条，都归一化成同一个 bundle 结构（见 makeBundle）：
 *   · Enka.Network 的公开接口（只要 UID，见 enka.js）
 *   · GOODScanner / Genshin Optimizer 导出的 GOOD v3 JSON（见 good.js）
 *
 * 统计口径（用户指定）：词条数 = 副词条数值 ÷ 该属性的「平均词条值」（一位小数），
 * 平均词条值取自角色图鉴「工具」页「圣遗物词条分布」表格。
 */

/* ============ 1. 副词条基准（平均词条值 = 表格平均值，一位小数） ============ */

/**
 * prop = 游戏 FightPropType（米游社/Enka/GOOD 最后都归到这套 id），avg = 一格强化（1 词条）的平均值。
 * 顺序 = 表格顺序；渲染时按统计结果降序排。
 */
export const SUBSTAT_BASE = [
  { prop: 20, label: '暴击率', avg: 3.3, percent: true },
  { prop: 22, label: '暴击伤害', avg: 6.6, percent: true },
  { prop: 2, label: '固定生命值', avg: 254.0, percent: false },
  { prop: 5, label: '固定攻击力', avg: 16.5, percent: false },
  { prop: 8, label: '固定防御力', avg: 19.7, percent: false },
  { prop: 3, label: '百分比生命值', avg: 5.0, percent: true },
  { prop: 6, label: '百分比攻击力', avg: 5.0, percent: true },
  { prop: 9, label: '百分比防御力', avg: 6.2, percent: true },
  { prop: 28, label: '元素精通', avg: 19.8, percent: false },
  { prop: 23, label: '元素充能效率', avg: 5.5, percent: true },
];

const BASE_BY_PROP = new Map(SUBSTAT_BASE.map((b) => [b.prop, b]));

/** 面板上会出现的其它属性 id（非副词条） */
const EXTRA_PROP_LABELS = {
  26: '治疗加成', 30: '物理伤害加成',
  40: '火元素伤害加成', 41: '雷元素伤害加成', 42: '水元素伤害加成', 43: '草元素伤害加成',
  44: '风元素伤害加成', 45: '岩元素伤害加成', 46: '冰元素伤害加成',
};

/** 属性 id → 中文名（面板 / 圣遗物主副词条都用它） */
export const propLabel = (id) => BASE_BY_PROP.get(Number(id))?.label || EXTRA_PROP_LABELS[Number(id)] || `属性#${id}`;

/** 百分比类属性（拼显示文本时加 %） */
export const PERCENT_PROPS = new Set([3, 6, 9, 20, 22, 23, 26, 30, 40, 41, 42, 43, 44, 45, 46]);

/** 数值 → 显示文本（百分比属性自动补 %） */
export const propText = (prop, v) => (PERCENT_PROPS.has(Number(prop)) ? `${v}%` : String(v));

/** 面板里 base_property 用的键名（Enka 走的是数值键，这里主要给字段命名用） */
export const BASE_PROP_LABELS = {
  FIGHT_PROP_HP: '生命值', FIGHT_PROP_ATTACK: '攻击力', FIGHT_PROP_DEFENSE: '防御力',
  FIGHT_PROP_CRITICAL: '暴击率', FIGHT_PROP_CRITICAL_HURT: '暴击伤害',
  FIGHT_PROP_CHARGE_EFFICIENCY: '元素充能效率', FIGHT_PROP_ELEMENT_MASTERY: '元素精通',
  FIGHT_PROP_HEAL_ADD: '治疗加成', FIGHT_PROP_SHIELD_COST_MINUS: '护盾强效',
};

/**
 * 外部数据源里的「字符串属性键」→ FightPropType 数字 id。
 * Enka 给 `FIGHT_PROP_CRITICAL`，GOOD 给 `critRate_`，两者都在这张表里。
 */
export const STRING_PROP_ID = {
  /* Enka / 米游社 */
  FIGHT_PROP_HP: 2,
  FIGHT_PROP_ATTACK: 5,
  FIGHT_PROP_DEFENSE: 8,
  FIGHT_PROP_HP_PERCENT: 3,
  FIGHT_PROP_ATTACK_PERCENT: 6,
  FIGHT_PROP_DEFENSE_PERCENT: 9,
  FIGHT_PROP_ELEMENT_MASTERY: 28,
  FIGHT_PROP_CHARGE_EFFICIENCY: 23,
  FIGHT_PROP_CRITICAL: 20,
  FIGHT_PROP_CRITICAL_HURT: 22,
  FIGHT_PROP_HEAL_ADD: 26,
  FIGHT_PROP_PHYSICAL_ADD_HURT: 30,
  FIGHT_PROP_FIRE_ADD_HURT: 40,
  FIGHT_PROP_ELEC_ADD_HURT: 41,
  FIGHT_PROP_WATER_ADD_HURT: 42,
  FIGHT_PROP_GRASS_ADD_HURT: 43,
  FIGHT_PROP_WIND_ADD_HURT: 44,
  FIGHT_PROP_ROCK_ADD_HURT: 45,
  FIGHT_PROP_ICE_ADD_HURT: 46,
  FIGHT_PROP_BASE_ATTACK: 4,
  /* GOOD（Genshin Open Object Description） */
  hp: 2,
  atk: 5,
  def: 8,
  hp_: 3,
  atk_: 6,
  def_: 9,
  eleMas: 28,
  enerRech_: 23,
  critRate_: 20,
  critDMG_: 22,
  heal_: 26,
  phys_: 30,
  pyro_: 40,
  electro_: 41,
  hydro_: 42,
  dendro_: 43,
  anemo_: 44,
  geo_: 45,
  cryo_: 46,
};

/** 字符串键（或数字字符串）→ 属性 id；认不出返回 null */
export function propIdOf(key) {
  const n = Number(key);
  if (Number.isFinite(n) && n > 0) return n;
  return STRING_PROP_ID[String(key)] ?? null;
}

/** 圣遗物部位（Enka 的 pos / GOOD 的 slotKey 都归到这里） */
const SLOT_NAMES = { 1: '生之花', 2: '死之羽', 3: '时之沙', 4: '空之杯', 5: '理之冠' };

/** 部位编号 → 中文名 */
export const slotName = (n) => SLOT_NAMES[Number(n)] || `部位 ${n ?? '?'}`;

const round1 = (n) => Math.round(n * 10) / 10;

/* ============ 2. 归一化：一条副词条 / 一件圣遗物 ============ */

/**
 * 一条副词条 → 统一结构。词条数 = 数值 ÷ 该属性的平均词条值。
 * @param {number|string} prop 属性 id（或能被 propIdOf 认出的字符串键）
 * @param {number} value 数值（百分比已换算成 3.5 这种「百分数」）
 * @param {string} [raw] 显示文本；不给则按百分比属性自动拼 %
 */
export function substatOf(prop, value, raw) {
  const id = propIdOf(prop);
  if (id === null) return null;
  const base = BASE_BY_PROP.get(id);
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return {
    prop: id,
    label: base?.label || `未知属性 #${id}`,
    avg: base?.avg ?? null,
    percent: base?.percent ?? PERCENT_PROPS.has(id),
    value: v,
    raw: raw ?? propText(id, v),
    rolls: base ? round1(v / base.avg) : null,
  };
}

/** 主词条 → { prop, label, value, raw } */
export function mainStatOf(propKey, value) {
  const id = propIdOf(propKey);
  if (id === null) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return { prop: id, label: propLabel(id), value: v, raw: propText(id, v) };
}

/**
 * 一件圣遗物 → 统一结构。substats 里允许有 null（会被丢掉）。
 * @param {object} a { slot, setName, level, rarity, main, substats, ...rest }
 */
export function makeArtifact({ slot, setName, level = '', rarity = '', main = null, substats = [], ...rest }) {
  const list = (Array.isArray(substats) ? substats : []).filter(Boolean);
  if (!list.length) return null;
  return {
    slot: typeof slot === 'number' ? slotName(slot) : String(slot || ''),
    setName: setName || '',
    level,
    rarity,
    main,
    substats: list,
    ...rest,
  };
}

/* ============ 3. bundle 结构（两条数据源共用） ============ */

export const BUNDLE_KIND = 'ellen-wiki/character-bundle';
export const BUNDLE_KEY = 'ellen-wiki.bundle';

/**
 * 构造一份 bundle。
 * characters: [{ name, level, rarity, artifacts, extra }]
 */
export function makeBundle({ uid = '', roles = [], characters = [], errors = [], meta = null } = {}) {
  return {
    kind: BUNDLE_KIND,
    version: 2,
    fetchedAt: new Date().toISOString(),
    uid: String(uid || ''),
    roles,
    characters: normalizeCharacters(characters),
    errors,
    meta,
  };
}

/** 归一化角色数组（幂等：已是归一化结果就原样返回），并丢掉没有圣遗物的角色 */
export function normalizeCharacters(list) {
  return (Array.isArray(list) ? list : []).map(normalizeCharacter).filter((c) => c && c.artifacts.length);
}

function normalizeCharacter(ch) {
  if (!ch || typeof ch !== 'object') return null;
  if (Array.isArray(ch.artifacts)) {
    return { name: ch.name || '', level: ch.level ?? '', rarity: ch.rarity ?? '', artifacts: ch.artifacts, extra: ch.extra || null };
  }
  return null;
}

/* ============ 4. 统计 ============ */

/**
 * 汇总传入角色的圣遗物副词条：按属性类型累加词条数，降序返回。
 * 例：暴击伤害 12.1 条、暴击率 10.4 条 …
 */
export function aggregateSubstats(characters) {
  const totals = new Map();
  for (const ch of characters) {
    for (const art of ch.artifacts) {
      for (const s of art.substats) {
        const t = totals.get(s.prop) || { prop: s.prop, label: s.label, avg: s.avg, count: 0, rolls: 0 };
        t.count += 1;
        if (s.rolls !== null) t.rolls += s.rolls;
        totals.set(s.prop, t);
      }
    }
  }
  return [...totals.values()]
    .map((t) => ({ ...t, rolls: round1(t.rolls) }))
    .sort((a, b) => b.rolls - a.rolls || b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

/** 概览：角色数 / 圣遗物件数 / 副词条处数 / 词条总数 */
export function summarize(characters) {
  let artifacts = 0;
  let entries = 0;
  let rolls = 0;
  for (const ch of characters) {
    artifacts += ch.artifacts.length;
    for (const art of ch.artifacts) {
      entries += art.substats.length;
      for (const s of art.substats) if (s.rolls !== null) rolls += s.rolls;
    }
  }
  return { characters: characters.length, artifacts, entries, rolls: round1(rolls) };
}

/* ============ 5. 本地存储（sessionStorage：关闭标签页即清除） ============ */

export function saveBundle(obj) {
  try {
    sessionStorage.setItem(BUNDLE_KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

export function loadBundle() {
  try {
    const raw = sessionStorage.getItem(BUNDLE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearBundle() {
  try {
    sessionStorage.removeItem(BUNDLE_KEY);
  } catch { /* 隐私模式下可能不可用 */ }
}

/** 把新数据合并进已有的（多次导入可累积；同一角色以新数据为准） */
export function mergeBundle(oldBundle, newBundle) {
  const byName = new Map();
  for (const ch of oldBundle?.characters || []) byName.set(ch.name, ch);
  for (const ch of newBundle.characters || []) byName.set(ch.name, ch);
  return {
    ...makeBundle({
      uid: newBundle.uid || oldBundle?.uid || '',
      roles: newBundle.roles?.length ? newBundle.roles : oldBundle?.roles || [],
      characters: [...byName.values()],
      errors: newBundle.errors?.length ? newBundle.errors : oldBundle?.errors || [],
    }),
    fetchedAt: newBundle.fetchedAt || oldBundle?.fetchedAt || '',
  };
}
