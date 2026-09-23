/**
 * sync-lunaris.mjs — 从 lunaris.moe（api.lunaris.moe）补齐 genshin-db / gachabase 的缺口。
 *
 * 三类数据：
 *   char     旅行者的「异邦的××」固有天赋（genshin-db 给不出；冰旅行者还缺「异邦的层冰」），
 *            顺手把冰旅行者普通攻击描述里曾被手工粘进去的那段摘掉；
 *            另外用 dto.hyperlinks 给所有角色的正文补「状态说明」悬停词条（只增不改）
 *   weapon   content/weapons 里没有的武器（名称 / 星级 / 类型 / 主副属性 / 逐级曲线 / 精炼 / 图标）
 *   artifact content/artifacts 里没有的圣遗物套装（套装效果 / 五个部位名与图标）
 *
 * 策略：**只补本地没有的条目**（已实装内容仍以 genshin-db 生成的高精度数据为准）；
 * 新条目写 `"beta": true` 且 version = 所查 lunaris 版本的大版本.小版本（如 7.1），
 * 与 sync-gachabase.mjs 的测试服条目同口径，因此排在图鉴最前面。
 * `--force`（体验服口径）会连之前由第三方源写入的 beta 条目一起重抓。
 *
 * 已知缺口（lunaris 未提供）：武器故事、圣遗物部位故事/描述、武器突破材料分阶段表；
 * 这些字段留空，页面按现有兜底渲染。
 *
 * 用法：
 *   node scripts/sync-lunaris.mjs                      # 角色(旅行者) + 武器 + 圣遗物
 *   node scripts/sync-lunaris.mjs --kind=weapon        # 只补武器（char / weapon / artifact / all）
 *   node scripts/sync-lunaris.mjs --ver=7.0.54.2       # 指定 lunaris 版本（默认取 version.json 的最新）
 *   node scripts/sync-lunaris.mjs --force              # 重抓 beta 条目（体验服口径）
 *   node scripts/sync-lunaris.mjs --dry                # 只看会写什么
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDescription } from './lib/profile-text.mjs';
import { API, fetchJson, cleanText, buildWeapon, buildArtifact } from './lib/lunaris.mjs';
import { statsFromLunaris } from './lib/char-stats.mjs';
import { formatJson } from './lib/compact-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  characters: join(ROOT, 'content', 'characters'),
  weapons: join(ROOT, 'content', 'weapons'),
  artifacts: join(ROOT, 'content', 'artifacts'),
};

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const KIND = (arg('kind') || 'all').toLowerCase();
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const want = (k) => KIND === 'all' || KIND === k;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本项目角色名 → lunaris 角色 id（旅行者按元素拆开，文案与男女无关，统一取男主角 10000005） */
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
const CHAR_ALIASES = {
  '茜特拉莉': '茜特菈莉',
};

/** 已存在的本地条目：名称集合 + id 集合 + 第三方 beta 条目的 id + 缺数值条目的 id */
function loadLocal(dir) {
  const names = new Set();
  const ids = new Set();
  const betaIds = new Set();
  const incompleteIds = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    names.add(f.replace(/\.json$/, ''));
    try {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      if (d.name) names.add(d.name);
      if (d.id) {
        ids.add(String(d.id));
        if (d.beta) betaIds.add(String(d.id));
        /* gachabase 同步来的测试服武器没有 lv1 数值与逐级曲线（baseAtk: null）——
         * 这类条目就算已存在，也用 lunaris 的数值补全 */
        if (d.beta && (d.baseAtk === null || d.baseAtk === undefined || !d.curve)) {
          incompleteIds.add(String(d.id));
        }
      }
    } catch { /* 忽略坏文件 */ }
  }
  return { names, ids, betaIds, incompleteIds };
}

const writeJson = (file, obj) => {
  if (DRY) return;
  writeFileSync(file, formatJson(obj), 'utf-8');
};

/* ================= 角色：旅行者的「异邦的××」固有天赋 ================= */
function upsertPassive(profile, entry) {
  const passives = Array.isArray(profile.passives) ? profile.passives : [];
  const i = passives.findIndex((p) => p.name === entry.name);
  if (i >= 0) {
    /* 保留本地已有的状态说明（entry 只带 lunaris 正文解析出的那部分，
     * 会被后面的 syncCharStates 用 hyperlinks 补全，不能覆盖掉） */
    const merged = { ...entry };
    if (!merged.states?.length && passives[i].states?.length) merged.states = passives[i].states;
    if (JSON.stringify(passives[i]) === JSON.stringify(merged)) return false;
    passives[i] = merged;
  } else {
    passives.push(entry);
  }
  profile.passives = passives;
  return true;
}

async function syncTravelers(ver) {
  const made = [];
  for (const [name, id] of Object.entries(TRAVELERS)) {
    const file = join(DIRS.characters, `${name}.json`);
    if (!existsSync(file)) continue;
    let dto;
    try {
      dto = await fetchJson(`${API}/${ver}/chs/char/${id}.json`);
    } catch (err) {
      console.log(`   ✗ ${name}：${err.message}`);
      continue;
    }
    /* 「异邦的××」= passives 里名字以「异邦」开头的那条 */
    const raw = Object.values(dto.passives || {}).find((p) => String(p?.name || '').startsWith('异邦'));
    if (!raw) continue;
    const { description, lore, states } = parseDescription(cleanText(raw.description));
    const entry = { name: raw.name, description, lore, states, category: 'utility' };

    const profile = JSON.parse(readFileSync(file, 'utf-8'));
    let changed = upsertPassive(profile, entry);
    /* 冰旅行者：这段文案曾手工粘在普通攻击描述里，摘掉 */
    for (const sk of profile.skills || []) {
      const cut = String(sk.description || '').indexOf('从过往的旅途中');
      if (cut > 0) {
        sk.description = sk.description.slice(0, cut).replace(/\s+$/, '');
        changed = true;
      }
    }
    if (!changed) continue;
    writeJson(file, profile);
    made.push(`${name}：${entry.name}`);
    console.log(`   + [角色] ${name}：${entry.name}${DRY ? '（dry）' : ''}`);
    await sleep(200);
  }
  return made;
}

/* ================= 角色：状态说明（悬停词条） =================
 * lunaris 把游戏里的「状态说明」放在 dto.hyperlinks（{id,name,description}），
 * 正文里用 {LINK#N<id>}名字{/LINK} 引用。本地文件由其它数据源生成，LINK 标记被清洗后
 * 这些词条就只剩名字了 —— 页面上「领唱」「重唱」这类词自然没有悬停说明。
 *
 * 判断依据必须是 LINK 标记而不是「名字在正文里出现过」：
 *   元素爆发终奏·伴尔沉沦里的「领唱」指的是领唱者（主语），与固有天赋十二弦的泪歌里
 *   叠层的「领唱」同名但不同义 —— 前者没有 LINK，不应当挂上叠层说明。
 * 同时把之前按「名字出现过」误挂上的词条收回来（靠 text 与 hyperlinks 完全一致识别）。
 */

/** 从 lunaris 正文里取出 {LINK#N<id>} 引用的词条（按出现顺序去重；S 类链接无词条定义，跳过） */
function linkedEntries(raw, glossary) {
  const out = [];
  const seen = new Set();
  for (const m of String(raw || '').matchAll(/\{LINK#([NS]?)(\d+)\}/g)) {
    if (m[1] === 'S') continue;                      // {LINK#S11402} 这类指向技能本体，无量词条
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const g = glossary.get(m[2]);
    if (g) out.push(g);
  }
  return out;
}

/** 按「该条目正文真正 LINK 引用了哪些词条」同步 states（补缺 + 收掉误挂的） */
function applyStates(item, entries, glossary) {
  let changed = 0;
  const byName = new Map(glossary.map((g) => [g.name, g]));
  for (const holder of [item, item.buffs].filter(Boolean)) {
    const states = holder.states || [];
    const have = new Set(states.map((s) => s.name));
    const desc = holder.description || '';
    /* 1) 保留正文解析出来的状态块（text 与 hyperlinks 不一致）与正文真正引用的词条；
     *    收掉「名字在 hyperlinks 里、text 又是我们照抄的那份，但本条目正文没引用」的误挂词条 */
    const kept = states.filter((s) => {
      const g = byName.get(s.name);
      return !g || g.text !== s.text || entries.some((w) => w.name === s.name);
    });
    /* 2) 补上本条目正文 LINK 引用、本地还没有的词条（正文里要能找到名字，页面才能挂气泡） */
    const add = entries
      .filter((g) => !have.has(g.name) && desc.includes(g.name))
      .map((g) => ({ name: g.name, text: g.text }));
    const next = [...kept, ...add];
    if (JSON.stringify(next) === JSON.stringify(states)) continue;
    holder.states = next;
    changed++;
  }
  return changed;
}

/**
 * 逸闻（角色台词/旁白）：lunaris 把它放在正文的 <i>…</i> 斜体段里。
 * genshin-db 的正文常常没有这段（新角色尤其明显），本地 lore 就是空的 —— 这里补上。
 * 已存在且包含同样内容的就不动（保护手工文案）。
 */
function applyLore(item, raw) {
  const italics = [...String(raw || '').matchAll(/<i>([\s\S]*?)<\/i>/g)]
    .map((m) => cleanText(m[1]).trim())
    .filter(Boolean);
  if (!italics.length) return 0;
  const text = italics.join('\n');
  const probe = italics[0].slice(0, 12);
  let changed = 0;
  for (const holder of [item, item.buffs].filter(Boolean)) {
    const have = String(holder.lore || '');
    if (have && have.includes(probe)) continue;      // 已有（可能被 sync-buffs 改过措辞）
    if (String(holder.description || '').includes(probe)) continue;
    holder.lore = text;
    changed++;
  }
  return changed;
}

/** 简单的并发池（对第三方接口保持克制：并发 4 + 每条之间 120ms） */async function runPool(items, limit, worker) {
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

async function syncCharStates(ver) {
  let list;
  try {
    list = await fetchJson(`${API}/${ver}/charlist.json`);
  } catch (err) {
    console.log(`   ✗ 角色清单：${err.message}`);
    return [];
  }
  const idByName = new Map();
  for (const [id, v] of Object.entries(list)) {
    const n = cleanText(v.chsName || v.enName || '');
    if (n) idByName.set(n, id);
  }
  for (const [name, id] of Object.entries(TRAVELERS)) idByName.set(name, id);

  const targets = [];
  const unmatched = [];
  for (const f of readdirSync(DIRS.characters)) {
    if (!f.endsWith('.json')) continue;
    const name = f.replace(/\.json$/, '');
    const id = idByName.get(name) || idByName.get(CHAR_ALIASES[name]);
    if (id) targets.push({ name, id, file: join(DIRS.characters, f) });
    else unmatched.push(name);
  }

  const made = [];
  const filled = [];
  const loreMissing = [];
  await runPool(targets, 4, async ({ name, id, file }) => {
    let dto;
    try {
      dto = await fetchJson(`${API}/${ver}/chs/char/${id}.json`);
    } catch (err) {
      console.log(`   ✗ ${name}：${err.message}`);
      return;
    }
    const glossary = new Map();
    for (const h of dto.hyperlinks || []) {
      const name = cleanText(h.name);
      const text = cleanText(h.description);
      if (name.length >= 2 && text) glossary.set(String(h.id), { name, text });
    }

    let profile;
    try {
      profile = JSON.parse(readFileSync(file, 'utf-8'));
    } catch { return; }

    /* 1) 基础属性曲线：genshin-db 没有的角色（旅行者 / 最新未实装）用 lunaris 的逐级表补上 */
    let changed = 0;
    if (!profile.stats) {
      const stats = statsFromLunaris(dto.info?.attributes);
      if (stats) {
        profile.stats = stats;
        changed++;
        filled.push(`${name}（${stats.label}）`);
        console.log(`   + [角色] ${name}：补基础属性（${stats.label}）${DRY ? '（dry）' : ''}`);
      }
    }

    /* 2) 状态说明词条 + 逸闻：按正文里的 {LINK#N<id>} 标记与 <i> 斜体段同步 */
    {
      /* lunaris 的条目按名字对应本地条目（技能 / 固有天赋 / 命之座） */
      const locals = new Map();
      for (const it of [...(profile.skills || []), ...(profile.passives || []), ...(profile.constellations || [])]) {
        if (it.name) locals.set(it.name, it);
      }
      const all = [
        ...Object.values(dto.skills || {}),
        ...Object.values(dto.passives || {}),
        ...Object.values(dto.constellations || {}),
      ];
      const glossaryList = [...glossary.values()];
      let touched = 0;
      let loreFilled = 0;
      for (const src of all) {
        const target = locals.get(cleanText(src?.name));
        if (!target) continue;
        if (glossary.size) {
          touched += applyStates(target, linkedEntries(src.description, glossary), glossaryList);
        }
        if (applyLore(target, src.description)) loreFilled++;
      }
      if (touched || loreFilled) {
        changed += touched + loreFilled;
        if (touched) console.log(`   ⟳ [角色] ${name}：同步状态说明词条 ${touched} 处${DRY ? '（dry）' : ''}`);
        if (loreFilled) {
          loreMissing.push(name);
          console.log(`   + [角色] ${name}：补逸闻 ${loreFilled} 处${DRY ? '（dry）' : ''}`);
        }
      }
    }

    if (!changed) return;
    writeJson(file, profile);
    made.push(`${name}（${changed}）`);
  });
  console.log(`   角色清单 ${Object.keys(list).length} 条：基础属性补 ${filled.length} 个、状态说明/逸闻同步 ${made.length} 个${unmatched.length ? `（${unmatched.length} 个名称未匹配：${unmatched.slice(0, 5).join('、')}…）` : ''}`);
  return made;
}

/* ================= 武器 / 圣遗物：只补“最新新增”的条目 =================
 * lunaris 清单里混有历史遗留（如 15004「冰之川与雪之砂」= 1.2 beta 残留的冰套、15000 无名套装），
 * 因此只取「当前版本清单里有、上一个正式快照（X.Y.0）里没有」的 id，其余跳过。
 */
async function syncEquip(ver, refVer, { listFile, detailPath, build, dir, label }) {
  const made = [];
  const local = loadLocal(dir);
  const list = await fetchJson(`${API}/${ver}/${listFile}`);
  let refIds = new Set();
  if (refVer) {
    try {
      refIds = new Set(Object.keys(await fetchJson(`${API}/${refVer}/${listFile}`)));
    } catch { /* 参考版本拿不到就不做历史过滤 */ }
  }
  let old = 0;
  let unnamed = 0;
  for (const id of Object.keys(list)) {
    const entry = { id, ...list[id] };
    const name = entry.chsName;
    if (!name || !/\p{Script=Han}/u.test(name)) { unnamed++; continue; }   // 无中文名 / 占位条目
    if (refIds.size && refIds.has(id)) { old++; continue; }                // 旧版本就有 → 历史遗留
    const isLocal = local.names.has(name) || local.ids.has(String(id));
    /* 两种情况会覆盖已有条目：--force 重抓本地 beta 条目；或本地 beta 条目本身缺数值（补全） */
    const fillMissing = local.incompleteIds.has(String(id));
    const refreshable = (FORCE && local.betaIds.has(String(id))) || fillMissing;
    if (isLocal && !refreshable) continue;
    let dto;
    try {
      dto = await fetchJson(`${API}/${ver}/chs/${detailPath}/${id}.json`);
    } catch (err) {
      console.log(`   ✗ ${label} ${name}：${err.message}`);
      continue;
    }
    const out = build(entry, dto, { version: verMajor(ver), beta: true });
    if (!out.name) continue;
    /* 覆盖已有条目时，保留 lunaris 给不出的字段（突破材料表 / 武器故事 / 获取方式） */
    const file = join(dir, `${out.name}.json`);
    if (existsSync(file)) {
      try {
        const old = JSON.parse(readFileSync(file, 'utf-8'));
        if (!out.costs?.length && old.costs?.length) out.costs = old.costs;
        if (!out.story && old.story) out.story = old.story;
        if (!out.source && old.source) out.source = old.source;
      } catch { /* 旧文件坏了就按新数据写 */ }
    }
    writeJson(file, out);
    made.push(`${out.name}（${out.rarity}★）`);
    console.log(`   ${fillMissing ? '⟳' : '+'} [${label}] ${out.name}${fillMissing ? '（补全数值）' : ''}${DRY ? '（dry）' : ''}`);
    await sleep(200);
  }
  console.log(`   ${label}清单 ${Object.keys(list).length} 条：新增/补全 ${made.length} 条（历史条目 ${old} 条、无名 ${unnamed} 条已跳过；本地已有 ${local.names.size} 个名称）`);
  return made;
}

/** "7.1.0" → "7.1"（新条目写进 version 字段，用于图鉴排序） */
const verMajor = (v) => {
  const m = String(v).match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : String(v);
};

/* ================= 主流程 ================= */
async function main() {
  const info = await fetchJson(`${API}/version.json`);
  const ver = arg('ver') || info.version;
  /* 参考版本：当前版本之前最新的「X.Y.0」正式快照（用于区分历史条目与新内容） */
  const refVer = (info.versions || []).find((v) => /^\d+\.\d+\.0$/.test(v) && v !== ver) || '';
  console.log(`lunaris 数据版本：${ver}（站点最新：${info.version}；历史对照：${refVer || '无'}）${FORCE ? ' · --force 重抓 beta 条目' : ''}`);

  const made = [];
  if (want('char')) {
    made.push(...(await syncTravelers(ver)));
    made.push(...(await syncCharStates(ver)));
  }
  if (want('weapon')) {
    made.push(...(await syncEquip(ver, refVer, {
      listFile: 'weaponlist.json', detailPath: 'weapon', build: buildWeapon, dir: DIRS.weapons, label: '武器',
    })));
  }
  if (want('artifact')) {
    made.push(...(await syncEquip(ver, refVer, {
      listFile: 'artifactlist.json', detailPath: 'artifact', build: buildArtifact, dir: DIRS.artifacts, label: '圣遗物',
    })));
  }
  console.log(`\n✅ lunaris 同步完成：新增/更新 ${made.length} 条${DRY ? '（--dry 未写文件）' : ''}`);
}

try {
  await main();
} catch (err) {
  // 网络 / 接口变动不阻断 npm run data 的其余步骤
  console.log(`⚠️ lunaris 同步失败（不影响本地已有数据）：${err.message}`);
}
