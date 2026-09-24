/**
 * worker/index.js — Cloudflare Worker：静态资源 + Enka.Network 只读转发（`/api/enka`）。
 *
 * 为什么需要它：Enka 的公开接口 `GET https://enka.network/api/uid/<uid>` **不给浏览器发 CORS 头**
 * （实测响应里没有 access-control-allow-origin），纯静态站点只能借服务端转发。
 *
 * 这个 Worker 做**无状态转发**：
 *   · 不写数据库、不写日志、不缓存任何响应
 *   · 不接收也不保存任何账号信息（只有 UID），不接受 Cookie
 *   · 只放行一个域名的一个路径：`/api/uid/<9~10 位数字>`
 *
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/enka') return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
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
  },
};
