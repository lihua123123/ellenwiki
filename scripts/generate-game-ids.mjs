/**
 * generate-game-ids.mjs — 生成「游戏内 ID / GOOD 英文键 ↔ 站内条目」对照表：src/data/game-ids.json
 *
 * 为什么需要这张表：
 *   1) Enka.Network 的数据里只有 id（角色 avatarId、武器 icon 文件名、圣遗物套装 setId），没有中文名
 *   2) GOODScanner 等工具导出的 GOOD v3 JSON 里只有英文字符串键
 *      （角色 `HuTao`、套装 `CrimsonWitchOfFlames`、属性 `critRate_`），也没有中文名
 *   两份映射都在这里，页面据此还原成站内已有条目（能直接跳图鉴页）。
 *
 * 生成内容：
 *   avatars     { avatarId: { name, slug } }              角色：genshin-db 的 id（= 游戏 avatarId）
 *   weapons     { ui_equipicon_xxx: { name, slug } }       武器：Enka 的 flat.icon 去 .png（小写）
 *   sets        { setId: { name, slug } }                  圣遗物套装：Enka 的 flat.setId
 *   goodChars   { hutao: { name, slug } }                  GOOD 角色键（小写）= 英文名去掉非字母数字
 *   goodWeapons { staffofhoma: { name, slug } }            GOOD 武器键（小写）
 *   goodSets    { crimsonwitchofflames: { name, slug } }   GOOD 套装键（小写）
 *
 * 运行：npm run game-ids（已并入 npm run index）
 */
import fs from 'node:fs';
import path from 'node:path';
import GDB from 'genshin-db';

const ROOT = process.cwd();
/** 用中文名查询（站内文件名就是中文），同时取英文名（用来算 GOOD 键） */
const ZH2EN = { queryLanguages: ['ChineseSimplified'], resultLanguage: 'English' };

/** 手动补充：genshin-db 查不到、或同一个 id 对应多个形态的 */
const ALIAS_AVATARS = {
  10000005: '旅行者（风）', 10000006: '旅行者（风）',
  10000007: '旅行者（草）', 10000008: '旅行者（草）',
  10000009: '旅行者（岩）', 10000010: '旅行者（岩）',
  10000011: '旅行者（雷）', 10000012: '旅行者（雷）',
  10000013: '旅行者（水）', 10000014: '旅行者（水）',
  10000015: '旅行者（火）', 10000016: '旅行者（火）',
  10000017: '旅行者（冰）', 10000018: '旅行者（冰）',
};

/** 站内文件名 → genshin-db 里的正式写法（同音字不一致时用） */
const NAME_ALIASES = { 茜特拉莉: '茜特菈莉' };

/** genshin-db 里还没有实装资料的新角色：直接写 avatarId（游戏内 id，只增不改） */
const MANUAL_AVATAR_IDS = {
  10000143: '薇斯纳',
};

/**
 * GOOD 的键 = 英文名去掉所有非字母数字（"Kamisato Ayaka" → "KamisatoAyaka"）。
 * 不同工具对「of/the/and」这类虚词的大小写处理不一致（CrimsonWitchofFlames / CrimsonWitchOfFlames），
 * 所以统一转小写后存取，匹配时也转小写。
 */
const goodKey = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []);
const gdb = (fn, name) => {
  try {
    return fn(name, ZH2EN);
  } catch {
    return null;
  }
};

/* ---------- 角色 ---------- */
const avatars = {};
const goodChars = {};
const missedChars = [];
for (const file of listJson(path.join(ROOT, 'content/characters'))) {
  const name = path.basename(file, '.json');
  const info = gdb(GDB.characters, NAME_ALIASES[name] || name);
  if (info?.id) {
    avatars[String(info.id)] = { name, slug: name };
    if (info.name) goodChars[goodKey(info.name)] = { name, slug: name };
  } else {
    missedChars.push(name);
  }
}
/* 新角色：genshin-db 还没有，手写 id */
for (const [id, name] of Object.entries(MANUAL_AVATAR_IDS)) {
  if (!avatars[id] && fs.existsSync(path.join(ROOT, 'content/characters', name + '.json'))) avatars[id] = { name, slug: name };
}
for (const [id, name] of Object.entries(ALIAS_AVATARS)) {
  if (!avatars[id] && fs.existsSync(path.join(ROOT, 'content/characters', name + '.json'))) avatars[id] = { name, slug: name };
}

/* ---------- 武器 ---------- */
const weapons = {};
const goodWeapons = {};
const missedWeapons = [];
for (const file of listJson(path.join(ROOT, 'content/weapons'))) {
  const slug = path.basename(file, '.json');
  const w = readJson(file);
  const iconKey = String(w.icon || '').replace(/\.png$/i, '');
  if (iconKey) weapons[iconKey.toLowerCase()] = { name: w.name, slug, iconKey, id: w.id };
  const info = gdb(GDB.weapons, slug);
  if (info?.name) goodWeapons[goodKey(info.name)] = { name: w.name, slug, iconUrl: w.iconUrl || '', rarity: w.rarity ?? '' };
  else missedWeapons.push(slug);
}

/* ---------- 圣遗物套装 ---------- */
const sets = {};
const goodSets = {};
const missedSets = [];
for (const file of listJson(path.join(ROOT, 'content/artifacts'))) {
  const slug = path.basename(file, '.json');
  const a = readJson(file);
  const label = a.name || slug;
  if (a.id) sets[String(a.id)] = { name: label, slug };
  /* 少数套装的 id 与 icon 里的编号不一致时，用 icon 里的编号再补一份 */
  const m = String(a.icon || '').match(/UI_RelicIcon_(\d+)_/);
  if (m && !sets[String(Number(m[1]))]) sets[String(Number(m[1]))] = { name: label, slug };
  const info = gdb(GDB.artifacts, slug);
  if (info?.name) goodSets[goodKey(info.name)] = { name: label, slug, setId: a.id ? String(a.id) : '' };
  else missedSets.push(slug);
}

const out = {
  note: '由 npm run game-ids 生成，勿手改。用途与生成规则见 scripts/generate-game-ids.mjs（GOOD 键统一小写）',
  generatedAt: new Date().toISOString().slice(0, 10),
  avatars,
  weapons,
  sets,
  goodChars,
  goodWeapons,
  goodSets,
};

const target = path.join(ROOT, 'src/data/game-ids.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n', 'utf8');

const miss = (label, list) => (list.length ? `\nℹ️  ${list.length} 个${label}查不到映射（页面会显示原始 id/键）：${list.join('、')}` : '');
console.log(`✅ ${path.relative(ROOT, target)}`);
console.log(`   角色 ${Object.keys(avatars).length}（GOOD ${Object.keys(goodChars).length}）· 武器 ${Object.keys(weapons).length}（GOOD ${Object.keys(goodWeapons).length}）· 套装 ${Object.keys(sets).length}（GOOD ${Object.keys(goodSets).length}）`);
console.log(miss('角色', missedChars) + miss('武器', missedWeapons) + miss('套装', missedSets));
