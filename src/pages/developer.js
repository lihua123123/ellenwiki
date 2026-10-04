/**
 * developer.js — 「开发者 · 数据 API」文档页。
 * 说明本站对外提供的数据 API（/api/*），供其他开发者取用本站聚合后的数据。
 */
import '../styles/developer.css';

const ENDPOINTS = [
  ['GET', '/api', '清单：全部数据集、条目数量、许可与来源'],
  ['GET', '/api/characters', '角色列表（名称 / 称号 / 星级 / 实装版本 / 元素 / 武器类型 / 元素能量）'],
  ['GET', '/api/characters/{名称}', '单个角色完整数据：分级属性曲线、天赋、命座、加强文本、逸闻等'],
  ['GET', '/api/weapons', '武器列表（名称 / 类型 / 星级 / 版本 / 基础攻击 / 副属性 / 图标）'],
  ['GET', '/api/weapons/{名称}', '单把武器完整数据：逐级曲线、精炼文本、突破材料、故事'],
  ['GET', '/api/artifacts', '圣遗物套装列表（套装效果 / 部位图标与名称）'],
  ['GET', '/api/artifacts/{名称}', '单套圣遗物完整数据'],
  ['GET', '/api/attachment', '元素附着及产球：逐角色每个技能的元素量 / 附着规则 / 产球'],
  ['GET', '/api/bosses', '幽境 Boss 图鉴（按版本）'],
  ['GET', '/api/formulas', '伤害公式目录'],
  ['GET', '/api/formulas/{game}', '伤害公式 Markdown 原文（genshin / sr / zzz）'],
];

const DATASETS = [
  ['characters', '角色', '单个文件：name / title / rarity / version / description / stats（hp·attack·defense·specialized 逐级数组 + preXxx 突破值）/ talents / passives / constellations / buffs / lore 等。'],
  ['weapons', '武器', '单个文件：name / id / rarity / type / baseAtk / mainStat / mainStatValue / maxLevel / source / effectName / refinements / curve（逐级基础攻击与副属性）/ costs / story 等。'],
  ['artifacts', '圣遗物', '单个文件：name / rarity / effect1Pc / effect2Pc / effect4Pc / iconUrl / pieceIcons / pieceNames 等。'],
  ['attachment', '元素附着及产球', '以元素分组：{ elementLabels, elementIds, weaponTypes, characters: { fire: [ { name, weapon, energy, skills: [ { name, elementAmount, attachRule, particles, note, poise } ] } ] } }。elementAmount=元素量（弱/强/超强 + 元素），attachRule=附着规则（独立 / N hits / M s 等，即 ICD），particles=产球。'],
  ['bosses', '幽境 Boss', '按版本分组的数组：[ { version, bosses: [ { shortName, fullName, hp, skills[], imgUrl } ] } ]。skills 里的 __SEP__ 是「机制 / 介绍 / 背景」分组分隔符。'],
  ['formulas', '伤害公式', '单个文件：{ id, title, markdown }，markdown 为公式页的原始 Markdown（含 KaTeX 公式）。'],
];

export function initDeveloperPage(root) {
  const base = location.origin;
  const item = (m, p, d) => `<tr><td><span class="dev-method">${m}</span></td><td><code>${p}</code></td><td>${d}</td></tr>`;
  const setRow = ([id, title, desc]) => `<tr><td><code>${id}</code></td><td>${title}</td><td>${desc}</td></tr>`;

  root.innerHTML = `
    <div class="dev-page">
      <header class="page-header">
        <h1>开发者 · 数据 API</h1>
        <p class="dev-lead">
          本站把整合后的角色 / 武器 / 圣遗物 / 元素附着及产球 / 幽境 Boss / 伤害公式数据，
          以<strong>只读 JSON API</strong> 开放出来。你可以像我们抓取上游数据源一样，直接 HTTP GET 本站聚合后的结果。
        </p>
      </header>

      <section class="card dev-card">
        <h2>快速开始</h2>
        <p>接口根地址即本站域名，全部为 <code>GET</code>，<strong>无需鉴权</strong>，带 CORS 头，可直接在浏览器 / 任意语言里请求。</p>
        <pre class="dev-code"><code>// 1) 先看清单，了解有哪些数据集
const meta = await (await fetch('${base}/api')).json();
console.log(meta.datasets);

// 2) 取角色列表，再取某个角色的完整数据
const list = await (await fetch('${base}/api/characters')).json();
const hutao = await (await fetch('${base}/api/characters/' + encodeURIComponent('胡桃'))).json();

// 3) 元素附着及产球
const attach = await (await fetch('${base}/api/attachment')).json();
console.log(attach.characters.fire[0].skills);</code></pre>
        <pre class="dev-code"><code># curl
curl ${base}/api
curl ${base}/api/characters
curl "${base}/api/characters/胡桃"
curl ${base}/api/attachment
curl ${base}/api/weapons
curl ${base}/api/artifacts
curl ${base}/api/bosses
curl ${base}/api/formulas/genshin</code></pre>
      </section>

      <section class="card dev-card">
        <h2>端点一览</h2>
        <table class="dev-table">
          <thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead>
          <tbody>${ENDPOINTS.map(([m, p, d]) => item(m, p, d)).join('')}</tbody>
        </table>
        <p class="dev-note">
          <code>{名称}</code> 用中文名，URL 里请 <code>encodeURIComponent</code>（浏览器 <code>fetch</code> 会自动处理）。
          路径不存在时返回 JSON 形式的 <code>404</code>（不是页面）。
        </p>
      </section>

      <section class="card dev-card">
        <h2>数据集与字段</h2>
        <table class="dev-table">
          <thead><tr><th>数据集</th><th>名称</th><th>字段说明</th></tr></thead>
          <tbody>${DATASETS.map(setRow).join('')}</tbody>
        </table>
      </section>

      <section class="card dev-card">
        <h2>使用约定</h2>
        <ul class="dev-list">
          <li>完全开放、无需鉴权、不设限流；响应带 <code>Cache-Control: public, max-age=300</code>，请尽量本地缓存、避免高频全量拉取。</li>
          <li>数据随站点构建更新（一般是版本更新或数据修正后）。清单 <code>/api</code> 里有 <code>generatedAt</code> 可判断新鲜度。</li>
          <li>体验服（beta）条目会在数据里带 <code>"beta": true</code> 标记，正式服条目没有该字段。</li>
          <li>字段可能随数据源升级而增改；只依赖你需要的字段，并对缺失字段做兜底。</li>
        </ul>
      </section>

      <section class="card dev-card dev-license">
        <h2>数据来源与许可</h2>
        <p>数据由 <a href="https://www.npmjs.com/package/genshin-db" target="_blank" rel="noopener">genshin-db</a>、
          gachabase、<a href="https://lunaris.moe" target="_blank" rel="noopener">lunaris.moe</a> 等公开数据源整合整理，仅供学习与交流。</p>
        <p>游戏角色、武器、圣遗物等内容的著作权归米哈游（miHoYo / HoYoverse）所有。本站的<strong>整合整理成果</strong>可自由取用，请注明来源。</p>
        <p class="dev-repo">项目仓库：<a href="https://github.com/lihua123123/ellenwiki" target="_blank" rel="noopener">github.com/lihua123123/ellenwiki</a></p>
      </section>
    </div>
  `;
}
