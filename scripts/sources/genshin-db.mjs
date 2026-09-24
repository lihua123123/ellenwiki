/**
 * sources/genshin-db.mjs — 数据源适配器：genshin-db（正式服）。
 *
 * 本项目最权威的来源：角色 / 武器 / 圣遗物全量数据（武器逐级曲线、角色 1~90 级属性表）。
 * 全量重刷用 `npm run data:refresh`；本适配器负责「按名称取单条」用于精确复查。
 */
import {
  GDB, LANG, CHAR_ALIASES, isPlaceholderName,
  buildWeapon, buildArtifact, buildCharacter,
  weaponNames, weaponZhToEn, artifactNames, artifactZhToEn, charZhToEn,
} from '../lib/gdb.mjs';

/** 每类的「源清单」缓存：{ name, id, en } */
const listCache = new Map();

/** 非可玩条目（旅行者的男女形态与「奇偶」测试用条目）：不参与扫描 */
const SKIP_CHARACTERS = new Set(['空', '荧', '奇偶·男性', '奇偶·女性']);

/** genshin-db 的中文名 → 本项目写法（与 lib/gdb.mjs 的 CHAR_ALIASES 对齐，反向求出） */
function charLocalNames() {
  const map = new Map();
  for (const [local, en] of Object.entries(CHAR_ALIASES)) {
    if (local.startsWith('旅行者')) continue;
    const zh = GDB.characters(en, LANG)?.name;
    if (zh) map.set(zh, local);
  }
  return map;
}

async function buildList(kind) {
  if (listCache.has(kind)) return listCache.get(kind);
  let out = [];
  if (kind === 'weapon') {
    out = weaponNames()
      .map((en) => {
        const info = GDB.weapons(en, LANG);
        return info?.name && !isPlaceholderName(info.name) ? { name: info.name, id: info.id, en } : null;
      })
      .filter(Boolean);
  } else if (kind === 'artifact') {
    out = artifactNames()
      .map((en) => {
        const info = GDB.artifacts(en, LANG);
        return info?.name && !isPlaceholderName(info.name) ? { name: info.name, id: info.id, en } : null;
      })
      .filter(Boolean);
  } else if (kind === 'character') {
    const rename = charLocalNames();
    out = [...charZhToEn()]
      .filter(([name]) => !SKIP_CHARACTERS.has(name))
      .map(([name, en]) => ({ name: rename.get(name) || name, en }));
  }
  listCache.set(kind, out);
  return out;
}

export default {
  id: 'genshin-db',
  label: 'genshin-db',
  note: '正式服（npm 包）· 含武器逐级曲线与角色 1~90 级属性表',
  beta: false,
  kinds: ['character', 'weapon', 'artifact'],

  async list(kind) {
    return buildList(kind);
  },

  /** 在源里定位单条：优先 id，其次中文名（含项目别名） */
  async resolve(kind, { name, id } = {}) {
    const list = await buildList(kind);
    if (id != null) {
      const hit = list.find((e) => e.id != null && String(e.id) === String(id));
      if (hit) return hit;
    }
    if (!name) return null;
    const direct = list.find((e) => e.name === name);
    if (direct) return direct;
    const alias = kind === 'weapon' ? weaponZhToEn() : kind === 'artifact' ? artifactZhToEn() : charZhToEn();
    const en = alias.get(name);
    if (en) return list.find((e) => e.en === en) || null;
    /* 旅行者按元素拆分，不在 characters 清单里，但 talents/constellations 有数据 */
    if (kind === 'character' && CHAR_ALIASES[name]) return { name, en: CHAR_ALIASES[name] };
    return null;
  },

  async fetch(kind, entry) {
    if (!entry) return null;
    if (kind === 'weapon') {
      const info = GDB.weapons(entry.en, LANG);
      return info?.name ? buildWeapon(info) : null;
    }
    if (kind === 'artifact') {
      const info = GDB.artifacts(entry.en, LANG);
      return info?.name ? buildArtifact(info) : null;
    }
    if (kind === 'character') {
      const data = buildCharacter(entry.name);
      return data ? { data } : null;
    }
    return null;
  },
};
