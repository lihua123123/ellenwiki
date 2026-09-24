/**
 * sources/index.mjs — 数据源注册表 + 通用动作（scan / add / check / fill）。
 *
 * 三个适配器实现同一套接口，所以「更新方式」只有一条代码路径：
 *   id / label / note / beta / kinds / full?   元信息（beta = 含体验服数据；full = 可整体抓取覆盖的类别）
 *   list(kind)                                 源中该类别的候选条目 [{ id?, name?, ... }]
 *   resolve(kind, { name, id })                在源里定位单条（复查用，返回候选条目或 null）
 *   fetch(kind, entry, opts)                   抓取并映射成本项目 JSON → { data, attach? } 或直接对象
 *   enrich(kind, entry, local)                 可选：用源补全本地缺失字段 → { data, notes } | null
 *   runPool?(items, limit, worker)             可选：并发池（第三方接口限速用）
 *
 * 覆盖规则见 lib/local-store.mjs 的 mergeEntry：整条以数据源为准，数据源给不出的字段保留本地值。
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import genshinDb from './genshin-db.mjs';
import gachabase from './gachabase.mjs';
import lunaris from './lunaris.mjs';
import {
  ROOT, KINDS, KIND_LABEL, listLocal, readLocal, writeLocal, localIndex, hasLocal, mergeEntry,
} from '../lib/local-store.mjs';
import { diffJson, diffSummary } from '../lib/json-diff.mjs';
import { appendPlaceholder } from '../lib/attachment-md.mjs';

/** 数据源列表（顺序 = 菜单顺序） */
export const SOURCES = [gachabase, lunaris, genshinDb];
const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

/** 支持 id / 序号（1 起）两种写法 */
export function getSource(id) {
  if (BY_ID.has(id)) return BY_ID.get(id);
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= SOURCES.length ? SOURCES[n - 1] : null;
}

const KIND_ALIAS = {
  character: 'character', char: 'character', 角色: 'character',
  weapon: 'weapon', 武器: 'weapon',
  artifact: 'artifact', equip: 'artifact', 圣遗物: 'artifact',
};

/** 解析 --kind=（all / char / weapon / artifact） */
export function parseKinds(value) {
  const v = String(value || 'all').trim();
  if (!v || v === 'all' || v === '全部') return [...KINDS];
  const kind = KIND_ALIAS[v];
  return kind ? [kind] : [...KINDS];
}

/** 条目在报告里的显示名 */
export const entryLabel = (e) => e?.name || e?.enName || (e?.id != null ? `#${e.id}` : '未知');

/**
 * 覆盖前的准备：先套用通用例外规则，再按 mergeEntry（源为空的字段保留本地值）合并。
 * 例外：体验服源的 version 是「下一版」推算值（gachabase 用 beta 修订号 +1）——
 * 本地已经是实装内容（没有 beta 标记、且有版本号）时保留本地版本，避免把 7.0 的角色排到 7.2。
 */
export function prepareMerge(remote, local) {
  const obj = { ...remote };
  const extra = [];
  if (obj.beta && local && !local.beta && local.version) {
    obj.version = local.version;
    extra.push('version');
  }
  const { obj: merged, kept } = mergeEntry(obj, local);
  return { obj: merged, kept: [...new Set([...extra, ...kept])] };
}

/* ===================== scan：源有、本地没有 ===================== */
export async function scan(source, kinds = source.kinds) {
  const report = {};
  for (const kind of kinds) {
    const index = localIndex(kind);
    try {
      const entries = await source.list(kind);
      report[kind] = { total: entries.length, fresh: entries.filter((e) => !hasLocal(index, e)) };
    } catch (err) {
      report[kind] = { total: 0, fresh: [], error: err.message };
    }
  }
  return report;
}

/* ===================== add：导入新增（可 --refresh 重抓 beta 条目） ===================== */
export async function addNew(source, kinds = source.kinds, { dry = false, refresh = false } = {}) {
  const added = [];
  const failed = [];
  for (const kind of kinds) {
    const index = localIndex(kind);
    let entries = [];
    try {
      entries = await source.list(kind);
    } catch (err) {
      failed.push({ kind, name: '清单', error: err.message });
      continue;
    }
    for (const entry of entries) {
      const existing = (entry.id != null && index.byId.get(String(entry.id))) || null;
      const isLocal = hasLocal(index, entry) || !!existing;
      const local = existing?.data || readLocal(kind, entry.name) || null;
      /* 已有条目只在 --refresh（体验服口径）且本地是 beta 条目时重抓 */
      if (isLocal && !(refresh && local?.beta)) continue;
      try {
        const res = await source.fetch(kind, entry, { dry });
        const data = res?.data ?? res;
        if (!data?.name) continue;
        const { obj, kept } = prepareMerge(data, local);
        if (!dry) {
          writeLocal(kind, obj.name, obj);
          /* 新角色：在附着/产球 md 里补占位小节（幂等） */
          if (res?.attach && !local) appendPlaceholder(obj.name, res.attach, { dry });
        }
        added.push({ kind, name: obj.name, refreshed: !!(local), kept });
      } catch (err) {
        failed.push({ kind, name: entryLabel(entry), error: err.message });
      }
    }
  }
  return { added, failed };
}

/* ===================== check：精确复查单条 ===================== */
/**
 * 在数据源里定位该条目并抓取，与本地对比。
 * 返回 { found, local, remote, changes, merged, kept }；found=false 表示数据源里没有该条目。
 */
export async function check(source, kind, name) {
  const local = readLocal(kind, name);
  const entry = await source.resolve(kind, { name, id: local?.id });
  if (!entry) return { found: false, reason: '数据源清单里没有该条目（可能是名称不一致或数据源不含它）' };
  const res = await source.fetch(kind, entry);
  const remote = res?.data ?? res;
  if (!remote?.name) return { found: false, reason: '数据源没有返回可用数据' };
  const changes = diffJson(local, remote);
  const { obj, kept } = prepareMerge(remote, local);
  return { found: true, local, remote, changes, merged: obj, kept, entry, attach: res?.attach };
}

/** 把复查结果写入本地（覆盖） */
export function applyCheck(kind, name, merged) {
  return writeLocal(kind, name, merged);
}

export { diffSummary };

/* ===================== fill：用源补全本地缺失字段 ===================== */
export async function fill(source, kinds = source.kinds, { name = '', dry = false } = {}) {
  if (typeof source.enrich !== 'function') {
    return { unsupported: true, done: [], failed: [] };
  }
  const done = [];
  const failed = [];
  for (const kind of kinds) {
    const items = listLocal(kind).filter((e) => e.data && (!name || e.name.includes(name) || String(e.data.name || '').includes(name)));
    const worker = async ({ name: localName, data }) => {
      try {
        const entry = await source.resolve(kind, { name: localName, id: data.id });
        if (!entry) return;
        const res = await source.enrich(kind, entry, data);
        if (!res?.data) return;
        if (JSON.stringify(res.data) === JSON.stringify(data)) return;
        if (!dry) writeLocal(kind, localName, res.data);
        done.push({ kind, name: localName, notes: res.notes || [] });
      } catch (err) {
        failed.push({ kind, name: localName, error: err.message });
      }
    };
    if (source.runPool) await source.runPool(items, 4, worker);
    else for (const it of items) await worker(it);
  }
  return { unsupported: false, done, failed };
}

/* ===================== 公共尾部：与数据源无关的本地重建 ===================== */
/**
 * 写完 content/** 之后要跑一遍：解析 md → 重建武器 / 圣遗物索引 → 补角色实装版本 → 重算「加强」文本。
 * sync-buffs 需要联网（gachabase），失败只告警不阻断。
 */
const POST_STEPS = [
  { script: 'parse-boss.mjs' },
  { script: 'parse-attachment.mjs' },
  { script: 'generate-weapons.mjs' },
  { script: 'generate-artifacts.mjs' },
  { script: 'sync-character-versions.mjs' },
  { script: 'sync-buffs.mjs', tolerant: true },
];

export function postprocess({ quiet = false } = {}) {
  for (const { script, tolerant } of POST_STEPS) {
    if (!quiet) console.log(`\n$ node scripts/${script}`);
    const res = spawnSync(process.execPath, [join(ROOT, 'scripts', script)], { stdio: 'inherit', cwd: ROOT });
    if (res.status !== 0) {
      if (tolerant) console.log(`⚠️ ${script} 失败（不影响已写入的数据），退出码 ${res.status}`);
      else {
        console.error(`✗ ${script} 退出码 ${res.status}，已中断。`);
        process.exit(res.status ?? 1);
      }
    }
  }
}

export { KIND_LABEL, KINDS };
