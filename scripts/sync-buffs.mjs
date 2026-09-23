/**
 * sync-buffs.mjs — 从 gachabase 抓角色「加强」文本（buffed_description）并写进本地角色资料。
 *
 * 背景：gachabase 的角色天赋 / 固有天赋 / 命座对象都带 buffed_description 字段
 *   （genshin-db 完全没有这个字段），内容 = 基础描述 + 加强改动（魔导·秘仪 / 月兆·满辉 / 辉映·星烁等）。
 *
 * 做法：两边都先按与 generate-profiles.mjs 相同的规则解析成「正文 / 逸闻 / 状态块」，
 *   再对「基础正文 → 加强正文」做**逐词级 diff**（数字整块、其余逐字），
 *   只把「加强描述里新出现、基础描述里没有」的片段包成 <buff>…</buff> 写进
 *   content/characters/<名>.json 对应条目的 buffs 字段：
 *     "buffs": { "description": "……<buff>新增片段</buff>……", "lore": "（仅逸闻被改动时写入）", "states": [ … ] }
 *   页面（src/pages/characters.js）优先渲染 buffs.description，并把 <buff> 换成 .rt-buff（金色）。
 *   重叠部分保持正文色 —— 只标新增，不给整段上色。
 *
 * 武器 / 圣遗物不处理：gachabase 的武器精炼没有 buffed_description（只有 id/name/description/parameters），
 *   正文里的加强条款属于正文本身，不算「新增」，因此不上色。
 *
 * 用法：
 *   node scripts/sync-buffs.mjs          # 抓取并写入（已纳入 npm run data）
 *   node scripts/sync-buffs.mjs --dry    # 只打印预览，不写文件（明细输出 .tmp-buffs-preview.txt）
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDescription } from './lib/profile-text.mjs';
import { formatJson } from './lib/compact-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHAR_DIR = join(ROOT, 'content', 'characters');
const BASE = 'https://gi.gachabase.net';
const DRY = process.argv.includes('--dry');
const UA = {
  'User-Agent': 'ellen-wiki-data-sync/1.0 (+https://github.com/lihua123123/ellenwiki)',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** gachabase 官方用字 → 本项目沿用的写法（与 sync-gachabase.mjs 保持一致） */
const NAME_ALIASES = { 茜特菈莉: '茜特拉莉' };
/** 旅行者/空荧/人偶 多形态条目：gachabase 侧没有对应天赋文本，跳过 */
const SKIP_NAME = /^旅行者/;

/* ---------- SvelteKit __data.json 解析（同 sync-gachabase.mjs） ---------- */
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
    if (raw === null || typeof raw !== 'object') { cache.set(v, raw); return raw; }
    const out = Array.isArray(raw)
      ? raw.map(resolve)
      : Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, resolve(x)]));
    cache.set(v, out);
    return out;
  };
  return resolve(0);
}

const fetchJson = async (path) => parseDataJson(await (await fetch(`${BASE}${path}/__data.json?lang=chs`, { headers: UA })).text());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (v) => (v && typeof v === 'object' ? (v.text ?? '') : (v ?? ''));

/** 去掉 gachabase 的富文本标记并还原换行（在 sync-gachabase.mjs 的 cleanText 基础上再删掉 <i> 等标签） */
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

const OPEN = '<buff>';
const CLOSE = '</buff>';

/* ---------- 逐词级 diff ---------- */
/** 切成「词」：数字（含 %）整块、英文单词整块、其余逐字 */
const TOKEN_RE = /\d+(?:\.\d+)?%?|[A-Za-z]+|\s+|[^\sA-Za-z\d]/g;
const tokenize = (s) => String(s ?? '').match(TOKEN_RE) || [];
/** 没有实质内容的片段（纯标点 / 空白）不上色 */
const isTrivial = (s) => !String(s).replace(/[\s。；，、,;：:！？!?（）()「」『』·…—\-%+*/｜|]/g, '');

/** 逐词 LCS，返回 [{ op: '=' | '-' | '+', text }]（同类项已合并） */
function diffTokens(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return [{ op: '+', text: b.join('') }];
  if (!m) return [{ op: '-', text: a.join('') }];
  // 超长文本退化为「公共前后缀 + 中间整体算新增」，避免 DP 爆内存
  if (n * m > 6_000_000) {
    let p = 0;
    while (p < n && p < m && a[p] === b[p]) p++;
    let s = 0;
    while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
    return [
      { op: '=', text: b.slice(0, p).join('') },
      { op: '-', text: a.slice(p, n - s).join('') },
      { op: '+', text: b.slice(p, m - s).join('') },
      { op: '=', text: b.slice(m - s).join('') },
    ].filter((o) => o.text);
  }
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  const push = (op, text) => {
    const last = ops[ops.length - 1];
    if (last && last.op === op) last.text += text;
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('=', b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('-', a[i]); i++; }
    else { push('+', b[j]); j++; }
  }
  while (i < n) push('-', a[i++]);
  while (j < m) push('+', b[j++]);
  return ops;
}

/**
 * 只给「新增」上色：以加强描述为准，被改写掉的旧句直接消失，
 * 基础描述里已有的内容保持正文色。
 */
function markAdded(baseText, buffedText) {
  const ops = diffTokens(tokenize(baseText), tokenize(buffedText));
  let out = '';
  for (const o of ops) {
    if (o.op === '-') continue;
    if (o.op === '=') out += o.text;
    else out += isTrivial(o.text) ? o.text : `${OPEN}${o.text.replace(/^\s+|\s+$/g, '')}${CLOSE}`;
  }
  return out
    .replace(new RegExp(`${OPEN}\\s*${CLOSE}`, 'g'), '')
    .replace(new RegExp(`${CLOSE}\\s*${OPEN}`, 'g'), '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

/** 判断两份状态块是否等价 */
const sameStates = (a = [], b = []) =>
  a.length === b.length && a.every((x, i) => x.name === b[i].name && x.text === b[i].text);

/** item.states 里「由正文解析出来」的那部分（sync-lunaris 用 hyperlinks 补的词条不参与比较） */
const textStates = (states = [], parsed = []) => {
  const names = new Set(parsed.map((s) => s.name));
  return states.filter((s) => names.has(s.name));
};

/* ---------- 主流程 ---------- */
async function main() {
  console.log('从 gachabase 提取「加强」文本…');
  const payload = await fetchJson('/characters/beta');
  const byName = new Map();
  for (const e of payload.data?.entries || []) {
    const name = textOf(e.name);
    if (name && e.slug && !/^\d+$/.test(e.slug)) byName.set(name, e);
  }

  const files = readdirSync(CHAR_DIR).filter((f) => f.endsWith('.json'));
  const preview = [];
  let scanned = 0;
  let touched = 0;
  let buffedItems = 0;
  let failed = 0;

  for (const f of files) {
    const file = join(CHAR_DIR, f);
    const profile = JSON.parse(readFileSync(file, 'utf-8'));
    const name = profile.name;
    if (!name || SKIP_NAME.test(name)) continue;
    const entry = byName.get(name) || byName.get(Object.keys(NAME_ALIASES).find((k) => NAME_ALIASES[k] === name));
    if (!entry) continue;

    let dto;
    try {
      dto = (await fetchJson(`/characters/${entry.id}/${entry.slug}/beta`)).data?.dto;
    } catch (err) {
      console.log(`   ✗ ${name}：${err.message}`);
      failed++;
      await sleep(250);
      continue;
    }
    if (!dto?.name) { await sleep(250); continue; }
    scanned++;

    /* --- 战斗天赋：按 id 尾数 1 / 2 / 5 对应 普攻 / 战技 / 爆发 --- */
    const KIND = { 1: 'attack', 2: 'skill', 5: 'burst' };
    const talents = {};
    for (const t of dto.talents || []) {
      if (String(t.id).length !== 5) continue;
      const kind = KIND[Number(String(t.id).slice(-1))];
      if (kind && !talents[kind]) talents[kind] = t;
    }

    const targets = [];
    for (const sk of profile.skills || []) {
      const t = talents[sk.id];
      if (t) targets.push({ item: sk, base: t.description, buffed: t.buffed_description });
    }
    for (const p of profile.passives || []) {
      const t = (dto.passives || []).find((x) => textOf(x.name) === p.name);
      if (t) targets.push({ item: p, base: t.description, buffed: t.buffed_description });
    }
    for (const c of profile.constellations || []) {
      const t = (dto.constellations || []).find((x) => textOf(x.name) === c.name);
      if (t) targets.push({ item: c, base: t.description, buffed: t.buffed_description });
    }

    let changed = false;
    for (const { item, base, buffed } of targets) {
      const baseText = cleanText(textOf(base));
      const buffedText = cleanText(textOf(buffed));
      if (!buffedText || buffedText === baseText) {
        if (item.buffs) { delete item.buffs; changed = true; }
        continue;
      }

      const parsed = parseDescription(buffedText);
      const marked = markAdded(item.description, parsed.description);
      const statesChanged = !sameStates(textStates(item.states, parsed.states), parsed.states);
      const loreChanged = Boolean(parsed.lore) && parsed.lore !== item.lore;
      if (marked === item.description && !statesChanged && !loreChanged) {
        if (item.buffs) { delete item.buffs; changed = true; }
        continue;
      }

      const buffs = { description: marked };
      if (loreChanged) buffs.lore = parsed.lore;
      /* buffs.states 会被页面优先使用 —— 正文解析出的状态块之外，
       * 还要保留 sync-lunaris 从 hyperlinks 补进来的额外词条 */
      if (statesChanged) {
        const extra = (item.states || []).filter((s) => !parsed.states.some((p) => p.name === s.name));
        buffs.states = [...parsed.states, ...extra];
      }
      item.buffs = buffs;
      changed = true;
      buffedItems++;
      preview.push(
        `\n### ${name} / ${item.name || item.id}\n[基础] ${item.description}\n[加强] ${marked}`,
      );
    }

    if (changed) {
      touched++;
      if (!DRY) writeFileSync(file, formatJson(profile), 'utf-8');
      console.log(`   + ${name}（加强条目 ${targets.filter((t) => t.item.buffs).length} 个）`);
    }
    await sleep(200);
  }

  writeFileSync(join(ROOT, '.tmp-buffs-preview.txt'), preview.join('\n'), 'utf-8');
  console.log(
    `\n✅ 扫描 ${scanned} 名角色，${touched} 名有加强文本（共 ${buffedItems} 个条目）${failed ? `，${failed} 名抓取失败` : ''}${DRY ? '（--dry 未写文件）' : ''}`,
  );
}

await main();
