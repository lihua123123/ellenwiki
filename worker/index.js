/**
 * worker/index.js — Cloudflare Worker：
 *   1) 静态资源托管（dist/，SPA）
 *   2) 数据 API 中转站 `/api/*`（只读转发构建生成的 dist/api/*.json，见 scripts/build-api.mjs）
 *   3) Enka.Network 只读转发 `/api/enka`
 *
 * 数据 API（面向其他开发者，完全开放、无鉴权）：
 *   GET /api                     清单（数据集 / 数量 / 许可）
 *   GET /api/characters          角色列表        GET /api/characters/胡桃      角色详情
 *   GET /api/weapons    /weapons/<名称>          weapons 列表 / 详情
 *   GET /api/artifacts  /artifacts/<名称>        artifacts 列表 / 详情
 *   GET /api/attachment          元素附着及产球（解析后）
 *   GET /api/bosses              幽境危战
 *   GET /api/formulas   /formulas/<game>         伤害公式（Markdown 原文）
 *   GET /api/launcher/manifest                   启动器元数据清单（digest + 逐文件 sha256 + zip 信息）
 *   GET /api/launcher/launcher-metadata.zip      启动器元数据整包（一次下载）
 *   GET /api/launcher/Avatar/<id>  /launcher/Weapon   启动器元数据单文件
 *   GET /api/enemies/assets-manifest.json             敌人图片清单（ellen-enemy-assets-v1，逐文件 sha256 + 缩略图 + license）
 *   均带 CORS 与缓存头；文件不存在返回 JSON 404。
 *
 * 为什么需要 Enka 转发：Enka 的公开接口 `GET https://enka.network/api/uid/<uid>` **不给浏览器发 CORS 头**
 * （实测响应里没有 access-control-allow-origin），纯静态站点只能借服务端转发。
 * 这个转发是**无状态**的：不写数据库、不写日志、不缓存任何响应；不接收也不保存任何账号信息
 * （只有 UID），不接受 Cookie；只放行一个域名的一个路径：`/api/uid/<9~10 位数字>`。
 * 客户端调用（POST，JSON body）：`{ uid: '113307013' }` → `{ status, uid, data, error? }`
 *   · 200 正常；404 查无此 UID；424 展示柜未开详情；429 Enka 限频（同一 UID 约 60 秒只能取一次）
 *
 * 部署：`npm run deploy`（wrangler 会把本文件与 dist/ 一起发上去）；本地开发用 `npm run api`。
 */

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const json = (obj, status, origin) => Response.json(obj, { status, headers: cors(origin) });

/** 状态码 → 中文提示（语义见 Enka 的 API 文档） */
const HINTS = {
  400: 'UID 格式不被 Enka 接受。',
  404: 'Enka 查不到这个 UID —— 确认 UID 没写错，且是国服（天空岛 / 世界树）或国际服账号。',
  424: '这个账号的游戏内「角色展示柜」没有开启，或详情未公开 —— 在游戏里「资料 → 编辑资料 → 角色展示柜」放上角色，并打开「显示角色详情」后重试。',
  429: 'Enka 请求太频繁（同一 UID 约 60 秒只能取一次），稍等一会儿再点获取。',
};

/* ============================ 数据 API（中转站） ============================
 * 只读转发本站构建时生成的 dist/api/*.json（见 scripts/build-api.mjs）。
 * URL → 文件映射：
 *   /api                       → /api/index.json
 *   /api/<kind>                → /api/<kind>/index.json
 *   /api/<kind>/<名称>         → /api/<kind>/<名称>.json
 *   /api/attachment|bosses     → /api/<单文件>.json
 * 完全开放（无鉴权），带 CORS 与缓存头；文件不存在时返回 JSON 404（而不是 SPA 的 index.html）。
 */
const SINGLETONS = new Set(['attachment', 'bosses', 'palette']);

function mapDataPath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/api') return '/api/index.json';
  const m = p.match(/^\/api\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const kind = m[1];
  if (kind === 'enka') return null; // 交给下面的 Enka 处理
  const rest = m[2];
  if (rest === undefined) return SINGLETONS.has(kind) ? `/api/${kind}.json` : `/api/${kind}/index.json`;
  /* 已带扩展名（.json / .zip）就原样用，否则补 .json */
  return `/api/${kind}/${/\.[a-z0-9]+$/i.test(rest) ? rest : `${rest}.json`}`;
}

const IMAGE_ASSET = /\.(png|webp|jpe?g)$/i;

/* ============================ P2-B：R2 主源（JSON 路由） ============================
 * 接线但不生效：开关默认 false，未注入 env 时本段不参与任何请求。
 * 开关由 `wrangler dev --var R2_JSON_ENABLED:true` 注入（仅本地预发）；
 * 生产不注入即 false。不写 wrangler.jsonc、不改客户端 Root/DefaultEndpoint。
 * 本轮只接 data/launcher/ 的 JSON 路由；assets/launcher/ 图片路由留到 D 阶段。
 */
const R2_JSON_PREFIX = '/api/launcher/';
const R2_JSON_KEY_PREFIX = 'data/launcher/';

function r2Flags(env) {
  const on = (v) => v === 'true' || v === true || v === 1;
  return {
    json: on(env?.R2_JSON_ENABLED),
    // 预留：图片路由在 D 阶段接线前，设为 true 也不改变任何行为。
    assets: on(env?.R2_ASSETS_ENABLED),
  };
}

function mapR2JsonKey(target) {
  if (!target || !target.startsWith(R2_JSON_PREFIX)) return null;
  const rest = target.slice(R2_JSON_PREFIX.length);
  // 图片与 supplement 走各自路由，本轮不接 R2
  if (rest.startsWith('assets/') || rest.startsWith('supplement/')) return null;
  return R2_JSON_KEY_PREFIX + rest;
}

function r2JsonCacheControl(target) {
  if (target === '/api/launcher/manifest.json') return 'no-cache, must-revalidate';
  if (target === '/api/launcher/launcher-metadata.zip') return 'public, max-age=3600';
  return 'public, max-age=86400';
}

function logFallback(rec) {
  try {
    console.log(JSON.stringify({ kind: 'r2-fallback', ts: new Date().toISOString(), ...rec }));
  } catch { /* 日志不影响响应 */ }
}

async function readR2(env, key) {
  const bucket = env?.ellen_assets;
  if (!bucket) return null;
  try {
    const obj = await bucket.get(key);
    return obj ? obj.body : null;
  } catch {
    return null;
  }
}

/* ==================== D 灰度准备：版本化布局适配（接线但不生效） ====================
 * 开关 R2_VERSIONED_ENABLED 默认 false，未注入时下面整段不参与任何请求。
 * 打开后：读桶根 latest.json -> 校验 releasePrefix -> 把 P2-B 的
 *   data/launcher/<x> 映射为 releases/<version>/data/launcher/<x>
 *   （与 P3-2 D1(a) 实际布局一致，以代码为准，不按 versioning.layout 字面猜）。
 * 回退链：pointer 缺失/非法 -> 未版本化 data/launcher/；版本对象 miss -> 同样回落；
 *   未版本化也 miss -> worker-static -> JSON 404。
 * 不改 datasets.json 的 publicRoutes.r2Key：这里只在 Worker 内部重写 R2 key。
 */
const R2_POINTER_KEY = 'latest.json';
const RELEASE_PREFIX_RE = /^releases\/[A-Za-z0-9][A-Za-z0-9._-]*\/$/;

function r2VersionedFlag(env) {
  const v = env?.R2_VERSIONED_ENABLED;
  return v === 'true' || v === true || v === 1;
}

/** 仅接受形如 releases/<version>/ 的指针前缀；其它一律 null（触发回退）。 */
function parseReleasePrefix(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const p = doc.releasePrefix;
  if (typeof p !== 'string' || !RELEASE_PREFIX_RE.test(p)) return null;
  return p;
}

/** releases/<v>/ + data/launcher/<x>（原 r2Key 原样拼接，不改写文件名）。 */
function versionedR2Key(prefix, legacyKey) {
  if (!prefix || !legacyKey) return null;
  return prefix + legacyKey;
}

async function readR2Pointer(env) {
  const bucket = env?.ellen_assets;
  if (!bucket) return null;
  try {
    const obj = await bucket.get(R2_POINTER_KEY);
    if (!obj) return null;
    return parseReleasePrefix(await obj.json());
  } catch {
    return null;
  }
}

/* ============================ Launcher 图标托管 ============================
 * 启动器的角色 / 武器 / 物品图标统一走本站：
 *   GET /api/launcher/assets/<category>/<file>.png
 * 优先级：构建期镜像（dist 里有就直接发）→ 边缘缓存 → 回源。
 * 回源顺序按「谁更新、谁更全」排：
 *   1. api.hutaorp.org   Snap 备用域，实测比主域新（新物品只有它有）
 *   2. api.snaphutaorp.org Snap 主域
 *   3. enka.network/ui   命名与游戏资源名一致，新角色天赋/技能图最全
 *   4. gi.yatta.moe      Project Amber，补 enka 还没收录的新物品
 * 这样源站缺图（米提亚 / 瓦列里）时启动器不会出现空白图标，也不必等上游补齐。
 */
const LAUNCHER_ASSET_PATH = /^\/api\/launcher\/assets\/([A-Za-z]+)\/([^/]+\.png)$/;
const LAUNCHER_ASSET_UPSTREAMS = [
  (c, f) => `https://api.hutaorp.org/static/raw/${c}/${f}`,
  (c, f) => `https://api.snaphutaorp.org/static/raw/${c}/${f}`,
  (c, f) => `https://enka.network/ui/${f}`,
  (c, f) => `https://gi.yatta.moe/assets/UI/${f}`,
];
/* 图标内容由资源名决定、随版本只增不改，可以放心长缓存 */
const ASSET_CACHE_CONTROL = 'public, max-age=604800, s-maxage=2592000, immutable';

function assetHeaders(origin, contentType, source) {
  const headers = new Headers(cors(origin));
  headers.set('Content-Type', contentType || 'image/png');
  headers.set('Cache-Control', ASSET_CACHE_CONTROL);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Ellen-Asset', source);
  return headers;
}

async function serveLauncherAsset(category, file, request, url, env, origin, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: '图标只支持 GET' }, 405, origin);
  }

  /* 1. 构建期镜像进 dist 的那批（最近版本的角色/武器） */
  const localTarget = new URL(url.pathname, url.origin);
  const local = await env.ASSETS.fetch(new Request(localTarget, { method: 'GET' }));
  const localType = local.headers.get('content-type') || '';
  if (local.ok && (localType.startsWith('image/') || localType.includes('octet-stream'))) {
    return new Response(local.body, {
      status: 200,
      headers: assetHeaders(origin, localType.startsWith('image/') ? localType : 'image/png', 'mirror'),
    });
  }

  /* 2. 边缘缓存（不带 CORS，避免跨来源污染；命中后再补头） */
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: assetHeaders(origin, cached.headers.get('content-type') || 'image/png', 'edge'),
    });
  }

  /* 3. 回源 */
  for (const build of LAUNCHER_ASSET_UPSTREAMS) {
    try {
      const res = await fetch(build(category, file), {
        headers: { Accept: 'image/png,image/*;q=0.8' },
        cf: { cacheTtl: 86400 },
      });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;

      const storable = new Response(res.body, {
        status: 200,
        headers: { 'Content-Type': ct, 'Cache-Control': ASSET_CACHE_CONTROL },
      });
      if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, storable.clone()));
      return new Response(storable.body, { status: 200, headers: assetHeaders(origin, ct, 'upstream') });
    } catch {
      /* 换下一个源 */
    }
  }

  return json({ error: 'not found', path: url.pathname, hint: '图标源暂未收录该资源' }, 404, origin);
}


async function serveData(target, url, env, origin) {
  /* P2-B：开关打开时优先从 R2 读 data/launcher/；miss 继续原 worker-static 路径 */
  const flags = r2Flags(env);
  const r2Key = flags.json ? mapR2JsonKey(target) : null;
  /* D 灰度准备：版本化开关打开时先试 releases/<v>/<原 key>；命中即返回
     （等价于 P2-B 命中，响应头一致）；pointer / 版本对象 miss 均回落到
     下方 P2-B 未版本化前缀。开关 false 时整段零额外 R2 读取，行为逐字节不变。 */
  if (r2Key && r2VersionedFlag(env)) {
    const prefix = await readR2Pointer(env);
    if (prefix) {
      const vKey = versionedR2Key(prefix, r2Key);
      const vBody = vKey ? await readR2(env, vKey) : null;
      if (vBody) {
        const headers = new Headers(cors(origin));
        headers.set('Content-Type', target.endsWith('.zip')
          ? 'application/zip' : 'application/json; charset=utf-8');
        headers.set('Cache-Control', r2JsonCacheControl(target));
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-Ellen-Asset', 'r2');
        return new Response(vBody, { status: 200, headers });
      }
      logFallback({ route: url.pathname, r2Key: vKey, source: 'r2-versioned-miss', next: 'r2-legacy' });
    } else {
      logFallback({ route: url.pathname, source: 'pointer-miss', next: 'r2-legacy' });
    }
  }
  if (r2Key) {
    const body = await readR2(env, r2Key);
    if (body) {
      const headers = new Headers(cors(origin));
      // 不信任 R2 httpMetadata：A 上传时 JSON 存的是 application/json（无 charset），
      // 这里显式规范化，保持与 serveData 原契约一致。
      headers.set('Content-Type', target.endsWith('.zip')
        ? 'application/zip' : 'application/json; charset=utf-8');
      headers.set('Cache-Control', r2JsonCacheControl(target));
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Ellen-Asset', 'r2');
      return new Response(body, { status: 200, headers });
    }
    logFallback({ route: url.pathname, r2Key, source: 'r2-miss', next: 'worker-static' });
  }

  const res = await env.ASSETS.fetch(new Request(new URL(target, url.origin), { method: 'GET' }));
  const ct = res.headers.get('content-type') || '';
  /* 数据 API 以 JSON 为主，例外只有两个：Launcher 的整包 zip、Launcher 的图标镜像 */
  const isZip = target.endsWith('.zip');
  const isImage = IMAGE_ASSET.test(target);
  const typeOk = isZip
    ? ct.includes('zip') || ct.includes('octet-stream')
    : isImage
      ? ct.startsWith('image/') || ct.includes('octet-stream')
      : ct.includes('application/json');
  if (!res.ok || !typeOk) {
    return json({ error: 'not found', path: url.pathname, hint: 'GET /api 查看可用数据集' }, 404, origin);
  }
  const headers = new Headers(cors(origin));
  headers.set('Content-Type', isZip ? 'application/zip' : isImage ? (ct || 'image/png') : 'application/json; charset=utf-8');
  /* 图标内容随游戏版本变化，文件名即资源名，可以放心长缓存 */
  headers.set('Cache-Control', isImage
    ? 'public, max-age=604800, s-maxage=2592000, immutable'
    : 'public, max-age=300, s-maxage=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: 200, headers });
}

/* ============================ Enka.Network 转发 ============================ */
async function handleEnka(request, origin) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: '只支持 POST' }, 405, origin);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'body 必须是 JSON' }, 400, origin);
  }

  const uid = String(payload?.uid || '').trim();
  if (!/^\d{9,10}$/.test(uid)) return json({ error: 'uid 必须是 9~10 位数字' }, 400, origin);

  let res;
  let text;
  try {
    res = await fetch(`https://enka.network/api/uid/${uid}`, {
      headers: {
        Accept: 'application/json',
        /* Enka 要求带一个能识别来源的 UA */
        'User-Agent': 'ellen-wiki/1.0 (+https://github.com/lihua123123/ellenwiki)',
      },
    });
    text = await res.text();
  } catch (err) {
    return json({ error: `连接 Enka 失败：${err.message}` }, 502, origin);
  }

  let data = null;
  let raw;
  try {
    data = JSON.parse(text);
  } catch {
    raw = text.slice(0, 300);
  }

  return json({
    status: res.status,
    uid,
    data,
    raw,
    error: res.ok ? undefined : (HINTS[res.status] || `Enka 返回 ${res.status}`),
  }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (url.pathname === '/api/enka') return handleEnka(request, origin);

    /* 启动器图标：先镜像、再边缘缓存、最后回源 */
    const asset = url.pathname.match(LAUNCHER_ASSET_PATH);
    if (asset) {
      return serveLauncherAsset(asset[1], decodeURIComponent(asset[2]), request, url, env, origin, ctx);
    }

    const target = mapDataPath(url.pathname);
    if (target) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: '数据 API 只支持 GET' }, 405, origin);
      }
      return serveData(target, url, env, origin);
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    if (url.pathname.startsWith('/assets/')) {
      // 文件名带 hash，内容不可变 → 可长缓存，提升回访速度、降边缘回源
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      // SPA 入口：短缓存，保证发版后及时生效
      headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
    }
    return new Response(res.body, { status: res.status, headers });
  },
};
