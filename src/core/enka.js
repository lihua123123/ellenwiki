/**
 * enka.js — 走 Enka.Network 的「我的角色」取数（**不需要登录**）。
 *
 * 为什么用 Enka（2026-09 实测）：
 *   · Enka 是社区维护的公开接口，只认 UID：`GET https://enka.network/api/uid/<uid>`
 *   · 数据来自游戏内「角色展示柜 + 显示角色详情」，**含武器与圣遗物的主副词条数值**，
 *     够我们算「圣遗物词条数」，而且完全不用 Cookie / 不需要登录米游社
 *   · 国服同样有效（天空岛 / 世界树账号都能取到）
 *   · 唯一限制：只能看到展示柜里公开详情的角色（一般 8 个，实际常能取到 12 个）
 *
 * 为什么还要 Worker：Enka 不给浏览器发 CORS 头（实测响应里没有 access-control-allow-origin），
 *   静态站点必须借服务端转发 → worker/index.js 的 `/api/enka`（只透传一个路径，无状态）。
 *
 * Enka 的数据里只有 id（角色 avatarId、武器 icon、圣遗物 setId），中文名靠 src/data/game-ids.json
 * （由 `npm run game-ids` 生成）与 src/data/weapons-index.json 还原。
 */
import weaponsIndex from '../data/weapons-index.json';
import gameIds from '../data/game-ids.json';
import { makeArtifact, makeBundle, propIdOf, propLabel, propText, substatOf } from './substats.js';

/* ============ 1. id → 站内条目 ============ */

/** 武器：Enka 的 flat.icon（不带 .png）→ 图鉴条目（含图标地址） */
const WEAPON_BY_ICON = new Map(
  weaponsIndex.map((w) => [String(w.icon || '').replace(/\.png$/i, '').toLowerCase(), w]),
);

/** 角色：avatarId → 图鉴条目 */
const AVATAR_BY_ID = gameIds.avatars || {};

/** 圣遗物套装：setId → 图鉴条目 */
const SET_BY_ID = gameIds.sets || {};

/** 服务器编号 → 中文名（Enka 的 region） */
const REGIONS = {
  cn_gf01: '天空岛', cn_qd01: '世界树',
  os_usa: '美服', os_euro: '欧服', os_asia: '亚服', os_cht: '港澳台服',
};

/* ============ 2. 装备槽位与面板属性 ============ */

/** Enka 的装备槽位名 → 圣遗物部位（编号 + GOOD/索引用的 slotKey） */
const SLOT_BY_EQUIP = {
  EQUIP_BRACER: { slot: 1, key: 'flower' },
  EQUIP_NECKLACE: { slot: 2, key: 'plume' },
  EQUIP_SHOES: { slot: 3, key: 'sands' },
  EQUIP_RING: { slot: 4, key: 'goblet' },
  EQUIP_DRESS: { slot: 5, key: 'circlet' },
};

/** 面板要展示的属性（fightPropMap 的数值键） */
const PANEL_PROPS = [
  [2000, '生命值', false], [2001, '攻击力', false], [2002, '防御力', false],
  [20, '暴击率', true], [22, '暴击伤害', true], [23, '元素充能效率', true], [28, '元素精通', false],
  [26, '治疗加成', true], [30, '物理伤害加成', true],
  [40, '火元素伤害加成', true], [41, '雷元素伤害加成', true], [42, '水元素伤害加成', true],
  [43, '草元素伤害加成', true], [44, '风元素伤害加成', true], [45, '岩元素伤害加成', true],
  [46, '冰元素伤害加成', true],
];

const round1 = (n) => Math.round(n * 10) / 10;

/* ============ 3. 取数 ============ */

/**
 * 取一个 UID 的账号数据（经本站 Worker 转发）。
 * @param {string} uid 9~10 位数字
 * @returns {Promise<object>} Enka 的原始 JSON
 */
export async function fetchEnka(uid) {
  const id = String(uid || '').trim();
  if (!/^\d{9,10}$/.test(id)) throw new Error('UID 应该是 9~10 位数字');

  let res;
  try {
    res = await fetch('/api/enka', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: id }),
    });
  } catch {
    throw new Error('连不上本站的转发接口（本地开发要同时跑 npm run api）');
  }

  const payload = await res.json().catch(() => null);
  if (!payload) throw new Error('转发接口没有返回 JSON');
  if (payload.error) throw new Error(payload.error);
  if (!payload.data) throw new Error(`取数失败（Enka 返回 ${payload.status}）`);
  return payload.data;
}

/* ============ 4. 归一化 ============ */

/** Enka 的原始 JSON → 本站统一的 bundle */
export function normalizeEnka(json = {}) {
  const info = json.playerInfo || {};
  const uid = String(json.uid || '');
  const characters = (json.avatarInfoList || []).map(characterFrom).filter(Boolean);

  return makeBundle({
    uid,
    roles: [{
      uid,
      nickname: info.nickname || '',
      server: REGIONS[json.region] || String(json.region || ''),
      level: info.level ?? '',
    }],
    characters,
    meta: {
      source: 'enka',
      region: json.region || '',
      nickname: info.nickname || '',
      ttl: json.ttl ?? null,
      /* 展示柜里没开详情的角色数量（有 showAvatarInfoList 但没 avatarInfoList 时能看出来） */
      showcased: (info.showAvatarInfoList || []).length,
    },
  });
}

/** 一个角色 → { name, level, rarity, artifacts, extra } */
function characterFrom(av) {
  const avatarId = String(av.avatarId ?? '');
  const meta = AVATAR_BY_ID[avatarId] || null;
  const name = meta?.name || `角色 #${avatarId}`;

  const props = av.fightPropMap || {};
  /* 注意：fightPropMap 里百分比类属性是小数（0.4792 = 47.92%），固定值才是原值 */
  const attrs = PANEL_PROPS
    .filter(([id]) => props[id] != null && Number(props[id]) !== 0)
    .map(([id, label, pct]) => ({
      label,
      value: pct ? `${round1(Number(props[id]) * 100)}%` : String(Math.round(Number(props[id]))),
    }));

  const equips = Array.isArray(av.equipList) ? av.equipList : [];
  const weapon = weaponFrom(equips.find((e) => e.flat?.itemType === 'ITEM_WEAPON'));
  const artifacts = equips
    .filter((e) => e.flat?.itemType === 'ITEM_RELIQUARY')
    .map(artifactFrom)
    .filter(Boolean);

  return {
    name,
    level: Number(av.propMap?.['4001']?.val) || av.propMap?.['4001']?.ival || '',
    rarity: '',
    artifacts,
    extra: {
      image: '',                                  // 页面会优先用站内头像（content/characters/images）
      avatarId,
      slug: meta?.slug || '',
      attrs,                                      // 面板属性（Enka 版：直接给算好的数值）
      constellation: (av.talentIdList || []).length,
      level: Number(av.propMap?.['4001']?.val) || '',
      friendship: av.fetterInfo?.expLevel ?? '',
      weapon,
      source: 'enka',
    },
  };
}

/** 武器 → 页面用的结构 */
function weaponFrom(equip) {
  if (!equip?.flat) return null;
  const f = equip.flat;
  const iconKey = String(f.icon || '').replace(/\.png$/i, '');
  const local = WEAPON_BY_ICON.get(iconKey.toLowerCase());
  const stats = Array.isArray(f.weaponStats) ? f.weaponStats : [];
  const baseAtk = stats.find((s) => s.appendPropId === 'FIGHT_PROP_BASE_ATTACK')?.statValue ?? '';
  const sub = stats.find((s) => s.appendPropId !== 'FIGHT_PROP_BASE_ATTACK');
  const subProp = sub ? propIdOf(sub.appendPropId) : null;
  const affix = equip.weapon?.affixMap ? Object.values(equip.weapon.affixMap)[0] : null;

  return {
    name: local?.name || (iconKey ? `武器 ${iconKey}` : '未知武器'),
    slug: local?.slug || '',
    icon: local?.iconUrl || (iconKey ? `https://enka.network/ui/${iconKey}.png` : ''),
    rarity: f.rankLevel ?? '',
    level: equip.weapon?.level ?? '',
    affix_level: affix == null ? '' : Number(affix) + 1,
    attrs: [
      { label: '基础攻击力', value: String(baseAtk) },
      subProp ? { label: propLabel(subProp), value: propText(subProp, sub.statValue) } : null,
    ].filter(Boolean),
  };
}

/** 一件圣遗物 → makeArtifact 结构 */
function artifactFrom(equip) {
  const f = equip.flat || {};
  const setId = String(f.setId || '');
  const set = SET_BY_ID[setId];
  const slot = SLOT_BY_EQUIP[f.equipType] || { slot: 0, key: '' };
  const main = f.reliquaryMainstat;
  const mainProp = main ? propIdOf(main.mainPropId) : null;

  return makeArtifact({
    slot: slot.slot,
    slotKey: slot.key,
    setName: set?.name || (setId ? `套装 #${setId}` : ''),
    setId: setId || '',
    setSlug: set?.slug || '',
    /* Enka 的 reliquary.level 是「1 起算」（实测满级 5★ = 21，而游戏显示 +20）→ 减 1 */
    level: equip.reliquary?.level ? Math.max(0, Number(equip.reliquary.level) - 1) : '',
    rarity: f.rankLevel ?? '',
    main: main && mainProp != null
      ? { prop: mainProp, label: propLabel(mainProp), value: main.statValue, raw: propText(mainProp, main.statValue) }
      : null,
    substats: (Array.isArray(f.reliquarySubstats) ? f.reliquarySubstats : []).map((s) => {
      const prop = propIdOf(s.appendPropId);
      return prop == null ? null : substatOf(prop, s.statValue, propText(prop, s.statValue));
    }),
  });
}

/** 供页面拼提示语：展示柜里有多少角色没开详情 */
export const enkaNote = (bundle) => {
  const meta = bundle?.meta;
  if (meta?.source !== 'enka') return '';
  const missing = (meta.showcased || 0) - (bundle.characters?.length || 0);
  return missing > 0
    ? `Enka 一共看到展示柜里有 ${meta.showcased} 个角色，其中 ${missing} 个没开「显示角色详情」，取不到圣遗物。`
    : '';
};
