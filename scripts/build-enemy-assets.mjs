/**
 * build-enemy-assets.mjs — 生成敌人图鉴的正式图片清单（A4）。
 *
 * 产出（默认 build/enemy-assets/ + build/enemy-thumbs/）：
 *   assets-manifest.json   契约 `ellen-enemy-assets-v1`：逐文件 size + sha256，可选 thumb，根级 license
 *   report.json            本次生成的统计与自检结果（体积 / P95 / orphan / 许可状态）
 *   ../enemy-thumbs/<id>/thumb-<stem>.webp   256px 缩略图（仅体积可观的图才生成）
 *
 * 与 `build-assets-manifest.mjs`（迁移工作区里的等价物）的区别：
 *   这里是**上游正式产物**——带 license 块、带 thumb 段、带自检退出码，并由 build-api.mjs
 *   镜像到 dist/api/enemies/assets-manifest.json 对外提供。迁移工作区那份只用于客户端联调。
 *
 * 关键约束（P4 需求单 A4）：
 *   · 只收录 753 条 item 真实引用到的 id/file；orphan 不进清单、不进缓存；
 *   · 每条 64 位 sha256；缺文件是**硬失败**（不是告警），否则客户端拿到 404 清单；
 *   · 缩略图总体积 ≤100 MiB（B 方案验收线），超了直接失败；
 *   · license.redistributable 由 scripts/seed/enemy-assets-license.json 决定，默认 false。
 *     未授予许可时清单照常生成（客户端在线 + 缓存可用），但图片不得随包。
 *
 * 像素活交给 Pillow（scripts/lib/enemy-thumbs.py）：仓库不引原生依赖，Windows 自带 libwebp。
 * 缺 Pillow 是硬失败，不静默跳过缩略图。
 *
 * 用法：
 *   node scripts/build-enemy-assets.mjs
 *   node scripts/build-enemy-assets.mjs --no-thumbs            # 只要清单，不生成缩略图
 *   node scripts/build-enemy-assets.mjs --force-thumbs         # 忽略缓存重算
 *   node scripts/build-enemy-assets.mjs --redistributable=true --approved-by=ellen   # 演练，不作为入库凭据
 *   node scripts/build-enemy-assets.mjs --report-dir=../workspace/wiki-migration/reports
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const ITEMS = join(ROOT, 'src/data/enemies/items');
const IMAGES = join(ROOT, 'public/images/enemies');
const OUT = resolve(ROOT, arg('out', 'build/enemy-assets'));
const THUMB_DIR = resolve(ROOT, arg('thumbs', 'build/enemy-thumbs'));
const REPORT_DIR = arg('report-dir', '') ? resolve(ROOT, arg('report-dir')) : '';
const LICENSE_SEED = join(ROOT, 'scripts/seed/enemy-assets-license.json');
const THUMB_SCRIPT = join(ROOT, 'scripts/lib/enemy-thumbs.py');

/* 缩略图规格：单一来源，改这里就改了清单里的声明与实际产物 */
const THUMB_WIDTH = Number(arg('thumb-width', '256')) || 256;
const THUMB_QUALITY = Number(arg('thumb-quality', '80')) || 80;
/* 源文件已经比这个还小、且宽度不超过 THUMB_WIDTH 时不出缩略图：
   753 张头像都是 128px / 7KB 级别，再编码一遍只掉画质不掉体积。 */
const THUMB_MIN_BYTES = Number(arg('thumb-min-bytes', '32768')) || 32768;
const MAX_THUMB_MIB = Number(arg('max-thumb-mib', '100')) || 100;
const SCHEMA = 'ellen-enemy-assets-v1';
const NO_THUMBS = flag('no-thumbs');
const FORCE_THUMBS = flag('force-thumbs');
const THREADS = Number(arg('threads', '4')) || 4;
const CACHE_PATH = join(OUT, '.assets-cache.json');

const IMAGE_EXT = /\.(webp|png|jpe?g)$/i;

if (!existsSync(ITEMS) || !existsSync(IMAGES)) {
  console.error(`缺少输入：${ITEMS} 或 ${IMAGES}`);
  process.exit(2);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

/* ===================== 1. 引用白名单（753 条 item） ===================== */

/** @type {Map<string, {id: string, file: string}>} */
const allowed = new Map();
for (const f of readdirSync(ITEMS).filter((x) => x.endsWith('.json'))) {
  const id = f.slice(0, -5);
  const dto = JSON.parse(readFileSync(join(ITEMS, f), 'utf-8'));
  const add = (file) => {
    if (typeof file === 'string' && file.trim()) allowed.set(`${id}/${file}`, { id, file: file.trim() });
  };
  add(dto.icon);
  for (const x of dto.images ?? []) add(x);
  for (const x of dto.leylineImages ?? []) add(x);
  for (const s of dto.skills ?? []) add(s?.icon);
  add(dto.leyline?.portrait);
  // 多阶段：每个 state 自己的头像与技能图标（state-p2-avatar / state-p2-skill-N）
  for (const st of dto.states ?? []) {
    add(st?.icon);
    for (const s of st?.skills ?? []) add(s?.icon);
  }
}

/* ===================== 2. 磁盘镜像（含 orphan 统计） ===================== */

const onDisk = [];
for (const id of readdirSync(IMAGES)) {
  const dir = join(IMAGES, id);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    const path = join(dir, file);
    if (!statSync(path).isFile()) continue;
    onDisk.push({ id, file, path, size: statSync(path).size });
  }
}
const diskByKey = new Map(onDisk.map((f) => [`${f.id}/${f.file}`, f]));
const orphans = onDisk.filter((f) => !allowed.has(`${f.id}/${f.file}`));
const missing = [...allowed.keys()].filter((k) => !diskByKey.has(k));

/* ===================== 3. 缓存（size+mtime 命中即复用 sha 与尺寸结论） ===================== */

let cache = {};
try {
  cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) || {};
} catch {
  cache = {};
}
const cacheHit = (key, st) => {
  const c = cache[key];
  return c && c.size === st.size && Math.abs(c.mtimeMs - st.mtimeMs) < 1 ? c : null;
};

/* ===================== 4. 逐文件 size + sha256，并收集缩略图任务 ===================== */

const files = [];
const jobs = [];
const stale = [];
const byKey = [...allowed.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

for (const [key, { id, file }] of byKey) {
  const disk = diskByKey.get(key);
  if (!disk) continue; // 缺失在自检里硬失败，这里不造条目
  const st = statSync(disk.path);
  const hit = cacheHit(key, st);

  let digest = hit?.sha256;
  if (!digest) {
    digest = sha256(readFileSync(disk.path));
  }

  const stem = file.replace(/\.[^.]+$/, '');
  const thumbFile = `thumb-${stem}.webp`;
  const thumbAbs = join(THUMB_DIR, id, thumbFile);
  const entry = { id, file, size: st.size, sha256: digest };

  if (!NO_THUMBS && IMAGE_EXT.test(file)) {
    const thumbOk = hit?.thumb
      && hit.thumb.file === thumbFile
      && existsSync(thumbAbs)
      && statSync(thumbAbs).size === hit.thumb.size
      && !FORCE_THUMBS;
    if (thumbOk) {
      entry.thumb = { ...hit.thumb, url: `/images/enemies/_thumbs/${id}/${thumbFile}` };
      cache[key] = { ...hit, size: st.size, mtimeMs: st.mtimeMs };
    } else if (hit && hit.noThumb && !FORCE_THUMBS) {
      // 已判定「原图即缩略尺寸」，跳过且不重复问 Pillow
      entry._noThumb = true;
    } else {
      jobs.push({ key, id, file, stem, thumbFile, thumbAbs, src: disk.path, size: st.size, mtimeMs: st.mtimeMs, digest });
    }
  }

  files.push(entry);
}

/* ===================== 5. 缩略图（Pillow） ===================== */

function resolvePython() {
  const candidates = [];
  if (process.env.ELLEN_PYTHON) candidates.push([process.env.ELLEN_PYTHON]);
  candidates.push(['py', '-3'], ['python3'], ['python']);
  const probe = 'import PIL, PIL.features, sys; sys.exit(0 if PIL.features.check("webp") else 1)';
  for (const c of candidates) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', probe], { encoding: 'utf-8', timeout: 30_000 });
    if (r.status === 0) return c;
  }
  return null;
}

let thumbStats = { generated: 0, skipped: 0, reused: 0, failed: 0, errors: [] };
if (jobs.length) {
  const python = resolvePython();
  if (!python) {
    console.error(
      '无法生成缩略图：找不到带 Pillow + WebP 支持的 Python。\n'
      + '  修法一：py -3 -m pip install Pillow\n'
      + '  修法二：设置 ELLEN_PYTHON 指向可用解释器\n'
      + '  只想先出清单：加 --no-thumbs（清单会缺少 thumb 段，B 方案不算验收）',
    );
    process.exit(3);
  }

  const payload = {
    threads: THREADS,
    jobs: jobs.map((j) => ({
      src: j.src,
      dest: j.thumbAbs,
      width: THUMB_WIDTH,
      quality: THUMB_QUALITY,
      minBytes: THUMB_MIN_BYTES,
    })),
  };
  const started = Date.now();
  const proc = spawnSync(python[0], [...python.slice(1), THUMB_SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  if (proc.error || proc.status !== 0) {
    const err = proc.stderr?.trim() || proc.error?.message || `退出码 ${proc.status}`;
    console.error(`缩略图管线失败：${err}`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = JSON.parse(proc.stdout);
  } catch {
    console.error(`缩略图管线输出无法解析：${String(proc.stdout).slice(0, 400)}`);
    process.exit(3);
  }

  const resultBySrc = new Map(parsed.results.map((r) => [r.src, r]));
  const entryByKey = new Map(files.map((f) => [`${f.id}/${f.file}`, f]));
  for (const job of jobs) {
    const r = resultBySrc.get(job.src);
    if (!r) {
      thumbStats.failed++;
      thumbStats.errors.push(`${job.id}/${job.file}: 管线未返回结果`);
      continue;
    }
    const entry = entryByKey.get(job.key);
    if (r.skipped) {
      thumbStats.skipped++;
      if (entry) entry._noThumb = true;
      cache[job.key] = {
        size: job.size, mtimeMs: job.mtimeMs, sha256: job.digest,
        srcWidth: r.srcWidth, srcHeight: r.srcHeight, noThumb: true,
      };
      continue;
    }
    const buf = readFileSync(job.thumbAbs);
    const thumb = {
      file: job.thumbFile,
      url: `/images/enemies/_thumbs/${job.id}/${job.thumbFile}`,
      width: r.width,
      height: r.height,
      format: 'webp',
      size: buf.length,
      sha256: sha256(buf),
    };
    if (entry) {
      delete entry._noThumb;
      entry.thumb = thumb;
    }
    thumbStats.generated++;
    cache[job.key] = {
      size: job.size, mtimeMs: job.mtimeMs, sha256: job.digest,
      srcWidth: r.srcWidth, srcHeight: r.srcHeight, thumb: {
        file: thumb.file, width: thumb.width, height: thumb.height, size: thumb.size, sha256: thumb.sha256,
      },
    };
  }
  thumbStats.elapsedMs = Date.now() - started;
  if (parsed.errors?.length) {
    thumbStats.failed += parsed.errors.length;
    thumbStats.errors.push(...parsed.errors.map((e) => `${relative(IMAGES, e.src)}: ${e.error}`));
  }
  console.log(`   缩略图：新生成 ${thumbStats.generated} · 判定无需 ${thumbStats.skipped} · 失败 ${thumbStats.failed}（${thumbStats.elapsedMs} ms）`);
} else if (NO_THUMBS) {
  console.log('   缩略图：--no-thumbs，跳过（清单不含 thumb 段，B 方案不算验收）');
} else {
  console.log('   缩略图：全部命中缓存');
}

/* 清理内部标记，按契约只留声明的字段 */
for (const f of files) delete f._noThumb;

/* 只保留仍在清单里的缓存条目，避免缓存随历史无限增长。
   --no-thumbs 时不写缓存：那一轮没有缩略图结论，写回去会把已有 thumb 缓存清空，
   下次全量跑要白重算 759 张。 */
if (!NO_THUMBS) {
  const liveKeys = new Set(files.map((f) => `${f.id}/${f.file}`));
  for (const k of Object.keys(cache)) if (!liveKeys.has(k)) delete cache[k];
  mkdirSync(OUT, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8');
}

/* ===================== 6. 许可块 ===================== */

const seed = existsSync(LICENSE_SEED) ? JSON.parse(readFileSync(LICENSE_SEED, 'utf-8')) : {};
/* 兼容两种种子写法：扁平（name/attribution 在顶层）与嵌套（license.name/attribution）。
   嵌套写法把「授权状态」和「对外文案」分开，评审时一眼能看出哪个是元数据、哪个要展示。 */
const seedLicense = seed.license ?? seed;
const cliRedistributable = arg('redistributable', '');
const cliApprover = arg('approved-by', '');
const redistributable = cliRedistributable === '' ? !!seed.redistributable : cliRedistributable === 'true';
const license = {
  name: seedLicense.name || 'ellen.wiki 敌人图鉴素材',
  url: seedLicense.url ?? null,
  redistributable,
  attribution: seedLicense.attribution || '',
  approvedBy: cliApprover || seed.approvedBy || null,
  approvedAt: seed.approvedAt || null,
  /* approvalSource 必须能指回证据（docs/license/…）；没写就只能记成 license-seed，
     自检会拦下「说可以再分发但拿不出依据」的组合。CLI 覆盖单独标记，方便评审区分演练。 */
  approvalSource: cliRedistributable === '' ? (seed.approvalSource || 'license-seed') : 'cli-override',
  approvalBasis: seed.approvalBasis ?? null,
};

/* ===================== 7. 清单 + 报告 ===================== */

const thumbFiles = files.filter((f) => f.thumb);
const thumbBytes = thumbFiles.reduce((s, f) => s + f.thumb.size, 0);
const thumbSizes = thumbFiles.map((f) => f.thumb.size).sort((a, b) => a - b);
const totalBytes = files.reduce((s, f) => s + f.size, 0);

/* 离线成本 = 缩略图（有就代替原图）+ 无缩略图的原图。B 方案实际要随包的就是这个数。 */
const offlineBytes = files.reduce((s, f) => s + (f.thumb ? f.thumb.size : f.size), 0);

const manifest = {
  schema: SCHEMA,
  generatedAt: new Date().toISOString(),
  source: 'ellen-wiki/public/images/enemies',
  note: 'ellen.wiki 敌人图鉴图片清单。missing thumb 表示原图本身已是缩略尺寸，客户端直接用 file。',
  license,
  count: files.length,
  bytes: totalBytes,
  thumbs: {
    width: THUMB_WIDTH,
    quality: THUMB_QUALITY,
    format: 'webp',
    minSourceBytes: THUMB_MIN_BYTES,
    base: '/images/enemies/_thumbs',
    count: thumbFiles.length,
    bytes: thumbBytes,
    p95Bytes: pct(thumbSizes, 0.95),
    policy: '源图宽度 > width 或体积 > minSourceBytes 才出缩略图；其余原图即缩略图',
  },
  files,
};

/* 内容摘要：只覆盖**会变内容**的部分（不含 generatedAt），用于
   ① 客户端判断「这份清单是否换过」；② 内容没变时保持 generatedAt 不变，
   让重建产物逐字节一致（否则每次构建 sha 都变，缓存与对账全部失效）。 */
const digest = sha256(JSON.stringify({ license: manifest.license, thumbs: manifest.thumbs, files: manifest.files }));
manifest.digest = digest;

const manifestPath = join(OUT, 'assets-manifest.json');
if (existsSync(manifestPath)) {
  try {
    const prev = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (prev.digest === digest && prev.generatedAt) manifest.generatedAt = prev.generatedAt;
  } catch {
    /* 旧文件坏了就重写，不影响正确性 */
  }
}

/* ===================== 8. 自检 ===================== */

const problems = [];
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok, detail });
  if (!ok) problems.push(`${id}: ${detail}`);
};

check('items.allowedRefs', allowed.size > 0, `753 条 item 共 ${allowed.size} 个引用`);
check('files.missingOnDisk', missing.length === 0,
  missing.length ? `${missing.length} 个引用在磁盘缺失，样例 ${missing.slice(0, 5).join(', ')}` : '引用全部存在');
check('manifest.count', manifest.count === files.length, `${manifest.count} = files[] ${files.length}`);
check('manifest.sha', files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)), '每条 sha256 均为 64 位十六进制');
check('manifest.coverage', files.length === allowed.size - missing.length,
  `${files.length} 条覆盖 ${allowed.size} 个引用（缺 ${missing.length}）`);
check('manifest.orphans', files.every((f) => allowed.has(`${f.id}/${f.file}`)),
  `orphan ${orphans.length} 个已排除在清单外`);

if (!NO_THUMBS) {
  const declared = thumbFiles.length;
  const badThumb = [];
  for (const f of thumbFiles) {
    const abs = join(THUMB_DIR, f.id, f.thumb.file);
    if (!existsSync(abs)) { badThumb.push(`${f.id}/${f.thumb.file} 不存在`); continue; }
    const buf = readFileSync(abs);
    if (buf.length !== f.thumb.size) badThumb.push(`${f.id}/${f.thumb.file} size 不符`);
    else if (sha256(buf) !== f.thumb.sha256) badThumb.push(`${f.id}/${f.thumb.file} sha 不符`);
  }
  check('thumbs.integrity', badThumb.length === 0,
    badThumb.length ? `${badThumb.length} 张校验失败，样例 ${badThumb.slice(0, 3).join('; ')}` : `${declared} 张全部落盘且 sha 一致`);
  check('thumbs.budget', thumbBytes <= MAX_THUMB_MIB * 1024 * 1024,
    `缩略图 ${mb(thumbBytes)} / 上限 ${MAX_THUMB_MIB} MiB，P95 ${(pct(thumbSizes, 0.95) / 1024).toFixed(1)} KiB`);
  check('thumbs.coverage', thumbStats.failed === 0,
    thumbStats.failed ? `${thumbStats.failed} 张生成失败：${thumbStats.errors.slice(0, 3).join(' | ')}` : '无失败');
}
check('license.block', typeof license.redistributable === 'boolean',
  `redistributable=${license.redistributable}（${license.approvalSource}）`);
/* 「可以再分发」必须有授权人和可追溯依据：只有布尔值、拿不出来源的，一律当成未授权。 */
check('license.approval',
  !license.redistributable
  || (!!license.approvedBy && license.approvalSource !== 'license-seed' && license.approvalSource !== 'cli-override'),
  license.redistributable
    ? `redistributable=true：approvedBy=${license.approvedBy ?? '(缺)'}、approvalSource=${license.approvalSource}`
    : 'redistributable=false：不随包，只在线 + 按需缓存（合法状态，不是错误）');

const hardFailed = checks.some((c) => !c.ok);

if (!hardFailed) {
  mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify(manifest, null, 2);
  writeFileSync(join(OUT, 'assets-manifest.json'), body, 'utf-8');
}

const report = {
  generatedAt: manifest.generatedAt,
  schema: SCHEMA,
  digest,
  generator: 'ellen-wiki/scripts/build-enemy-assets.mjs',
  ok: !hardFailed,
  checks,
  counts: {
    items: readdirSync(ITEMS).filter((x) => x.endsWith('.json')).length,
    allowedRefs: allowed.size,
    manifestEntries: files.length,
    filesOnDisk: onDisk.length,
    orphans: orphans.length,
    thumbs: thumbFiles.length,
    thumbsSkipped: files.length - thumbFiles.length,
  },
  sizes: {
    originalsBytes: totalBytes,
    originalsMiB: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
    thumbsBytes: thumbBytes,
    thumbsMiB: Math.round((thumbBytes / 1024 / 1024) * 100) / 100,
    thumbP95Bytes: pct(thumbSizes, 0.95),
    offlineBytes,
    offlineMiB: Math.round((offlineBytes / 1024 / 1024) * 10) / 10,
    budgetMiB: MAX_THUMB_MIB,
  },
  thumbs: { width: THUMB_WIDTH, quality: THUMB_QUALITY, minSourceBytes: THUMB_MIN_BYTES, ...thumbStats },
  license,
  orphanSamples: orphans.slice(0, 10).map((f) => `${f.id}/${f.file}`),
  missingSamples: missing.slice(0, 10),
  manifestSha256: hardFailed ? null : sha256(readFileSync(join(OUT, 'assets-manifest.json'))),
};

if (REPORT_DIR) {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'enemy-assets-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  writeFileSync(join(REPORT_DIR, 'enemy-assets-report.json'), JSON.stringify(report, null, 2), 'utf-8');
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf-8');

/* ===================== 9. 输出 ===================== */

console.log(`\n=== 敌人图鉴 assets（${SCHEMA}）===`);
console.log(`   item 引用 ${allowed.size} · 磁盘 ${onDisk.length} · orphan ${orphans.length}（不进清单）· 缺失 ${missing.length}`);
console.log(`   清单 ${files.length} 条 / ${mb(totalBytes)}；缩略图 ${thumbFiles.length} 张 / ${mb(thumbBytes)}`
  + `（P95 ${(pct(thumbSizes, 0.95) / 1024).toFixed(1)} KiB）`);
console.log(`   离线成本（缩略图优先）${mb(offlineBytes)} / 预算 ${MAX_THUMB_MIB} MiB`);
console.log(`   许可 redistributable=${license.redistributable}（${license.approvalSource}）`
  + `${license.redistributable
    ? ` · approvedBy=${license.approvedBy ?? '未署名'} · 图片可随包`
    : ' → 客户端不得随包，只能在线 + 缓存'}`);
if (hardFailed) {
  console.log(`\n❌ 自检失败 ${problems.length}:`);
  for (const p of problems) console.log(`   · ${p}`);
  process.exitCode = 1;
} else {
  console.log(`   ✅ 自检通过 → ${relative(ROOT, join(OUT, 'assets-manifest.json'))} sha256 ${report.manifestSha256.slice(0, 16)}…`);
}
