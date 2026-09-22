/**
 * artifacts.js — 圣遗物图鉴模块。
 *
 * 路由：
 *   #/artifacts          列表（图标墙：稀有度筛选 + 名称搜索，悬停显示套装效果）
 *   #/artifacts/:name    详情（套装效果 + 五个部位的介绍与故事）
 *
 * 数据源：
 *   src/data/artifacts-index.json    列表用轻量索引（脚本生成）
 *   content/artifacts/<名称>.json    详情用完整资料（按需懒加载）
 *   content/artifacts/images/*.png   本地图标（可选，缺失时回落到官方 CDN）
 */
import '../styles/artifacts.css';
import { renderRichText, highlightNumbers } from '../core/richtext.js';
import index from '../data/artifacts-index.json';

/* 完整资料：非 eager，切到详情页时才加载对应文件 */
const DETAIL_LOADERS = import.meta.glob('../../content/artifacts/*.json');

/* 本地图标（跑了 `generate-artifacts.mjs --icons` 才有内容） */
const LOCAL_ICONS = import.meta.glob('../../content/artifacts/images/*.png', {
  eager: true, query: '?url', import: 'default',
});
const LOCAL_ICON_MAP = {};
for (const [path, url] of Object.entries(LOCAL_ICONS)) {
  LOCAL_ICON_MAP[decodeURIComponent(path.split('/').pop())] = url;
}

const RARITY_COLOR = { 5: '#e0a63c', 4: '#a06cd5', 3: '#4a8ad6', 2: '#4caf7d', 1: '#8b98a8' };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const iconSrc = (item) => LOCAL_ICON_MAP[item?.icon] || item?.iconUrl || '';

function artifactIconHtml(item, cls = 'artifact-icon') {
  const src = iconSrc(item);
  return src
    ? `<img class="${cls}" src="${src}" alt="${escapeHtml(item.name)}" loading="lazy" />`
    : `<span class="${cls} artifact-icon-missing">🏵️</span>`;
}

const topRarity = (list) => (list && list.length ? Math.max(...list) : 4);
const rarityColor = (list) => RARITY_COLOR[topRarity(list)] || RARITY_COLOR[4];

const starsHtml = (rarityList) => {
  const top = topRarity(rarityList);
  return `<span class="rarity-stars" aria-label="${top} 星">${
    Array.from({ length: top }, () => '<span class="star">★</span>').join('')
  }</span>`;
};

/* 套装效果统一走富文本 + 数值高亮 */
const effectHtml = (text) => highlightNumbers(renderRichText(text));

/* 套装效果条目：1 件套（仅个别套装）/ 2 件套 / 4 件套 */
function effectList(set) {
  const rows = [
    ['1 件套', set.effect1Pc],
    ['2 件套', set.effect2Pc],
    ['4 件套', set.effect4Pc],
  ].filter(([, text]) => text);
  return rows.map(([tag, text]) => ({ tag, html: effectHtml(text) }));
}

/* ============ 列表页 ============ */
function renderList(root) {
  const all = index;
  const rarities = [...new Set(all.flatMap(a => a.rarity || []))].sort((a, b) => b - a);

  root.innerHTML = `
    <header class="page-header">
      <h1>圣遗物图鉴</h1>
      <p class="page-subtitle">共 ${all.length} 套圣遗物 · 点击查看各部位介绍与故事</p>
    </header>

    <div class="filter-bar" id="artifact-filter">
      <div class="filter-row" role="group" aria-label="按稀有度筛选（可多选，不选为全部）">
        ${rarities.map(r => `
          <button class="fbtn rarity-btn" data-rarity="${r}" title="最高 ${r} 星" style="--el-color:${RARITY_COLOR[r] || RARITY_COLOR[4]}">
            <span style="--rarity-color:${RARITY_COLOR[r] || RARITY_COLOR[4]}">${r}★</span>
          </button>`).join('')}
      </div>
      <input type="search" id="artifact-search" placeholder="搜索圣遗物名称…" aria-label="搜索圣遗物名称" />
    </div>

    <div class="artifact-grid" id="artifact-grid"></div>
    <p class="empty-hint" id="artifact-empty" hidden>没有符合条件的圣遗物</p>
  `;

  const grid = root.querySelector('#artifact-grid');
  const emptyHint = root.querySelector('#artifact-empty');
  const selRarities = new Set();
  let keyword = '';

  function applyFilter() {
    const list = all.filter(a =>
      (!selRarities.size || (a.rarity || []).some(r => selRarities.has(r))) &&
      (!keyword || a.name.includes(keyword))
    );

    grid.innerHTML = list.map(a => `
      <a class="artifact-card" href="#/artifacts/${encodeURIComponent(a.slug)}"
         style="--rarity-color:${rarityColor(a.rarity)}">
        <span class="artifact-thumb">${artifactIconHtml(a, 'artifact-icon')}</span>
        <span class="artifact-card-body">
          <span class="artifact-card-head">
            <span class="artifact-card-name">${escapeHtml(a.name)}</span>
            ${starsHtml(a.rarity)}
          </span>
          ${effectList(a).map(({ tag, html }) => `
            <span class="artifact-effect"><span class="pc-tag">${tag}</span><span class="artifact-effect-text">${html}</span></span>`).join('')}
        </span>
      </a>`).join('');

    emptyHint.hidden = list.length > 0;
  }

  root.querySelectorAll('#artifact-filter [data-rarity]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = Number(btn.dataset.rarity);
      if (selRarities.has(v)) selRarities.delete(v); else selRarities.add(v);
      btn.classList.toggle('active', selRarities.has(v));
      applyFilter();
    });
  });
  root.querySelector('#artifact-search').addEventListener('input', (e) => {
    keyword = e.target.value.trim();
    applyFilter();
  });

  applyFilter();
}

/* ============ 详情页 ============ */
function pieceCard(piece) {
  return `
    <article class="piece-card">
      <header class="piece-head">
        <span class="piece-icon-wrap">${artifactIconHtml(piece, 'artifact-icon')}</span>
        <span class="piece-titles">
          <span class="piece-slot">${escapeHtml(piece.slotText)}</span>
          <h3 class="piece-name">${escapeHtml(piece.name)}</h3>
        </span>
      </header>
      ${piece.description ? `<p class="piece-desc">${escapeHtml(piece.description)}</p>` : ''}
      ${piece.story ? `
        <details class="piece-story">
          <summary>故事</summary>
          <div class="piece-story-body">${piece.story.split('\n').map(l => l.trim()
            ? `<p>${escapeHtml(l)}</p>` : '').join('')}</div>
        </details>` : ''}
    </article>`;
}

function renderDetail(root, set) {
  root.innerHTML = `
    <div class="artifact-detail scope-genshin">
      <a class="back-link" href="#/artifacts">← 返回圣遗物图鉴</a>

      <header class="artifact-hero card" style="--rarity-color:${rarityColor(set.rarity)}">
        <div class="artifact-hero-icon">${artifactIconHtml({ icon: set.icon, iconUrl: set.iconUrl, name: set.name }, 'artifact-icon-lg')}</div>
        <div class="artifact-hero-info">
          <h1 class="artifact-hero-name">${escapeHtml(set.name)}</h1>
          <div class="artifact-hero-line">
            ${starsHtml(set.rarity)}
            ${set.version ? `<span class="artifact-version-chip">v${escapeHtml(set.version)}</span>` : ''}
            <span class="artifact-piece-count-chip">共 ${(set.pieces || []).length} 件</span>
          </div>
          <div class="set-effects">
            ${effectList(set).map(({ tag, html }) => `
              <div class="set-effect">
                <span class="set-effect-tag">${tag}</span>
                <span class="set-effect-text">${html}</span>
              </div>`).join('')}
          </div>
        </div>
      </header>

      <section class="talent-section">
        <h2>部位资料</h2>
        <div class="piece-grid">${(set.pieces || []).map(pieceCard).join('')}</div>
      </section>
    </div>`;

  document.title = `${set.name} · 圣遗物图鉴 · 艾莲的数据库`;
}

async function renderDetailAsync(root, slug) {
  root.innerHTML = `<p class="empty-hint">正在加载圣遗物资料…</p>`;
  const loader = DETAIL_LOADERS[`../../content/artifacts/${slug}.json`];
  if (!loader) {
    root.innerHTML = `<p class="empty-hint">未找到圣遗物「${escapeHtml(slug)}」的资料</p>`;
    return;
  }
  try {
    const mod = await loader();
    renderDetail(root, mod.default || mod);
  } catch (err) {
    root.innerHTML = `<p class="empty-hint">圣遗物资料加载失败：${escapeHtml(err.message)}</p>`;
  }
}

export function initArtifactsPage(root, params) {
  if (params && params[0]) {
    renderDetailAsync(root, decodeURIComponent(params[0]));
    return;
  }
  renderList(root);
}
