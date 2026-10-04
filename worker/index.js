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
 *   GET /api/bosses              幽境 Boss
 *   GET /api/formulas   /formulas/<game>         伤害公式（Markdown 原文）
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
const SINGLETONS = new Set(['attachment', 'bosses']);

function mapDataPath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/api') return '/api/index.json';
  const m = p.match(/^\/api\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const kind = m[1];
  if (kind === 'enka') return null; // 交给下面的 Enka 处理
  const rest = m[2];
  if (rest === undefined) return SINGLETONS.has(kind) ? `/api/${kind}.json` : `/api/${kind}/index.json`;
  return `/api/${kind}/${rest.endsWith('.json') ? rest : `${rest}.json`}`;
}

async function serveData(target, url, env, origin) {
  const res = await env.ASSETS.fetch(new Request(new URL(target, url.origin), { method: 'GET' }));
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes('application/json')) {
    return json({ error: 'not found', path: url.pathname, hint: 'GET /api 查看可用数据集' }, 404, origin);
  }
  const headers = new Headers(cors(origin));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (url.pathname === '/api/enka') return handleEnka(request, origin);

    const target = mapDataPath(url.pathname);
    if (target) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: '数据 API 只支持 GET' }, 405, origin);
      }
      return serveData(target, url, env, origin);
    }

    return env.ASSETS.fetch(request);
  },
};
