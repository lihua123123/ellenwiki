/**
 * local-store.mjs — content/ 本地数据的读写、索引与「源覆盖」合并规则（三个数据源适配器共用）。
 *
 * 三类图鉴（kind）：character 角色 / weapon 武器 / artifact 圣遗物。
 * 文件名 = 条目中文名（与 JSON 里的 name 字段一致），一个条目一个文件。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatJson } from './compact-json.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTENT = join(ROOT, 'content');

export const KINDS = ['character', 'weapon', 'artifact'];
export const KIND_LABEL = { character: '角色', weapon: '武器', artifact: '圣遗物' };
export const DIRS = {
  character: join(CONTENT, 'characters'),
  weapon: join(CONTENT, 'weapons'),
  artifact: join(CONTENT, 'artifacts'),
};

/** 文件名里不能出现的字符（与 generate-*.mjs 的 sanitize 保持一致） */
export const sanitize = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
/**
 * 数据源里尚未公布中文名的占位条目（genshin-db 的「武器-法器」、lunaris 的英文占位名等）。
 * 这类条目没有正式名称与描述，写进图鉴只会多一张空卡片，生成与扫描时都跳过。
 */
export const isPlaceholderName = (name) => /^(?:武器|圣遗物|道具|材料|角色)-/.test(String(name || ''))
  || /^(?:weapon|artifact|character|material|item)\b/i.test(String(name || ''));export const fileOf = (kind, name) => join(DIRS[kind], `${sanitize(name)}.json`);
export const relOf = (file) => file.replace(ROOT, '.').replace(/\\/g, '/');

export function readLocal(kind, name) {
  const file = fileOf(kind, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeLocal(kind, name, obj) {
  mkdirSync(DIRS[kind], { recursive: true });
  const file = fileOf(kind, name);
  writeFileSync(file, formatJson(obj), 'utf-8');
  return file;
}

/** 该类别本地全部条目（文件名 + 内容） */
export function listLocal(kind) {
  const dir = DIRS[kind];
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const name = f.replace(/\.json$/, '');
      let data = null;
      try {
        data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      } catch { /* 坏文件：只保留文件名 */ }
      return { name, data, file: join(dir, f) };
    });
}

/** 本地索引：名称集合 + id→条目（用于「源有、本地没有」的判断） */
export function localIndex(kind) {
  const names = new Set();
  const byId = new Map();
  for (const e of listLocal(kind)) {
    names.add(e.name);
    if (e.data?.name) names.add(e.data.name);
    if (e.data?.id != null) byId.set(String(e.data.id), e);
  }
  return { names, byId };
}

/** 本地是否已有该源条目（先按 id，再按名称） */
export function hasLocal(index, entry) {
  if (entry?.id != null && index.byId.has(String(entry.id))) return true;
  return !!(entry?.name && index.names.has(entry.name));
}

/**
 * 在三个类别里按名称查找本地条目。
 * exact = 文件名 / name 字段完全相同；loose = 包含关系（同名不同类别会返回多条）。
 */
export function findLocal(input) {
  const q = String(input).trim();
  const exact = [];
  const loose = [];
  for (const kind of KINDS) {
    for (const e of listLocal(kind)) {
      const name = e.name;
      if (name === q || e.data?.name === q) exact.push({ kind, ...e });
      else if (name.includes(q) || q.includes(name)) loose.push({ kind, ...e });
    }
  }
  return exact.length ? exact : loose;
}

const isEmpty = (v) => v === undefined || v === null || v === ''
  || (Array.isArray(v) && v.length === 0);

/**
 * 源覆盖本地时的合并规则（用户口径）：**整条以数据源为准，但数据源给不出的字段保留本地值**。
 * 判断「给不出」= 源对象里该字段缺失 / null / 空串 / 空数组。
 * 返回 { obj, kept }，kept 为被保留的字段名（复查报告里会列出来）。
 */
export function mergeEntry(remote, local) {
  const obj = { ...remote };
  const kept = [];
  if (local) {
    for (const [k, v] of Object.entries(local)) {
      if (!isEmpty(obj[k]) || isEmpty(v)) continue;
      obj[k] = v;
      kept.push(k);
    }
  }
  return { obj, kept };
}
