/**
 * weapons.js — 武器图鉴模块。
 *
 * 路由：
 *   #/weapons          列表（图标墙：类型 / 稀有度多选筛选 + 名称搜索，悬停显示满级属性）
 *   #/weapons/:name    详情（等级滑块 + 突破勾选的属性模拟、精炼 R1~R5、突破材料、武器故事）
 *
 * 数据源：
 *   src/data/weapons-index.json      列表用轻量索引（脚本生成）
 *   content/weapons/<名称>.json      详情用完整资料（按需懒加载）
 *   content/weapons/images/*.png     本地图标（可选，缺失时回落到官方 CDN）
 */
import '../styles/weapons.css';
import { renderRichText, highlightNumbers } from '../core/richtext.js';
import index from '../data/weapons-index.json';
import { weaponIcons } from '../assets/icons.js';

/* 完整资料：非 eager，切到详情页时才加载对应文件 */
const DETAIL_LOADERS = import.meta.glob('../../content/weapons/*.json');

/* 本地图标（跑了 `generate-weapons.mjs --icons` 才有内容） */
const LOCAL_ICONS = import.meta.glob('../../content/weapons/images/*.png', {
  eager: true, query: '?url', import: 'default',
});
const LOCAL_ICON_MAP = {};
for (const [path, url] of Object.entries(LOCAL_ICONS)) {
  LOCAL_ICON_MAP[decodeURIComponent(path.split('/').pop())] = url;
}

/* 武器类型主题色（仅用于筛选按钮，卡片配色只跟星级） */
const TYPE_COLOR = {
  单手剑: '#6aa3f0',
  双手剑: '#e0864f',
  长柄武器: '#b487e8',
  弓: '#68cf9b',
  法器: '#e3bf53',
};

const RARITY_COLOR = {
  5: '#e0a63c',
  4: '#a06cd5',
  3: '#4a8ad6',
  2: '#4caf7d',
  1: '#8b98a8',
};

const WEAPON_TYPES = ['单手剑', '双手剑', '长柄武器', '弓', '法器'];
const RARITIES = [5, 4, 3, 2, 1];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const iconSrc = (item) => LOCAL_ICON_MAP[item.icon] || item.iconUrl || '';

function weaponIconHtml(item, cls = 'weapon-icon') {
  const src = iconSrc(item);
  return src
    ? `<img class="${cls}" src="${src}" alt="${escapeHtml(item.name)}" loading="lazy" />`
    : `<span class="${cls} weapon-icon-missing">⚔️</span>`;
}

const starsHtml = (rarity) =>
  `<span class="rarity-stars" aria-label="${rarity} 星">${
    Array.from({ length: rarity }, () => '<span class="star">★</span>').join('')
  }</span>`;

const sourceTagHtml = (source) => source
  ? `<span class="source-tag" data-source="${escapeHtml(source)}">${escapeHtml(source)}</span>`
  : '';

/* ============ 列表页 ============ */
function renderList(root) {
  const all = index;

  root.innerHTML = `
    <header class="page-header">
      <h1>武器图鉴</h1>
      <p class="page-subtitle">共 ${all.length} 把武器 · 点击查看等级属性、武器技能与突破材料</p>
    </header>

    <div class="filter-bar" id="weapon-filter">
      <div class="filter-row" role="group" aria-label="按类型筛选（可多选，不选为全部）">
        ${WEAPON_TYPES.map(t => `
          <button class="fbtn" data-type="${t}" title="${t}" style="--el-color:${TYPE_COLOR[t]}">
            ${weaponIcons[t] ? `<img class="icon-18" src="data:image/webp;base64,${weaponIcons[t]}" alt="${t}" />` : ''}
          </button>`).join('')}
      </div>
      <div class="filter-row" role="group" aria-label="按稀有度筛选（可多选，不选为全部）">
        ${RARITIES.map(r => `
          <button class="fbtn rarity-btn" data-rarity="${r}" title="${r} 星" style="--el-color:${RARITY_COLOR[r]}">
            <span>${r}★</span>
          </button>`).join('')}
      </div>
      <input type="search" id="weapon-search" placeholder="搜索武器名…" aria-label="搜索武器名" />
    </div>

    <div class="weapon-grid" id="weapon-grid"></div>
    <p class="empty-hint" id="weapon-empty" hidden>没有符合条件的武器</p>
  `;

  const grid = root.querySelector('#weapon-grid');
  const emptyHint = root.querySelector('#weapon-empty');
  const selTypes = new Set();
  const selRarities = new Set();
  let keyword = '';

  function applyFilter() {
    const list = all.filter(w =>
      (!selTypes.size || selTypes.has(w.type)) &&
      (!selRarities.size || selRarities.has(w.rarity)) &&
      (!keyword || w.name.includes(keyword))
    );

    grid.innerHTML = list.map(w => `
      <a class="weapon-card r${w.rarity}" href="#/weapons/${encodeURIComponent(w.slug)}"
         style="--rarity-color:${RARITY_COLOR[w.rarity] || RARITY_COLOR[3]}">
        <span class="weapon-thumb">${weaponIconHtml(w, 'weapon-icon')}</span>
        <span class="weapon-card-name">${escapeHtml(w.name)}</span>
        ${starsHtml(w.rarity)}
      </a>`).join('');

    emptyHint.hidden = list.length > 0;
  }

  root.querySelectorAll('#weapon-filter [data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.type;
      if (selTypes.has(v)) selTypes.delete(v); else selTypes.add(v);
      btn.classList.toggle('active', selTypes.has(v));
      applyFilter();
    });
  });
  root.querySelectorAll('#weapon-filter [data-rarity]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = Number(btn.dataset.rarity);
      if (selRarities.has(v)) selRarities.delete(v); else selRarities.add(v);
      btn.classList.toggle('active', selRarities.has(v));
      applyFilter();
    });
  });
  root.querySelector('#weapon-search').addEventListener('input', (e) => {
    keyword = e.target.value.trim();
    applyFilter();
  });

  applyFilter();
}

/* ============ 详情页 ============ */

/* 等级滑块 + 突破勾选：拖动查看每一级的实际属性 */
function buildLevelPanel(weapon) {
  const curve = weapon.curve;
  if (!curve) return '';

  const maxLevel = curve.maxLevel || weapon.maxLevel || 90;
  const startLevel = maxLevel;
  const mainLabel = weapon.mainStat || '副属性';

  return `
    <div class="level-sim"
         data-max="${maxLevel}"
         data-percent="${weapon.mainStatPercent ? '1' : '0'}"
         data-pre-attack='${escapeHtml(JSON.stringify(curve.preAttack || {}))}'
         data-pre-main='${escapeHtml(JSON.stringify(curve.preSpecialized || {}))}'
         data-attack='${escapeHtml(JSON.stringify(curve.attack || []))}'
         data-main='${escapeHtml(JSON.stringify(curve.specialized || []))}'>
      <div class="weapon-stat-row">
        <div class="weapon-stat">
          <span class="weapon-stat-label">基础攻击力</span>
          <span class="weapon-stat-value" data-out="attack">—</span>
        </div>
        <div class="weapon-stat">
          <span class="weapon-stat-label">${escapeHtml(mainLabel)}</span>
          <span class="weapon-stat-value" data-out="main">—</span>
        </div>
      </div>

      <div class="level-slider-head">
        <span class="level-slider-label">等级</span>
        <span class="level-current">${startLevel}</span>
      </div>
      <input type="range" class="level-range" min="1" max="${maxLevel}" step="1"
             value="${startLevel}" aria-label="武器等级" />
      <div class="level-slider-foot">
        <label class="asc-toggle">
          <input type="checkbox" class="asc-check" checked />
          <span>已突破</span>
        </label>
        <span class="asc-hint">仅在 ${(curve.preAttack ? Object.keys(curve.preAttack) : []).join(' / ')} 级可切换</span>
      </div>
    </div>`;
}

/* 绑定滑块与突破勾选 */
function bindLevelPanel(root) {
  const panel = root.querySelector('.level-sim');
  if (!panel) return;

  const range = panel.querySelector('.level-range');
  const ascCheck = panel.querySelector('.asc-check');
  const current = panel.querySelector('.level-current');
  const outAttack = panel.querySelector('[data-out="attack"]');
  const outMain = panel.querySelector('[data-out="main"]');

  let preAttack = {}, preMain = {}, attack = [], main = [];
  try {
    preAttack = JSON.parse(panel.dataset.preAttack || '{}');
    preMain = JSON.parse(panel.dataset.preMain || '{}');
    attack = JSON.parse(panel.dataset.attack || '[]');
    main = JSON.parse(panel.dataset.main || '[]');
  } catch { /* 数据异常时保持默认 */ }
  const isPercent = panel.dataset.percent === '1';

  const fmtMain = (v) => {
    if (v === null || v === undefined) return '—';
    return isPercent ? `${(v * 100).toFixed(1)}%` : String(Math.round(v));
  };

  function apply() {
    const lv = Number(range.value);
    const atCap = Object.prototype.hasOwnProperty.call(preAttack, String(lv));
    ascCheck.disabled = !atCap;
    // 非突破节点的等级必然已经突破过
    if (!atCap) ascCheck.checked = true;

    const usePre = atCap && !ascCheck.checked;
    const atkVal = usePre ? preAttack[String(lv)] : attack[lv - 1];
    const mainVal = usePre ? preMain[String(lv)] : main[lv - 1];

    outAttack.textContent = atkVal ?? '—';
    outMain.textContent = fmtMain(mainVal);
    current.textContent = lv;
  }

  range.addEventListener('input', apply);
  ascCheck.addEventListener('change', apply);
  apply();
}

/* 武器技能：精炼 1~5 切换 */
function refinePanel(weapon) {
  const refs = weapon.refinements || [];
  if (!refs.length) return '';
  const current = refs[0];
  return `
    <section class="talent-card weapon-effect-card">
      <header class="talent-head">
        <span class="talent-type">武器技能</span>
        <h3 class="talent-name">${escapeHtml(weapon.effectName || '—')}</h3>
      </header>
      <div class="refine-panel" data-level="${current.level}">
        <div class="refine-tabs" role="tablist" aria-label="精炼等级">
          ${refs.map(r => `
            <button type="button" role="tab" class="refine-tab ${r.level === current.level ? 'active' : ''}"
                    data-level="${r.level}" aria-selected="${r.level === current.level}">R${r.level}</button>`).join('')}
        </div>
        <div class="refine-body">
          ${refs.map(r => `
            <p class="refine-desc" data-level="${r.level}" ${r.level === current.level ? '' : 'hidden'}>${highlightNumbers(renderRichText(r.description))}</p>`).join('')}
        </div>
      </div>
    </section>`;
}

/* 突破材料 */
function costSection(weapon) {
  const costs = weapon.costs || [];
  if (!costs.length) return '';
  return `
    <section class="card weapon-cost-card">
      <h2 style="margin-top:0">突破材料</h2>
      <div class="cost-grid">
        ${costs.map(c => `
          <div class="cost-stage">
            <div class="cost-stage-title">突破 ${c.stage}</div>
            <ul class="cost-list">
              ${c.items.map(it => `
                <li><span class="cost-item-name">${escapeHtml(it.name)}</span><span class="cost-item-count">×${it.count}</span></li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </section>`;
}

function renderDetail(root, weapon) {
  root.innerHTML = `
    <div class="weapon-detail scope-genshin">
      <a class="back-link" href="#/weapons">← 返回武器图鉴</a>

      <header class="weapon-hero card r${weapon.rarity}"
              style="--rarity-color:${RARITY_COLOR[weapon.rarity] || RARITY_COLOR[3]}">
        <div class="weapon-hero-icon">${weaponIconHtml(weapon, 'weapon-icon-lg')}</div>
        <div class="weapon-hero-info">
          <h1 class="weapon-hero-name">${escapeHtml(weapon.name)}</h1>
          <div class="weapon-hero-line">
            ${starsHtml(weapon.rarity)}
            <span class="weapon-type-chip">${escapeHtml(weapon.type)}</span>
            ${sourceTagHtml(weapon.source)}
            ${weapon.version ? `<span class="weapon-version-chip">v${escapeHtml(weapon.version)}</span>` : ''}
          </div>
          ${buildLevelPanel(weapon) || `<div class="weapon-stat-row">
            <div class="weapon-stat"><span class="weapon-stat-label">基础攻击力</span><span class="weapon-stat-value">${weapon.baseAtk}</span></div>
            ${weapon.mainStat ? `<div class="weapon-stat"><span class="weapon-stat-label">${escapeHtml(weapon.mainStat)}</span><span class="weapon-stat-value">${escapeHtml(weapon.mainStatValue)}</span></div>` : ''}
          </div>`}
        </div>
      </header>

      ${weapon.description ? `<p class="weapon-flavor">${escapeHtml(weapon.description)}</p>` : ''}

      <section class="talent-section">
        ${refinePanel(weapon)}
      </section>

      ${costSection(weapon)}

      ${weapon.story ? `
      <details class="card weapon-story">
        <summary>武器故事</summary>
        <div class="weapon-story-body">${weapon.story.split('\n').map(l => l.trim()
          ? `<p>${escapeHtml(l)}</p>` : '').join('')}</div>
      </details>` : ''}
    </div>`;

  /* 精炼切换 */
  const panel = root.querySelector('.refine-panel');
  if (panel) {
    const tabs = panel.querySelectorAll('.refine-tab');
    const descs = panel.querySelectorAll('.refine-desc');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const lv = tab.dataset.level;
        tabs.forEach(t => {
          const on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', String(on));
        });
        descs.forEach(d => { d.hidden = d.dataset.level !== lv; });
        panel.dataset.level = lv;
      });
    });
  }

  bindLevelPanel(root);
  document.title = `${weapon.name} · 武器图鉴 · 艾莲的数据库`;
}

/* 懒加载完整资料并渲染 */
async function renderDetailAsync(root, slug) {
  root.innerHTML = `<p class="empty-hint">正在加载武器资料…</p>`;
  const loader = DETAIL_LOADERS[`../../content/weapons/${slug}.json`];
  if (!loader) {
    root.innerHTML = `<p class="empty-hint">未找到武器「${escapeHtml(slug)}」的资料</p>`;
    return;
  }
  try {
    const mod = await loader();
    renderDetail(root, mod.default || mod);
  } catch (err) {
    root.innerHTML = `<p class="empty-hint">武器资料加载失败：${escapeHtml(err.message)}</p>`;
  }
}

export function initWeaponsPage(root, params) {
  if (params && params[0]) {
    renderDetailAsync(root, decodeURIComponent(params[0]));
    return;
  }
  renderList(root);
}
