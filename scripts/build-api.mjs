/**
 * build-api.mjs — 把本站的 content 数据镜像成**只读 JSON API**，输出到 dist/api/。
 *
 * 这是「中转站」的构建步骤：其他人（或你自己的脚本）可以像我们抓 genshin-db /
 * gachabase / lunaris 一样，直接 HTTP GET 本站聚合后的数据。
 *
 * 运行时机：`vite build` 之后（见 package.json 的 build 脚本），写入 dist/api/，
 * 随静态资源一起被 Cloudflare Worker 托管。也可单独运行 `node scripts/build-api.mjs`。
 *
 * 产物（文件名与 URL 由 worker/index.js 映射）：
 *   /api                      → dist/api/index.json        （清单：数据集 / 数量 / 许可）
 *   /api/characters           → dist/api/characters/index.json
 *   /api/characters/<名称>    → dist/api/characters/<名称>.json
 *   /api/weapons              → dist/api/weapons/index.json
 *   /api/weapons/<名称>       → dist/api/weapons/<名称>.json
 *   /api/artifacts            → dist/api/artifacts/index.json
 *   /api/artifacts/<名称>     → dist/api/artifacts/<名称>.json
 *   /api/attachment           → dist/api/attachment.json    （元素附着及产球，解析后）
 *   /api/bosses               → dist/api/bosses.json
 *   /api/formulas             → dist/api/formulas/index.json
 *   /api/formulas/<game>      → dist/api/formulas/<game>.json（genshin / sr / zzz）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const API = resolve(DIST, 'api');

const REPO = 'https://github.com/lihua123123/ellenwiki';
const NOTICE = '数据由 genshin-db、gachabase、lunaris.moe 等公开数据源整合整理，仅供学习与交流。';
const LICENSE = '游戏角色、武器、圣遗物等内容的著作权归 miHoYo 所有；本站的整合整理成果可自由取用，请注明来源。';

/* ---------- 工具 ---------- */
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const write = (rel, obj) => {
  const dest = join(API, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(obj), 'utf-8');
};
const listFiles = (dir, ext) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];

/* ---------- 入口 ---------- */
async function main() {
  if (!existsSync(DIST)) {
    console.error('❌ 未找到 dist/，请先 `vite build`（或 `npm run build`）');
    process.exit(1);
  }
  rmSync(API, { recursive: true, force: true });
  mkdirSync(API, { recursive: true });

  const counts = {};

  /* ===== 角色 ===== */
  const metaRaw = existsSync(join(ROOT, 'content/meta/characters-meta.json'))
    ? readJson(join(ROOT, 'content/meta/characters-meta.json')) : {};
  const elementOf = readElementMap();
  const charFiles = listFiles(join(ROOT, 'content/characters'), '.json');
  const charIndex = [];
  for (const file of charFiles) {
    const data = readJson(join(ROOT, 'content/characters', file));
    if (!data?.name) continue;
    write(join('characters', `${data.name}.json`), data);
    charIndex.push({
      name: data.name,
      title: data.title ?? '',
      rarity: data.rarity ?? null,
      version: data.version ?? '',
      element: elementOf.get(data.name) || '',
      weapon: metaRaw[data.name]?.weapon || '',
      energy: metaRaw[data.name]?.energy || '',
    });
  }
  charIndex.sort((a, b) => String(b.version).localeCompare(String(a.version)) || a.name.localeCompare(b.name, 'zh'));
  write(join('characters', 'index.json'), charIndex);
  counts.characters = charIndex.length;

  /* ===== 武器（列表复用 src/data 的紧凑索引） ===== */
  const weaponFiles = listFiles(join(ROOT, 'content/weapons'), '.json');
  for (const file of weaponFiles) {
    const data = readJson(join(ROOT, 'content/weapons', file));
    if (!data?.name) continue;
    write(join('weapons', `${data.name}.json`), data);
  }
  const wIndexPath = join(ROOT, 'src/data/weapons-index.json');
  const wIndex = existsSync(wIndexPath) ? readJson(wIndexPath) : [];
  write(join('weapons', 'index.json'), wIndex);
  counts.weapons = wIndex.length || weaponFiles.length;

  /* ===== 圣遗物 ===== */
  const artifactFiles = listFiles(join(ROOT, 'content/artifacts'), '.json');
  for (const file of artifactFiles) {
    const data = readJson(join(ROOT, 'content/artifacts', file));
    if (!data?.name) continue;
    write(join('artifacts', `${data.name}.json`), data);
  }
  const aIndexPath = join(ROOT, 'src/data/artifacts-index.json');
  const aIndex = existsSync(aIndexPath) ? readJson(aIndexPath) : [];
  write(join('artifacts', 'index.json'), aIndex);
  counts.artifacts = aIndex.length || artifactFiles.length;

  /* ===== 元素附着及产球（来自 parse 后的 src/data/characters.js） ===== */
  counts.attachment = await writeAttachment();

  /* ===== 幽境 Boss ===== */
  const bossPath = join(ROOT, 'src/data/bosses.json');
  if (existsSync(bossPath)) {
    const bosses = readJson(bossPath);
    write('bosses.json', bosses);
    counts.bosses = Array.isArray(bosses) ? bosses.length : Object.keys(bosses).length;
  } else counts.bosses = 0;

  /* ===== 伤害公式 ===== */
  const FORMULAS = [
    ['genshin', '原神'],
    ['sr', '星穹铁道'],
    ['zzz', '绝区零'],
  ];
  const fIndex = [];
  for (const [id, title] of FORMULAS) {
    const mdPath = join(ROOT, 'content/formulas', `${id}.md`);
    if (!existsSync(mdPath)) continue;
    write(join('formulas', `${id}.json`), { id, title, markdown: readFileSync(mdPath, 'utf-8') });
    fIndex.push({ id, title, path: `/api/formulas/${id}` });
  }
  write(join('formulas', 'index.json'), fIndex);
  counts.formulas = fIndex.length;

  /* ===== 清单 ===== */
  const manifest = {
    name: '艾莲的数据库 · 数据 API',
    apiVersion: 1,
    generatedAt: new Date().toISOString(),
    homepage: 'https://ellenwiki.lihua123123.workers.dev',
    repo: REPO,
    notice: NOTICE,
    license: LICENSE,
    datasets: {
      characters: { count: counts.characters, index: '/api/characters', item: '/api/characters/{名称}' },
      weapons: { count: counts.weapons, index: '/api/weapons', item: '/api/weapons/{名称}' },
      artifacts: { count: counts.artifacts, index: '/api/artifacts', item: '/api/artifacts/{名称}' },
      attachment: { file: '/api/attachment', desc: '元素附着及产球（逐角色技能的元素量 / 附着规则 / 产球）' },
      bosses: { file: '/api/bosses', desc: '幽境 Boss 图鉴（按版本）' },
      formulas: { index: '/api/formulas', item: '/api/formulas/{genshin|sr|zzz}', desc: '伤害计算公式（Markdown 原文）' },
    },
  };
  write('index.json', manifest);

  console.log(`✅ 已生成数据 API → dist/api/`);
  console.log(`   角色 ${counts.characters} · 武器 ${counts.weapons} · 圣遗物 ${counts.artifacts} · 公式 ${counts.formulas} · Boss ${counts.bosses}`);
}

/* ---------- 子步骤 ---------- */
async function writeAttachment() {
  const attachPath = join(ROOT, 'src/data/characters.js');
  if (!existsSync(attachPath)) return 0;
  const mod = await import(pathToFileURL(attachPath).href);
  const payload = {
    elementLabels: mod.elementLabels,
    elementIds: mod.elementIds,
    weaponTypes: mod.weaponTypes,
    characters: mod.characters,
  };
  write('attachment.json', payload);
  return Object.values(mod.characters || {}).flat().length;
}

/** 从附着/产球数据里取「角色名 → 元素中文」映射 */
function readElementMap() {
  const map = new Map();
  try {
    const text = readFileSync(join(ROOT, 'content/attachment/元素附着及产球.md'), 'utf-8');
    const EL = { 火系: '火', 水系: '水', 雷系: '雷', 冰系: '冰', 风系: '风', 岩系: '岩', 草系: '草' };
    let cur = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      const h1 = t.match(/^#\s+(.+)$/);
      if (h1) { cur = EL[h1[1]] || null; continue; }
      const h2 = t.match(/^##\s+(.+)$/);
      if (h2 && cur) {
        let name = h2[1];
        const lo = name.lastIndexOf('（');
        const lc = name.lastIndexOf('）');
        if (lo !== -1 && lc === name.length - 1 && name.slice(lo).includes('/')) name = name.slice(0, lo).trim();
        if (name && !map.has(name)) map.set(name, cur);
      }
    }
  } catch { /* 忽略 */ }
  return map;
}

main();
