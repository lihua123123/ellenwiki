/**
 * lunaris.mjs — lunaris.moe（api.lunaris.moe）接口客户端 + 字段映射。
 *
 * 接口（实测可用，全部支持 CHS 中文）：
 *   /data/version.json                       → { version: "7.1.0", versions: [...] }
 *   /data/<版本>/charlist.json               → 角色清单（chsName / element / weaponType / ascensionStats）
 *   /data/<版本>/weaponlist.json             → 武器清单（chsName / qualityType / weaponType / weaponIcon / ascensionStats）
 *   /data/<版本>/artifactlist.json           → 圣遗物套装清单（chsName / qualityType / setIcon / setId）
 *   /data/<版本>/materiallist.json           → 材料清单（chsName / icon，用于把突破材料的图标换成中文名）
 *   /data/<版本>/<en|chs|jp|kr>/char/<id>.json      → 单角色
 *   /data/<版本>/<en|chs|jp|kr>/weapon/<id>.json    → 单武器
 *   /data/<版本>/<en|chs|jp|kr>/artifact/<id>.json  → 单圣遗物
 *
 * 本项目的武器 / 圣遗物 JSON 由 genshin-db 生成；lunaris 只用于**补齐本地缺口**，
 * 因此这里把 lunaris 的字段翻译成本项目 schema（图标沿用 enka CDN 命名规则，
 * 与 generate-weapons.mjs / generate-artifacts.mjs 的输出保持一致）。
 */

export const API = 'https://api.lunaris.moe/data';
const UA = {
  'User-Agent': 'ellen-wiki-data-sync/1.0 (+https://github.com/lihua123123/ellenwiki)',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

export const fetchJson = async (url) => {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
};

/** 去掉游戏内富文本标记（<color> / {LINK} / <i> 等），还原真换行 */
export const cleanText = (s) =>
  String(s ?? '')
    .replace(/<color=#[0-9A-Fa-f]+>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/\{LINK#[^}]*\}/g, '')
    .replace(/\{\/LINK\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+([，。；、：！？）】」』】])/g, '$1')   // 标签去掉后残留的空格
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

/* ---------- 字段映射 ---------- */
export const RARITY = { QUALITY_ORANGE: 5, QUALITY_PURPLE: 4, QUALITY_BLUE: 3, QUALITY_GREEN: 2, QUALITY_GRAY: 1, QUALITY_WHITE: 1 };

/** lunaris 的武器类型 → 本项目 type / typeId */
export const WEAPON_TYPE = {
  WEAPON_SWORD_ONE_HAND: ['单手剑', 'WEAPON_SWORD_ONE_HAND'],
  WEAPON_CLAYMORE: ['双手剑', 'WEAPON_CLAYMORE'],
  WEAPON_POLE: ['长柄武器', 'WEAPON_POLE'],
  WEAPON_BOW: ['弓', 'WEAPON_BOW'],
  WEAPON_CATALYST: ['法器', 'WEAPON_CATALYST'],
};

/** lunaris 的副属性键 → 本项目 mainStat 文案 */
export const SUBSTAT = {
  'ATK%': '攻击力',
  'HP%': '生命值',
  'DEF%': '防御力',
  'Elemental Mastery': '元素精通',
  'Energy Recharge%': '元素充能效率',
  'CRIT Rate%': '暴击率',
  'CRIT DMG%': '暴击伤害',
  'Physical DMG Bonus%': '物理伤害加成',
};

/** 圣遗物部位（lunaris 用英文键，本项目用 slot + slotText） */
export const ARTIFACT_SLOTS = [
  ['flower', '生之花'],
  ['plume', '死之羽'],
  ['sands', '时之沙'],
  ['goblet', '空之杯'],
  ['circlet', '理之冠'],
];

/** 升到 90 级途中的突破节点 */
const CAPS = [20, 40, 50, 60, 70, 80];

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 由 lunaris 武器详情构造本项目武器条目。
 *
 * 数值口径（实测）：`stats[lv]` 是**该等级界面显示值**，但突破节点（20/40/50/60/70/80）
 * 给的是「尚未突破」的值 —— 与 genshin-db 的 preAttack/preSpecialized 一致。
 * 因此：
 *   curve.preAttack[cap]     ← stats[cap].atk（未突破，直接取）
 *   curve.attack[lv-1]       ← stats[lv].atk（其余等级直接取）
 *   curve.attack[cap-1]      ← 用同阶段逐级增量线性外推（lunaris 不提供该值，属估算）
 */
export function buildWeapon(list, dto, { version = '', beta = true } = {}) {
  const rarity = RARITY[list.qualityType] ?? 3;
  const [type, typeId] = WEAPON_TYPE[list.weaponType] || ['', ''];
  const stats = dto.stats || {};
  const subKey = Object.keys(list.ascensionStats || {}).find((k) => k !== 'atk') || '';
  const mainStat = SUBSTAT[subKey] || subKey || '';
  const percent = subKey.includes('%');
  const atk = (lv) => stats[String(lv)]?.atk ?? null;
  const subRaw = (lv) => (subKey ? stats[String(lv)]?.[subKey] ?? null : null);
  /** 副属性按项目口径存分数（页面对百分数会 ×100） */
  const subVal = (lv) => {
    const v = subRaw(lv);
    if (v === null) return null;
    return percent ? round(v / 100, 5) : v;
  };

  const attack = [];
  const specialized = [];
  const preAttack = {};
  const preSpecialized = {};
  const maxLevel = 90;
  for (let lv = 1; lv <= maxLevel; lv++) {
    let a = atk(lv);
    if (CAPS.includes(lv) && a !== null) {
      // 突破节点：stats 是未突破值，已突破值按同阶段逐级增量外推
      const next = atk(lv + 1);
      const next2 = atk(lv + 2);
      preAttack[lv] = a;
      preSpecialized[lv] = subVal(lv);
      if (next !== null && next2 !== null) a = round(next - (next2 - next), 1);
    }
    attack.push(a);
    specialized.push(subVal(lv));
  }

  const refs = dto.passive?.refinements || {};
  const refinements = Object.entries(refs)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([lv, r]) => ({ level: Number(lv), description: cleanText(r.description), values: [] }));

  const iconName = `${list.weaponIcon || dto.weaponIcon || ''}.png`;
  /** 副属性展示值：百分数统一 1 位小数（与 genshin-db 文案一致），其余取整 */
  const fmtSub = (v) => (v === null || v === undefined ? '' : percent ? `${round(v, 1).toFixed(1)}%` : String(Math.round(v)));
  return {
    name: list.chsName,
    id: Number(list.id ?? 0) || undefined,
    rarity,
    type,
    typeId,
    baseAtk: atk(1),
    mainStat,
    mainStatValue: fmtSub(subRaw(1)),
    mainStatPercent: percent,
    mainStatMax: fmtSub(subRaw(maxLevel)),
    atkMax: atk(maxLevel),
    maxLevel,
    source: '',
    effectName: cleanText(dto.passive?.name),
    description: cleanText(dto.weaponDesc),
    story: '',
    refinements,
    // lunaris 的 ascension 只给「全突破总消耗」（各阶段合并、且没有名称只有图标），
    // 拆不回 6 个突破阶段，故留空：页面对空 costs 不渲染突破材料表
    costs: [],
    icon: iconName,
    iconUrl: iconName ? `https://enka.network/ui/${iconName}` : '',
    curve: { maxLevel, maxAscension: CAPS.length, attack, specialized, preAttack, preSpecialized },
    version,
    beta,
  };
}

/** 由 lunaris 圣遗物详情构造本项目圣遗物条目（lunaris 无部位故事，留空由页面兜底） */
export function buildArtifact(list, dto, { version = '', beta = true } = {}) {
  const info = dto.info || {};
  const rarity = RARITY[list.qualityType] ?? 4;
  const pieces = ARTIFACT_SLOTS
    .map(([slot, slotText]) => {
      const p = info.pieces?.[slot];
      if (!p) return null;
      const iconName = `${p.icon}.png`;
      return {
        slot,
        slotText,
        name: cleanText(p.name),
        description: '',
        story: '',
        icon: iconName,
        iconUrl: `https://enka.network/ui/${iconName}`,
      };
    })
    .filter(Boolean);
  const iconName = `${info.setIcon || list.setIcon || ''}.png`;
  return {
    name: list.chsName,
    id: Number(list.setId ?? list.id ?? 0) || undefined,
    rarity: rarity >= 5 ? [4, 5] : [3, 4],
    effect1Pc: '',
    effect2Pc: cleanText(info.setBonuses?.['2pc']?.description),
    effect4Pc: cleanText(info.setBonuses?.['4pc']?.description),
    pieces,
    icon: iconName,
    iconUrl: iconName ? `https://enka.network/ui/${iconName}` : '',
    version,
    beta,
  };
}
