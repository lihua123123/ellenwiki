/**
 * char-stats.mjs — 角色基础属性曲线（生命值 / 攻击力 / 防御力 / 突破属性）的生成工具。
 *
 * 输出结构与武器的 curve 一致，供页面「等级滑块 + 突破勾选」使用：
 *   { label, percent, maxLevel, maxAscension,
 *     hp[lv-1], attack[lv-1], defense[lv-1], specialized[lv-1],   // 该等级「已尽可能突破」时的值
 *     preHp{cap}, preAttack{cap}, preDefense{cap}, preSpecialized{cap} }  // 停在突破节点、尚未突破
 *
 * 突破节点 20 / 40 / 50 / 60 / 70 / 80，突破阶段 0~6（阶段 6 对应 81~90 级）。
 * specialized 存「突破属性带来的增量」（不含基础值，如暴击伤害只算 +38.4%），percent 标明是否为百分比。
 */
export const ASC_CAPS = [20, 40, 50, 60, 70, 80];
export const MAX_LEVEL = 90;
export const MAX_ASCENSION = 6;

const round = (v, digits = 0) => {
  const f = 10 ** digits;
  return Math.round((Number(v) || 0) * f) / f;
};

/** lunaris 的突破属性键 → [中文名, 是否百分比] */
const LUNARIS_LABEL = {
  'HP%': ['生命值', true],
  'ATK%': ['攻击力', true],
  'DEF%': ['防御力', true],
  'CRIT Rate%': ['暴击率', true],
  'CRIT DMG%': ['暴击伤害', true],
  'EM': ['元素精通', false],
  'ER': ['元素充能效率', true],
  'Healing%': ['治疗加成', true],
  'Physical%': ['物理伤害加成', true],
  'Anemo%': ['风元素伤害加成', true],
  'Geo%': ['岩元素伤害加成', true],
  'Electro%': ['雷元素伤害加成', true],
  'Dendro%': ['草元素伤害加成', true],
  'Hydro%': ['水元素伤害加成', true],
  'Pyro%': ['火元素伤害加成', true],
  'Cryo%': ['冰元素伤害加成', true],
};

/** 摊平成页面直接可用的结构 */
const assemble = ({ label, percent, series, pre }) => ({
  label,
  percent,
  maxLevel: MAX_LEVEL,
  maxAscension: MAX_ASCENSION,
  hp: series.hp,
  attack: series.attack,
  defense: series.defense,
  specialized: series.specialized,
  preHp: pre.hp,
  preAttack: pre.attack,
  preDefense: pre.defense,
  preSpecialized: pre.specialized,
});

/** 某个等级能突破到第几阶段（等级 20 取 1，即「已突破的 20 级」） */
const phaseAt = (lv) => Math.min(ASC_CAPS.filter((c) => c <= lv).length, MAX_ASCENSION);

/** genshin-db：info.stats(level, ascension) 任意组合都能直接取到，无需外推 */
export function statsFromGenshin(info) {
  const fn = info?.stats;
  if (typeof fn !== 'function') return null;
  const at = (lv, asc) => {
    try {
      const s = fn(lv, asc);
      return s && typeof s.hp === 'number' ? s : null;
    } catch { return null; }
  };
  if (!at(1, 0)) return null;
  /* 突破属性只取增量：genshin-db 的 specialized 含基础值（暴击伤害 50%、元素充能 100% 等），
   * 而 1 级 0 突破是唯一一定合法的「无突破」采样点（更高级别传 0 会被钳到该级上限） */
  const specBase = at(1, 0).specialized ?? 0;
  const specOf = (s) => (s.specialized ?? 0) - specBase;

  const series = { hp: [], attack: [], defense: [], specialized: [] };
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    const s = at(lv, phaseAt(lv));
    series.hp.push(round(s.hp));
    series.attack.push(round(s.attack));
    series.defense.push(round(s.defense));
    series.specialized.push(round(specOf(s), 4));
  }

  const pre = { hp: {}, attack: {}, defense: {}, specialized: {} };
  ASC_CAPS.forEach((cap, i) => {
    const s = at(cap, i);
    if (!s) return;
    pre.hp[cap] = round(s.hp);
    pre.attack[cap] = round(s.attack);
    pre.defense[cap] = round(s.defense);
    pre.specialized[cap] = round(specOf(s), 4);
  });

  return assemble({
    label: info.substatText || '突破属性',
    percent: info.substatType !== 'FIGHT_PROP_ELEMENT_MASTERY',
    series,
    pre,
  });
}

/** lunaris：info.attributes 每级一行，突破节点处给的是「未突破」值（与武器 stats 同口径） */
export function statsFromLunaris(attributes) {
  const rows = new Map((attributes || []).map((r) => [r.level, r]));
  const first = rows.get(1);
  if (!first) return null;
  const key = Object.keys(rows.get(90) || first).find(
    (k) => !['level', 'ascension', 'hp', 'atk', 'def'].includes(k),
  );
  const [label, percent] = LUNARIS_LABEL[key] || ['突破属性', true];
  const num = (r, k) => {
    const v = r?.[k];
    return v === undefined || v === null || v === '' ? 0 : Number(v);
  };
  const spec = (lv) => (percent ? round(num(rows.get(lv), key) / 100, 4) : round(num(rows.get(lv), key)));

  const series = { hp: [], attack: [], defense: [], specialized: [] };
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    const r = rows.get(lv);
    const atCap = ASC_CAPS.includes(lv);
    /* 突破节点上是未突破值：已突破值用之后两级线性外推（同武器的做法） */
    const guess = (k) => {
      if (!atCap) return round(num(rows.get(lv), k));
      const n1 = num(rows.get(lv + 1), k);
      const n2 = num(rows.get(lv + 2), k);
      return round(n1 && n2 ? n1 - (n2 - n1) : num(r, k));
    };
    series.hp.push(guess('hp'));
    series.attack.push(guess('atk'));
    series.defense.push(guess('def'));
    /* 突破属性是阶梯值：节点「已突破」的增量 = 下一级的增量 */
    series.specialized.push(atCap ? spec(lv + 1) : spec(lv));
  }

  const pre = { hp: {}, attack: {}, defense: {}, specialized: {} };
  for (const cap of ASC_CAPS) {
    const r = rows.get(cap);
    if (!r) continue;
    pre.hp[cap] = round(num(r, 'hp'));
    pre.attack[cap] = round(num(r, 'atk'));
    pre.defense[cap] = round(num(r, 'def'));
    pre.specialized[cap] = spec(cap);
  }

  return assemble({ label, percent, series, pre });
}
