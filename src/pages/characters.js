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
import { levelSimHtml, bindLevelSim } from '../core/level-sim.js';
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
  ['V7.1.0', [
    '角色充能计算器扩充到 4 人，可按队伍人数（4/3/2 人）修正后台吸收效率',
    '接入测试服数据源，角色 / 武器 / 圣遗物均按最新数据自动构建（含未实装内容）',
    '新增 7.1 内容：6 把武器、2 名角色（沃雅妮莎、薇斯纳）与对应头像',
    '新增 7.2 幽境 Boss，修正相邻行内公式的渲染乱码',
  ]],
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

/* 充能计算器：可输入 4 名角色，队伍人数 = 显示的行数（最少 1 人，由用户自己增减） */
const ENERGY_ROWS = 4;
const ENERGY_ROW_INDEXES = Array.from({ length: ENERGY_ROWS }, (_, i) => i + 1);
/* 后台吸收效率随队伍人数变化（见「伤害公式 · 元素充能计算」的吸收效率表）；单人无后台队友，沿用 60% */
const OFF_FIELD_RATE = { 1: 0.6, 2: 0.8, 3: 0.7, 4: 0.6 };

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
      <div class="energy-head">
        <h2>角色充能计算器</h2>
        <div class="energy-party" role="group" aria-label="队伍人数">
          <span class="party-label">队伍人数</span>
          <button type="button" class="party-btn" id="party-minus" aria-label="减少一人">−</button>
          <span class="party-count" id="party-count">${ENERGY_ROWS}</span>
          <button type="button" class="party-btn" id="party-plus" aria-label="增加一人">＋</button>
          <span class="party-note">后台吸收 <strong id="party-rate">60%</strong></span>
        </div>
      </div>
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
          ${ENERGY_ROW_INDEXES.map(i => `
          <tr data-row="${i}">
            <td><input type="text" id="name${i}" placeholder="角色 ${i}" list="character-suggestions"></td>
            <td><input type="text" id="x${i}" placeholder="能量"></td>
            <td><input type="text" id="a${i}" placeholder="前台" value="0"></td>
            <td><input type="text" id="d${i}" placeholder="后台" value="0"></td>
            <td><input type="text" id="b${i}" placeholder="前台" value="0"></td>
            <td><input type="text" id="e${i}" placeholder="后台" value="0"></td>
            <td><input type="text" id="c${i}" placeholder="前台" value="0"></td>
            <td><input type="text" id="f${i}" placeholder="后台" value="0"></td>
            <td class="calc-result" id="result${i}">未输入</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <datalist id="character-suggestions"></datalist>
      <p class="calc-hint">输入角色名可自动填充元素爆发能量。产球按<b>元素微粒</b>（基础回能值 1）折算：同色前台 300%、无色前台 200%、异色前台 100%；后台吸收效率随队伍人数变化（4 人 60%、3 人 70%、2 人 80%，单人无后台队友仍按 60%）。由圣遗物 / 武器 / 天赋 / 命座产生的固定回能不受元素充能效率与吸收效率影响，不计入本表。</p>
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
  const num = (v) => parseFloat(v) || 0;

  let partySize = ENERGY_ROWS;
  const rowEls = ENERGY_ROW_INDEXES.map(i => root.querySelector(`tr[data-row="${i}"]`));

  /* 分母 = 前台（同色 ×3 + 无色 ×2 + 异色 ×1）+ 后台系数 ×（同色 ×3 + 无色 ×2 + 异色 ×1）
   * 系数即吸收效率：前台 100%/200%/300%，后台按队伍人数 60%(4人) / 70%(3人) / 80%(2人) */
  function calculateResult(i) {
    const resultEl = q(`result${i}`);
    if (!resultEl) return;
    if (q(`x${i}`).value === '') { resultEl.textContent = '未输入'; return; }
    const onField = 3 * num(q(`a${i}`).value) + 2 * num(q(`b${i}`).value) + num(q(`c${i}`).value);
    const offField = 3 * num(q(`d${i}`).value) + 2 * num(q(`e${i}`).value) + num(q(`f${i}`).value);
    const denominator = onField + OFF_FIELD_RATE[partySize] * offField;
    resultEl.textContent = denominator === 0
      ? '分母为零'
      : `${((num(q(`x${i}`).value) / denominator) * 100).toFixed(1)}%`;
  }

  function calculateResults() { ENERGY_ROW_INDEXES.forEach(calculateResult); }

  /* 队伍人数 = 显示的行数，最少 1 人（减少后该行输入值仍保留） */
  function applyPartySize() {
    rowEls.forEach((el, idx) => { if (el) el.hidden = idx + 1 > partySize; });
    q('party-count').textContent = String(partySize);
    q('party-rate').textContent = `${Math.round(OFF_FIELD_RATE[partySize] * 100)}%`;
    q('party-minus').disabled = partySize <= 1;
    q('party-plus').disabled = partySize >= ENERGY_ROWS;
    calculateResults();
  }

  ENERGY_ROW_INDEXES.forEach(i => {
    q(`name${i}`).addEventListener('input', () => {
      const found = ALL_CHARACTERS.find(c => c.name === q(`name${i}`).value.trim());
      if (found && found.energy && found.energy !== '未知') q(`x${i}`).value = found.energy;
      calculateResult(i);
    });
    ['x', 'a', 'd', 'b', 'e', 'c', 'f'].forEach(k => q(`${k}${i}`).addEventListener('input', () => calculateResult(i)));
  });

  q('party-minus').addEventListener('click', () => { if (partySize > 1) { partySize -= 1; applyPartySize(); } });
  q('party-plus').addEventListener('click', () => { if (partySize < ENERGY_ROWS) { partySize += 1; applyPartySize(); } });

  q('character-suggestions').innerHTML = ALL_CHARACTERS.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
  applyPartySize();
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

/* 文本段落换行；<buff>…</buff> 标记（由 scripts/sync-buffs.mjs 写入）转成加强色 */
const textHtml = (text) => escapeHtml(text || '')
  .replace(/&lt;buff&gt;/g, '<span class="rt-buff">')
  .replace(/&lt;\/buff&gt;/g, '</span>')
  .replace(/\n/g, '<br>');

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

/* 描述整体渲染：正文（状态名内嵌悬停）+ 逸闻（附录色斜体，悬停说明）。
 * 有 buffs.description（gachabase 加强版文本，只给新增片段包了 <buff>）时优先渲染它。 */
const descHtml = (item, refs) => {
  const desc = item.buffs?.description || item.description;
  const states = item.buffs?.states || item.states;
  const lore = item.buffs?.lore || item.lore;
  const has = desc || (states || []).length || lore;
  if (!has) return '';
  const html = `${inlineStatesHtml(desc, states)}${loreHtml(lore)}`;
  return `<p class="talent-desc">${markSkillRefs(html, refs)}</p>`;
};

/* ---------- 技能引用标记 ----------
 * 天赋文本里提到具体技能时（元素战技柔板·幻灵夜舞 / 元素爆发「疾板·苍羽一梦」/ 突破天赋「落羽的裁择」），
 * 用 .rt-skill 另标一色，与「加强文本」的 .rt-buff 区分。
 * 名字来源：本角色的天赋 / 固有天赋 / 命座名 + 正文里的「…」引号名，
 * 以及关键词后面「前置词·后置词」式的专门技能名（如特殊的元素战技柔板·破晓终奏）。 */
const REF_KEYWORD = '突破天赋|固有天赋|命之座|普通攻击|下落攻击|瞄准射击|重击|元素战技|元素爆发|天赋';
/* 未知名的截断规则：遇到这些接续词/标点就认为名字结束 */
const REF_STOP_RE = /[，。；、：！？（）()「」\s]|后|时|的|将|会|中|内|以|与|和|及|或|等|获|进|造|命|施|召|使|为|能|可|按|每|若|当|在|并|则|也|还|而|被|向|从|至|到|由|因|于|落|地|持续|触发|造成|效果|技能|状态|解除|结束|提升|增加|命中|攻击|伤害|强化/;
/* 名字尾部可能粘上的虚词/动词（截断后再清一遍，如「重击·冰凝无效」→「重击·冰凝」） */
const REF_TAIL_RE = /[改无效应地时后中会能有造触得并也还而将期间]+$/;
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function skillRefRegex(profile) {
  const texts = [
    ...(profile.skills || []).flatMap(s => [s.description, s.lore, ...(s.states || []).map(x => x.text)]),
    ...(profile.passives || []).map(p => p.description),
    ...(profile.constellations || []).map(c => c.description),
  ].filter(Boolean).join('\n');

  const known = new Set();
  for (const list of [profile.skills, profile.passives, profile.constellations]) {
    for (const it of list || []) if (it.name) known.add(it.name);
  }
  // 状态说明块的名字（如「踏云献瑞」）也会在正文里被关键词引用
  for (const s of profile.skills || []) for (const st of s.states || []) if (st.name) known.add(st.name);
  for (const m of texts.matchAll(/「[^」]{2,24}」/g)) known.add(m[0]);

  const alt = [...known].filter(n => n.length >= 2).sort((a, b) => b.length - a.length).map(escapeRegExp);
  const parts = [];
  if (alt.length) parts.push(alt.join('|'));
  parts.push('·?[\\u4e00-\\u9fa5]{1,4}·[\\u4e00-\\u9fa5]{1,8}');   // 前置词·后置词（如 柔板·破晓终奏）
  parts.push('·[\\u4e00-\\u9fa5]{1,8}');                            // 关键词·名字（如 普通攻击·迅烈倾霜拳）
  return { re: new RegExp(`(${REF_KEYWORD})(${parts.join('|')})`, 'g'), known };
}

/* 只在标签之外的文本节点里替换，不破坏已有的 span 结构 */
function markSkillRefs(html, refs) {
  if (!refs) return html;
  const { re, known } = refs;
  return String(html).replace(/(^|>)([^<]+)/g, (_m, lead, text) => lead + text.replace(re, (_full, kw, name) => {
    let n = name;
    if (!known.has(n) && !n.startsWith('「')) {
      const i = n.search(REF_STOP_RE);
      if (i > 0) n = n.slice(0, i);
      n = n.replace(REF_TAIL_RE, '');
    }
    if (!n || n === '·') return kw + name;
    return `<span class="rt-skill">${kw}${n}</span>` + name.slice(n.length);
  }));
}

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

/* 属性面板：生命值 / 攻击力 / 防御力 / 突破属性 + 等级滑块（与武器同一套组件） */
function statsSection(profile, meta) {
  const st = profile?.stats;
  if (!st || !Array.isArray(st.hp)) return '';
  return `
      <section class="card char-stats" style="--el-color:${meta.color}">
        <h2 style="margin-top:0">属性</h2>
        ${levelSimHtml({
          maxLevel: st.maxLevel || 90,
          value: st.maxLevel || 90,
          cells: [
            { key: 'hp', label: '生命值' },
            { key: 'attack', label: '攻击力' },
            { key: 'defense', label: '防御力' },
            { key: 'specialized', label: st.label || '突破属性' },
          ],
        })}
      </section>`;
}

function bindStatsSection(root, profile) {
  const st = profile?.stats;
  if (!st || !Array.isArray(st.hp)) return;
  bindLevelSim(root, {
    series: { hp: st.hp, attack: st.attack, defense: st.defense, specialized: st.specialized },
    pre: { hp: st.preHp, attack: st.preAttack, defense: st.preDefense, specialized: st.preSpecialized },
    format: {
      hp: 'int',
      attack: 'int',
      defense: 'int',
      specialized: st.percent ? 'pct' : 'int',
    },
    maxLevel: st.maxLevel || 90,
  });
}

/* 有本地资料的角色：左上天赋描述 + 右上等级选择 + 下方附着/产球表 */
function renderDetailProfile(root, char, meta, profile) {
  const groups = groupAttachmentRows(char.skills);
  const refs = skillRefRegex(profile);

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
            ${descHtml(sk, refs)}
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
      ${descHtml(t, refs)}
      ${attachmentTable(rows)}
    </article>`;

  const constellationCards = (profile.constellations || []).map(c => {
    const rows = groups.constellations[c.level] || [];
    return `
      <article class="talent-card compact constellation-panel" data-constellation="${c.level}" ${c.level === 1 ? '' : 'hidden'}>
        ${descHtml(c, refs)}
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

      ${statsSection(profile, meta)}

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
  bindStatsSection(root, profile);
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
