/**
 * characters.js — 角色图鉴模块（核心模块）。
 *
 * 数据模型（每个角色）：
 *   { name, element, weapon, energy, skills: [{ name, elementAmount, attachRule, particles, note, poise }] }
 * 产球/附着数据已按「每行一个技能」承载，后续新增技能详细信息（倍率/机制描述等）
 * 直接扩展 skills 数组元素的字段即可，渲染处已预留位置。
 *
 * 路由：#/characters（列表）  #/characters/:name（详情）
 */
import '../styles/characters.css';
import { renderMarkdown } from '../core/markdown.js';
import { initTooltip } from '../core/tooltip.js';
import { elementLabels, elementIds, weaponTypes, characters } from '../data/characters.js';
import { elementIcons, weaponIcons } from '../assets/icons.js';
import mdSource from '../../content/attachment/元素附着及产球.md?raw';

/* 本地角色资料库：content/characters/*.json（仿 Snap.Hutao Avatar/SkillDepot 模型）
 * 每个角色一份本地 JSON，构建时自动加载，按 name 与产球表匹配。 */
const profileModules = import.meta.glob('../../content/characters/*.json', { eager: true });
const PROFILES = {};
for (const mod of Object.values(profileModules)) {
  const p = mod.default || mod;
  if (p && p.name) PROFILES[p.name] = p;
}

/* 本地角色头像：content/characters/images/<角色名>.png */
const avatarModules = import.meta.glob('../../content/characters/images/*.png', {
  eager: true, query: '?url', import: 'default',
});
const AVATARS = {};
for (const [path, url] of Object.entries(avatarModules)) {
  const name = decodeURIComponent(path.split('/').pop().replace(/\.png$/, ''));
  AVATARS[name] = url;
}

function avatarImg(name, cls = 'char-avatar') {
  const src = AVATARS[name];
  return src
    ? `<img class="${cls}" src="${src}" alt="${escapeHtml(name)}" />`
    : '';
}

/* 元素 id ↔ colors.json 类名 / 主题色 */
const ELEMENT_META = {
  fire:    { color: '#ee0000', iconLabel: '火系' },
  water:   { color: '#0066cc', iconLabel: '水系' },
  thunder: { color: '#7950f2', iconLabel: '雷系' },
  ice:     { color: '#22d3ee', iconLabel: '冰系' },
  wind:    { color: '#34d399', iconLabel: '风系' },
  rock:    { color: '#eab308', iconLabel: '岩系' },
  grass:   { color: '#4ade80', iconLabel: '草系' },
};

const ELEMENT_AMOUNT_CLASSES = {
  '弱火': 'element-fire-weak', '强火': 'element-fire-strong', '超强火': 'element-fire-super',
  '弱水': 'element-water-weak', '强水': 'element-water-strong', '超强水': 'element-water-super',
  '弱雷': 'element-thunder-weak', '强雷': 'element-thunder-strong', '超强雷': 'element-thunder-super',
  '弱冰': 'element-ice-weak', '强冰': 'element-ice-strong', '超强冰': 'element-ice-super',
  '弱风': 'element-wind-weak', '强风': 'element-wind-strong', '超强风': 'element-wind-super',
  '弱岩': 'element-rock-weak', '强岩': 'element-rock-strong', '超强岩': 'element-rock-super',
  '弱草': 'element-grass-weak', '中草': 'element-grass-medium', '强草': 'element-grass-strong', '超强草': 'element-grass-super',
};

const CHANGELOG = [
  ['V7.0.0', ['使用 Vite 重构项目，数据驱动渲染', '同步更新角色数据至最新版本', '统一了技能描述']],
  ['V6.3.1', ['新增了角色充能计算器', '修正了一些角色信息']],
  ['V6.3.0', ['新增了角色的抗打断系数', '统一了格式和名称', '更新了 6.3 角色的附着以及产球']],
  ['V1.0.1', ['更正了已知的文本错误和格式不一致', '新增了武器筛选角色', '补充了闲云的产球']],
  ['V1.0.0', ['补上了持续产球角色的攻击周期', '统一了格式和名称']],
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function iconImg(iconMap, label, cls = 'icon-18') {
  const src = iconMap[label];
  return src ? `<img class="${cls}" src="data:image/webp;base64,${src}" alt="${escapeHtml(label)}" />` : '';
}

/* 拍平角色数据并补上元素字段，再按实装版本倒序（新角色在前）；
 * 版本来自 content/characters/<名>.json 的 version 字段（scripts/sync-character-versions.mjs 写入），
 * 暂无版本的排在最后 */
const versionParts = (v) => String(v || '').split('.').map(Number);
function versionRank(name) {
  const v = PROFILES[name]?.version;
  if (!v) return [-1, -1];
  const p = versionParts(v);
  return [p[0] || 0, p[1] || 0];
}
const ALL_CHARACTERS = elementIds
  .flatMap(el => (characters[el] || []).map(c => ({ ...c, element: el })))
  .sort((a, b) => {
    const [am, an] = versionRank(a.name);
    const [bm, bn] = versionRank(b.name);
    const ar = PROFILES[a.name]?.rarity || 0;
    const br = PROFILES[b.name]?.rarity || 0;
    return (bm - am) || (bn - an) || (br - ar) || a.name.localeCompare(b.name, 'zh');
  });

function findCharacter(name) {
  const decoded = decodeURIComponent(name || '');
  return ALL_CHARACTERS.find(c => c.name === decoded) || null;
}

function getAmountClass(text) {
  if (!text) return '';
  for (const [keyword, className] of Object.entries(ELEMENT_AMOUNT_CLASSES)) {
    if (text.includes(keyword)) return className;
  }
  return '';
}

function getAmountStyle(text) {
  if (!text) return '';
  if (text.includes('染色') || text === '弱元素' || text.includes('弱元素')) {
    return 'color:#a7f3d0;font-weight:600;';
  }
  return '';
}

/* ============ 列表页 ============ */
function renderList(root) {
  root.innerHTML = `
    <header class="page-header">
      <h1>角色图鉴</h1>
      <p class="page-subtitle">共 ${ALL_CHARACTERS.length} 名角色 · 点击查看技能、附着与产球详情</p>
    </header>

    <div class="subnav-tabs" role="tablist">
      <a href="#/characters" class="active">角色</a>
      <a href="#/characters/tools">工具</a>
    </div>

    <div class="filter-bar" id="filter-bar">
      <div class="filter-row" role="group" aria-label="按元素筛选（可多选，不选为全部）">
        ${elementIds.map(id => `
          <button class="fbtn" data-element="${id}" title="${elementLabels[id]}" style="--el-color:${ELEMENT_META[id].color}">
            ${iconImg(elementIcons, ELEMENT_META[id].iconLabel)}
          </button>`).join('')}
      </div>
      <div class="filter-row" role="group" aria-label="按武器筛选（可多选，不选为全部）">
        ${weaponTypes.map(w => `
          <button class="fbtn" data-weapon="${w}" title="${w}">
            ${iconImg(weaponIcons, w)}
          </button>`).join('')}
      </div>
      <input type="search" id="char-search" placeholder="搜索角色名…" aria-label="搜索角色名" />
    </div>

    <div class="wind-note" id="wind-note" hidden>
      <strong>风系染色说明：</strong>染色会造成对应元素的伤害，与原风伤的附着规则一致但彼此独立，拥有独立的元素量强弱；未特别说明时染色顺序为：火水雷冰。
    </div>

    <div class="char-grid" id="char-grid"></div>
    <p class="empty-hint" id="list-empty" hidden>没有符合条件的角色</p>
  `;

  const selElements = new Set();
  const selWeapons = new Set();
  let keyword = '';

  const grid = root.querySelector('#char-grid');
  const emptyHint = root.querySelector('#list-empty');
  const windNote = root.querySelector('#wind-note');

  function applyFilter() {
    const list = ALL_CHARACTERS.filter(c =>
      (!selElements.size || selElements.has(c.element)) &&
      (!selWeapons.size || selWeapons.has(c.weapon)) &&
      (!keyword || c.name.includes(keyword))
    );

    grid.innerHTML = list.map(c => {
      const meta = ELEMENT_META[c.element];
      const profile = PROFILES[c.name];
      const rarCls = profile?.rarity === 5 ? 'r5' : profile?.rarity === 4 ? 'r4' : '';
      const avatar = avatarImg(c.name, 'char-avatar-sm');
      return `
      <a class="char-card card hoverable ${rarCls}" href="#/characters/${encodeURIComponent(c.name)}"
         style="--el-color:${meta.color}">
        <span class="char-avatar-wrap">${avatar || iconImg(elementIcons, meta.iconLabel, 'icon-22')}</span>
        <span class="char-name">${escapeHtml(c.name)}</span>
      </a>`;
    }).join('');

    emptyHint.hidden = list.length > 0;
    windNote.hidden = !(selElements.size === 1 && selElements.has('wind'));
  }

  root.querySelectorAll('#filter-bar [data-element]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.element;
      if (selElements.has(id)) selElements.delete(id); else selElements.add(id);
      btn.classList.toggle('active', selElements.has(id));
      applyFilter();
    });
  });
  root.querySelectorAll('#filter-bar [data-weapon]').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.weapon;
      if (selWeapons.has(w)) selWeapons.delete(w); else selWeapons.add(w);
      btn.classList.toggle('active', selWeapons.has(w));
      applyFilter();
    });
  });
  root.querySelector('#char-search').addEventListener('input', (e) => {
    keyword = e.target.value.trim();
    applyFilter();
  });

  applyFilter();
}

/* ============ 工具页（通用数据表 + 充能计算器） ============ */
function renderTools(root) {
  const firstH1 = mdSource.search(/^#\s+/m);
  const introMd = firstH1 > 0 ? mdSource.slice(0, firstH1) : '';

  root.innerHTML = `
    <header class="page-header">
      <h1>数据工具</h1>
      <p class="page-subtitle">圣遗物词条分布 · 普攻产球概率 · 角色充能计算</p>
    </header>

    <div class="subnav-tabs" role="tablist">
      <a href="#/characters">角色</a>
      <a href="#/characters/tools" class="active">工具</a>
    </div>

    <div class="markdown-body tools-intro">${renderMarkdown(introMd)}</div>

    <section class="card energy-card">
      <h2 style="margin-top:0">角色充能计算器</h2>
      <div class="table-wrap"><table id="energy-calc-table">
        <colgroup>
          <col style="width: 13%;"><col style="width: 10%;">
          <col style="width: 11%;"><col style="width: 11%;">
          <col style="width: 11%;"><col style="width: 11%;">
          <col style="width: 11%;"><col style="width: 11%;">
          <col style="width: 11%;">
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">角色</th>
            <th rowspan="2">能量</th>
            <th colspan="2">同色球</th>
            <th colspan="2">无色球</th>
            <th colspan="2">异色球</th>
            <th rowspan="2">充能要求</th>
          </tr>
          <tr><th>前台</th><th>后台</th><th>前台</th><th>后台</th><th>前台</th><th>后台</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <input type="text" id="character-name" placeholder="角色名称" list="character-suggestions">
              <datalist id="character-suggestions"></datalist>
            </td>
            <td><input type="text" id="x" placeholder="能量"></td>
            <td><input type="text" id="a" placeholder="前台" value="0"></td>
            <td><input type="text" id="d" placeholder="后台" value="0"></td>
            <td><input type="text" id="b" placeholder="前台" value="0"></td>
            <td><input type="text" id="e" placeholder="后台" value="0"></td>
            <td><input type="text" id="c" placeholder="前台" value="0"></td>
            <td><input type="text" id="f" placeholder="后台" value="0"></td>
            <td class="calc-result" id="result">未输入</td>
          </tr>
        </tbody>
      </table></div>
      <p class="calc-hint">输入角色名可自动填充元素爆发能量；产球数按 3 能量/同色前台、2 能量/无色前台、1 能量/异色前台、后台 60% 折算。</p>
    </section>

    <details class="card changelog">
      <summary>更新日志</summary>
      ${CHANGELOG.map(([ver, items]) => `
        <h3>${ver}</h3>
        <ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`).join('')}
      <p class="changelog-sign">--艾莲其实是爱恋的意思</p>
    </details>
  `;

  const q = (id) => root.querySelector(`#${id}`);

  function calculateResult() {
    const x = parseFloat(q('x')?.value) || 0;
    const a = parseFloat(q('a')?.value) || 0;
    const d = parseFloat(q('d')?.value) || 0;
    const b = parseFloat(q('b')?.value) || 0;
    const e = parseFloat(q('e')?.value) || 0;
    const c = parseFloat(q('c')?.value) || 0;
    const f = parseFloat(q('f')?.value) || 0;
    const resultEl = q('result');
    if (!resultEl) return;
    if (q('x')?.value === '') { resultEl.textContent = '未输入'; return; }
    const denominator = (3 * a) + (2 * b) + c + 0.6 * ((3 * d) + (2 * e) + f);
    resultEl.textContent = denominator === 0 ? '分母为零' : `${((x / denominator) * 100).toFixed(1)}%`;
  }

  q('character-name').addEventListener('input', () => {
    const name = q('character-name').value.trim();
    const found = ALL_CHARACTERS.find(c => c.name === name);
    if (found && found.energy && found.energy !== '未知') {
      q('x').value = found.energy;
      calculateResult();
    }
    const keyword = q('character-name').value.trim();
    const names = ALL_CHARACTERS.filter(c => !keyword || c.name.includes(keyword)).map(c => c.name);
    q('character-suggestions').innerHTML = Array.from(new Set(names)).map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  });
  ['x', 'a', 'd', 'b', 'e', 'c', 'f'].forEach(id => q(id).addEventListener('input', calculateResult));

  q('character-suggestions').innerHTML = ALL_CHARACTERS.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
  calculateResult();
}

/* ============ 角色详情页 ============ */

/* 产球/附着行渲染为 <td> 组 */
function attachmentCells(skill) {
  const amountClass = getAmountClass(skill.elementAmount);
  const amountStyle = getAmountStyle(skill.elementAmount);
  const amountHtml = amountClass
    ? `<td class="${amountClass}">${escapeHtml(skill.elementAmount)}</td>`
    : amountStyle
      ? `<td style="${amountStyle}">${escapeHtml(skill.elementAmount)}</td>`
      : `<td>${escapeHtml(skill.elementAmount)}</td>`;
  return `
    ${amountHtml}
    <td>${escapeHtml(skill.attachRule)}</td>
    <td>${escapeHtml(skill.particles)}</td>
    <td class="skill-note">${escapeHtml(skill.note)}</td>
    <td>${escapeHtml(skill.poise)}</td>`;
}

const ATTACHMENT_TABLE_HEAD = `
  <colgroup><col style="width:15%"><col style="width:11%"><col style="width:20%"><col style="width:11%"><col style="width:31%"><col style="width:12%"></colgroup>
  <thead><tr><th>技能</th><th>元素量</th><th>附着规则</th><th>产球</th><th>备注</th><th>抗打断</th></tr></thead>`;

/* 把产球/附着行按名称归入天赋分组：普攻/重击→attack，E→skill，Q→burst，
 * 命座N→constellation N，突破/固有天赋N→passive N（归入突破天赋卡片） */
function groupAttachmentRows(rows) {
  const groups = { attack: [], skill: [], burst: [], other: [], passives: [] };
  const constellations = {};
  rows.forEach(s => {
    const n = (s.name || '').trim();
    const cMatch = n.match(/^命之?座?\s*(\d+)/);
    const pMatch = n.match(/^(?:突破|固有)天赋\s*(\d+)/);
    if (cMatch) {
      (constellations[cMatch[1]] ||= []).push(s);
    } else if (pMatch) {
      groups.passives.push({ index: parseInt(pMatch[1], 10), skill: s });
    } else if (/^(E|e)/.test(n)) {
      groups.skill.push(s);
    } else if (/^(Q|q)/.test(n)) {
      groups.burst.push(s);
    } else if (n.includes('普攻') || n.includes('重击') || n.includes('下落') || n.includes('瞄准') || n.includes('蓄力')) {
      groups.attack.push(s);
    } else {
      groups.other.push(s);
    }
  });
  return { ...groups, constellations };
}

/* 附着/产球表（裸表，不带外框与标题） */
function attachmentTable(rows) {
  if (!rows.length) return '';
  return `
    <div class="table-wrap attach-wrap"><table class="attach-table">
      <thead><tr><th>技能</th><th>元素量</th><th>附着规则</th><th>产球</th><th>备注</th><th>抗打断</th></tr></thead>
      <tbody>${rows.map(s => `<tr><td class="skill-name">${escapeHtml(s.name)}</td>${attachmentCells(s)}</tr>`).join('')}</tbody>
    </table></div>`;
}

/* 等级选择器 + 所选等级的数值（默认 10 级，步进器切换） */
function levelSelector(skill) {
  if (!skill.levels || !skill.levels.length) return '';
  const maxLevel = Math.max(...skill.levels.map(l => (l.values || []).length));
  const defaultLevel = Math.min(10, maxLevel);
  const rows = skill.levels.map(l => `
    <div class="level-row" data-label="${escapeHtml(l.label)}">
      <span class="level-row-label">${escapeHtml(l.label)}</span>
      <span class="level-row-value" data-values='${escapeHtml(JSON.stringify(l.values || []))}'>${escapeHtml(l.values?.[defaultLevel - 1] ?? '-')}</span>
    </div>`).join('');
  return `
    <div class="level-panel" data-level="${defaultLevel}" data-max="${maxLevel}">
      <div class="level-select-label"><span>天赋等级</span>
        <div class="level-stepper">
          <button type="button" class="level-btn" data-step="-1" aria-label="降低等级">−</button>
          <span class="level-current">${defaultLevel} 级</span>
          <button type="button" class="level-btn" data-step="1" aria-label="提高等级">＋</button>
        </div>
      </div>
      <div class="level-rows">${rows}</div>
    </div>`;
}

/* 文本段落换行 */
const textHtml = (text) => escapeHtml(text || '').replace(/\n/g, '<br>');

/* 状态说明内嵌：在正文里找到状态名，包成虚线下划线 + 悬停说明（title）。
 * 正文里找不到的，追加在描述末尾。 */
function inlineStatesHtml(desc, states = []) {
  const text = String(desc || '');
  const spans = [];
  const unused = [];
  for (const s of states) {
    const variants = [...new Set([s.name, s.name.split('·')[0]].filter(Boolean))];
    const found = variants.map(v => ({ v, i: text.indexOf(v) })).find(x => x.i >= 0);
    if (found) spans.push({ start: found.i, end: found.i + found.v.length, title: s.text, name: found.v });
    else unused.push(s);
  }
  spans.sort((a, b) => a.start - b.start);
  const accepted = [];
  let lastEnd = -1;
  for (const sp of spans) {
    if (sp.start >= lastEnd) { accepted.push(sp); lastEnd = sp.end; }
  }
  let html = '', pos = 0;
  for (const sp of accepted) {
    html += textHtml(text.slice(pos, sp.start));
    html += `<span class="talent-term" data-tip="${escapeHtml(sp.title)}">${escapeHtml(sp.name)}</span>`;
    pos = sp.end;
  }
  html += textHtml(text.slice(pos));
  for (const s of unused) {
    html += `${html ? '<br>' : ''}<span class="talent-term" data-tip="${escapeHtml(s.text)}">${escapeHtml(s.name)}</span>`;
  }
  return html;
}

/* 描述整体渲染：正文（状态名内嵌悬停）+ 逸闻（附录色斜体，悬停说明） */
const descHtml = (item) => {
  const has = item.description || (item.states || []).length || item.lore;
  if (!has) return '';
  return `<p class="talent-desc">${inlineStatesHtml(item.description, item.states)}${loreHtml(item.lore)}</p>`;
};

const loreHtml = (lore) => lore
  ? `<br><span class="talent-lore" data-tip="角色逸闻 · 游戏内原文">${textHtml(lore)}</span>`
  : '';

/* 页面加载后绑定等级选择器事件 */
function bindLevelSelectors(root) {
  root.querySelectorAll('.level-panel').forEach(panel => {
    const current = panel.querySelector('.level-current');
    const apply = () => {
      const lv = parseInt(panel.dataset.level, 10) - 1;
      panel.querySelectorAll('.level-row-value').forEach(el => {
        let values = [];
        try { values = JSON.parse(el.dataset.values || '[]'); } catch { /* ignore */ }
        el.textContent = values[lv] ?? '-';
      });
      current.textContent = `${panel.dataset.level} 级`;
    };
    const step = (dir) => {
      const next = parseInt(panel.dataset.level, 10) + dir;
      const max = parseInt(panel.dataset.max, 10);
      panel.dataset.level = String(Math.min(max, Math.max(1, next)));
      apply();
    };
    panel.querySelectorAll('.level-btn').forEach(btn => {
      btn.addEventListener('click', () => step(parseInt(btn.dataset.step, 10)));
    });
    /* 鼠标滚轮悬停在面板上时增减等级 */
    panel.addEventListener('wheel', (e) => {
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  });

  /* 命之座标签页切换 */
  const tabs = root.querySelector('.constellation-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.constellation-tab');
      if (!tab) return;
      const level = tab.dataset.constellation;
      tabs.querySelectorAll('.constellation-tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab);
      });
      tabs.parentElement.querySelectorAll('.constellation-panel').forEach(p => {
        p.hidden = p.dataset.constellation !== level;
      });
    });
  }
}

function renderHero(char, meta, profile) {
  const rarity = profile?.rarity ? `<span class="hero-rarity">${'★'.repeat(profile.rarity)}</span>` : '';
  const title = profile?.title ? `<span class="hero-title">「${escapeHtml(profile.title)}」</span>` : '';
  const avatar = avatarImg(char.name, 'char-avatar-lg');
  return `
    <header class="card char-hero" style="--el-color:${meta.color}">
      <div class="char-hero-main">
        <span class="char-hero-avatar">${avatar || iconImg(elementIcons, meta.iconLabel, 'icon-32')}</span>
        <div class="char-hero-info">
          <h1>${escapeHtml(char.name)}</h1>
          <div class="hero-sub">${rarity}${title}</div>
          <div class="char-hero-tags">
            <span class="chip">${iconImg(elementIcons, meta.iconLabel)}${elementLabels[char.element]}</span>
            <span class="chip">${iconImg(weaponIcons, char.weapon)}${escapeHtml(char.weapon || '未知武器')}</span>
            ${char.energy ? `<span class="chip">⚡ ${escapeHtml(char.energy)} 能量</span>` : ''}
          </div>
          ${profile?.description ? `<p class="hero-desc">${escapeHtml(profile.description)}</p>` : ''}
        </div>
      </div>
    </header>`;
}

/* 无本地资料的角色：退回纯附着/产球表 */
/* 占位卡片：无本地资料的角色先搭好框架，标注等待补充 */
const pendingCard = (type, name, rows = [], showTag = true) => `
  <article class="talent-card pending ${rows.length ? '' : 'empty'}">
    ${showTag || (name && name !== type) ? `
    <header class="talent-head">
      ${showTag ? `<span class="talent-type">${escapeHtml(type)}</span>` : ''}
      ${name && name !== type ? `<h3 class="talent-name">${escapeHtml(name)}</h3>` : ''}
    </header>` : ''}
    ${rows.length ? attachmentTable(rows) : `
    <div class="pending-body">
      <span class="pending-badge">等待补充</span>
      <p class="pending-hint">该角色的${escapeHtml(type)}资料暂未收录，将在数据源更新后自动展示。</p>
    </div>`}
  </article>`;

function renderDetailPlain(root, char, meta) {
  const groups = groupAttachmentRows(char.skills);
  const restRows = [
    ...groups.other,
    ...Object.values(groups.constellations).flat(),
    ...groups.passives.map(p => p.skill),
  ];
  root.innerHTML = `
    <div class="char-detail scope-genshin">
      <a class="back-link" href="#/characters">← 返回角色图鉴</a>
      ${renderHero(char, meta, null)}
      <section class="talent-section">
        <h2>战斗天赋</h2>
        <div class="talent-grid stacked">
          ${pendingCard('普通攻击', '', groups.attack)}
          ${pendingCard('元素战技', '', groups.skill)}
          ${pendingCard('元素爆发', '', groups.burst)}
        </div>
      </section>
      <section class="talent-section">
        <h2>突破天赋 / 固有天赋</h2>
        <div class="talent-grid">
          ${pendingCard('突破天赋', '', [], false)}
          ${pendingCard('固有天赋', '', [], false)}
        </div>
      </section>
      <section class="talent-section">
        <h2>命之座</h2>
        <div class="talent-grid">${pendingCard('命之座', '', [], false)}</div>
      </section>
      ${restRows.length ? `
      <section class="card">
        <h2 style="margin-top:0">其他 · 附着与产球</h2>
        <div class="table-wrap"><table class="skill-table">${ATTACHMENT_TABLE_HEAD}
          <tbody>${restRows.map(s => `<tr><td class="skill-name">${escapeHtml(s.name)}</td>${attachmentCells(s)}</tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}
      <p class="detail-hint">该角色暂无完整本地资料（content/characters/${escapeHtml(char.name)}.json），天赋框架已就位，资料补充后将自动展示完整信息。</p>
    </div>`;
}

/* 有本地资料的角色：左上天赋描述 + 右上等级选择 + 下方附着/产球表 */
function renderDetailProfile(root, char, meta, profile) {
  const groups = groupAttachmentRows(char.skills);

  const skillCards = (profile.skills || []).map(sk => {
    const rows = groups[sk.id] || [];
    const hasLevels = sk.levels && sk.levels.length;
    return `
      <article class="talent-card">
        <div class="talent-top">
          <div class="talent-left">
            <header class="talent-head">
              <span class="talent-type">${escapeHtml(sk.type || '')}</span>
              <h3 class="talent-name">${escapeHtml(sk.name || '')}</h3>
            </header>
            ${descHtml(sk)}
          </div>
          ${hasLevels ? levelSelector(sk) : ''}
        </div>
        ${attachmentTable(rows)}
      </article>`;
  }).join('');

  const passives = profile.passives?.length
    ? profile.passives
    : (profile.inherents || []).map(t => ({ ...t, category: 'ascension' }));
  const ascensionPassives = passives.filter(p => p.category !== 'utility');
  const utilityPassives = passives.filter(p => p.category === 'utility');

  /* 把「突破天赋N」附着行分给对应被动卡片：优先按序号 N 对上第 N 个突破天赋，
   * 未命中的行再按备注关键词与被动描述匹配，最后落入「其他」。 */
  const passiveRows = [...(groups.passives || [])];
  const keywordOf = (s) => String(s.note || '').split(/[，,·\s]/).filter(w => w.length >= 2)[0] || '';
  const rowsForPassive = (p, i) => {
    const idx = passiveRows.findIndex(r => r.index === i + 1);
    if (idx >= 0) return [passiveRows.splice(idx, 1)[0].skill];
    const kw = passiveRows.map((r, j) => [keywordOf(r.skill), j]).find(([kw]) => kw && p.description.includes(kw));
    if (kw) return [passiveRows.splice(kw[1], 1)[0].skill];
    return [];
  };

  const passiveCard = (t, rows = []) => `
    <article class="talent-card compact ${rows.length ? '' : 'dimmed'}">
      <header class="talent-head"><h3 class="talent-name">${escapeHtml(t.name)}</h3></header>
      ${descHtml(t)}
      ${attachmentTable(rows)}
    </article>`;

  const constellationCards = (profile.constellations || []).map(c => {
    const rows = groups.constellations[c.level] || [];
    return `
      <article class="talent-card compact constellation-panel" data-constellation="${c.level}" ${c.level === 1 ? '' : 'hidden'}>
        ${descHtml(c)}
        ${attachmentTable(rows)}
      </article>`;
  }).join('');

  /* 突破天赋卡片先按序消耗 passiveRows，剩余未匹配的归入「其他」 */
  const ascensionCards = ascensionPassives.map((t, i) => passiveCard(t, rowsForPassive(t, i))).join('');
  if (passiveRows.length) groups.other.push(...passiveRows.map(r => r.skill));

  root.innerHTML = `
    <div class="char-detail scope-genshin">
      <a class="back-link" href="#/characters">← 返回角色图鉴</a>
      ${renderHero(char, meta, profile)}

      <section class="talent-section">
        <h2>战斗天赋</h2>
        ${skillCards}
      </section>

      ${ascensionPassives.length ? `
      <section class="talent-section">
        <h2>突破天赋</h2>
        <div class="talent-grid">${ascensionCards}</div>
      </section>` : ''}

      ${utilityPassives.length ? `
      <section class="talent-section">
        <h2>固有天赋</h2>
        <div class="talent-grid">${utilityPassives.map(t => passiveCard(t)).join('')}</div>
      </section>` : ''}

      ${constellationCards ? `
      <section class="talent-section">
        <h2>命之座</h2>
        <div class="constellation-tabs" role="tablist">
          ${profile.constellations.map(c => `<button type="button" role="tab" class="constellation-tab ${c.level === 1 ? 'active' : ''}" data-constellation="${c.level}" aria-selected="${c.level === 1}">${escapeHtml(c.name)}</button>`).join('')}
        </div>
        <div class="constellation-panels">${constellationCards}</div>
      </section>` : ''}

      ${groups.other.length ? `
      <section class="card">
        <h2 style="margin-top:0">其他 · 附着与产球</h2>
        <div class="table-wrap"><table class="skill-table">${ATTACHMENT_TABLE_HEAD}
          <tbody>${groups.other.map(s => `<tr><td class="skill-name">${escapeHtml(s.name)}</td>${attachmentCells(s)}</tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}
    </div>`;

  bindLevelSelectors(root);
}

function renderDetail(root, char) {
  const meta = ELEMENT_META[char.element];
  const profile = PROFILES[char.name];
  if (profile) {
    renderDetailProfile(root, char, meta, profile);
  } else {
    renderDetailPlain(root, char, meta);
  }
}

export function initCharactersPage(root, params) {
  initTooltip();
  if (params[0] === 'tools') {
    renderTools(root);
    return;
  }
  if (params[0]) {
    const char = findCharacter(params[0]);
    if (char) {
      renderDetail(root, char);
      document.title = `${char.name} · 角色图鉴 · 艾莲的数据库`;
      return;
    }
  }
  renderList(root);
}
