/**
 * enemies.js — 敌人图鉴模块。
 * 数据源：src/data/enemies/（由 scripts/generate-enemies.py 从 GIEnemyChartXML 源生成）。
 *   index.json           列表索引（分类 + 卡片字段）
 *   items/<id>.json      详情（基础数值 / 抗性 / 技能 / 护盾 / 注解 / 幽境挑战）
 * 路由：#/enemies（列表）  #/enemies/:id（详情）
 */
import '../styles/enemies.css';
import enemyIndex from '../data/enemies/index.json';
import { renderRichText } from '../core/richtext.js';

/* 详情数据按需加载：每个敌人一个独立 chunk（列表只带索引） */
const detailLoaders = import.meta.glob('../data/enemies/items/*.json');

/* 抗性表元素列（固定顺序）；physical 站内无配色类，走物理灰 */
const RES_ELEMENTS = [
  { key: 'pyro', label: '火', cls: 'pyro' },
  { key: 'hydro', label: '水', cls: 'hydro' },
  { key: 'anemo', label: '风', cls: 'anemo' },
  { key: 'electro', label: '雷', cls: 'electro' },
  { key: 'dendro', label: '草', cls: 'dendro' },
  { key: 'cryo', label: '冰', cls: 'cryo' },
  { key: 'geo', label: '岩', cls: 'geo' },
  { key: 'physical', label: '物理', cls: 'rt-physical' },
];

/* 跨分类标签：只作条目标记，不参与分类筛选 */
const VETERAN_TAG = '历经百战';

const TIER_LABELS = {
  Legend: '地方传奇',
  Boss: '首领',
  Weekly: '周本',
  Elite: '精英',
  Common: '普通',
  Animal: '动物',
  Quest: '剧情',
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const img = (id, file) => file ? `./images/enemies/${encodeURIComponent(id)}/${encodeURIComponent(file)}` : '';

/* 中式四位分节：1,0000 / 1234,5678（英式 3 位 → 中文 4 位） */
function groupDigits(str) {
  return String(str).replace(/(\d)(?=(\d{4})+(?!\d))/g, '$1,');
}

function formatNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return groupDigits(n);
}

/* 富文本里的长数字也按四位分节（只动标签之间的文本，避开色值/属性） */
function groupTextNumbers(html) {
  return String(html || '').split(/(<[^>]*>)/).map(part =>
    part.startsWith('<') ? part
      : part.replace(/(?<![\d.,])(\d{5,})(?![\d.,])/g, d => groupDigits(d))).join('');
}

/* 抗性状态表（基础 / 幽境共用） */
function resistanceTable(states) {
  if (!states || !states.length) return '<p class="empty-hint">暂无数据</p>';
  const rows = states.map(st => `
    <tr>
      <th class="res-state">${escapeHtml(st.name)}</th>
      ${RES_ELEMENTS.map(el => {
        const v = st[el.key];
        const num = Number(v);
        const hot = v !== undefined && v !== '—' && num >= 60 ? ' res-hot' : num < 0 ? ' res-neg' : '';
        const txt = v === undefined || v === null ? '—' : (typeof v === 'string' ? v : `${v}%`);
        return `<td class="res-val${hot}">${txt}</td>`;
      }).join('')}
    </tr>`).join('');
  return `
    <div class="table-wrap"><table class="res-table">
      <thead><tr><th>状态</th>${RES_ELEMENTS.map(el =>
        `<th class="${el.cls}">${el.label}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

/* 行内标签（span/code/strong）内部的换行是源图的排版折行（如 `75%/⏎49%`），直接去掉；
 * 标签外层的换行才作为语义断行保留 */
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'wbr']);
function dropWrapBreaks(html) {
  let depth = 0;
  return String(html || '').split(/(<[^>]*>)/).map(t => {
    if (t.startsWith('<')) {
      const m = /^<\/?\s*([a-zA-Z0-9-]+)/.exec(t);
      if (m) {
        if (/^<\//.test(t)) depth = Math.max(0, depth - 1);
        else if (!VOID_TAGS.has(m[1].toLowerCase()) && !/\/>$/.test(t)) depth++;
      }
      return t;
    }
    return depth > 0 ? t.replace(/\n/g, '') : t;
  }).join('');
}

/* 正文排版：空行分段（<p>），段内单换行保留 <br>，长数字四位分节 */
function bodyTextHtml(text) {
  const html = dropWrapBreaks(groupTextNumbers(renderRichText(text || '')));
  const paras = html.split(/\n{2,}/)
    .map(chunk => chunk.replace(/\n/g, '<br>').trim())
    .filter(Boolean);
  return paras.map(p => `<p>${p}</p>`).join('');
}

/* 技能列表（基础 / 幽境共用） */
function skillList(skills, id, iconPrefix) {
  if (!skills || !skills.length) return '<p class="empty-hint">暂无数据</p>';
  return `<div class="enemy-skill-list">${skills.map((sk, i) => `
    <div class="enemy-skill">
      ${sk.icon ? `<img class="enemy-skill-icon" src="${img(id, sk.icon)}" alt="" loading="lazy" />` : ''}
      <div class="enemy-skill-body">
        <div class="enemy-skill-head">
          <span class="enemy-skill-name">${escapeHtml(sk.name)}</span>
          ${sk.type ? `<span class="chip enemy-skill-type">${escapeHtml(sk.type)}</span>` : ''}
        </div>
        <div class="enemy-skill-desc">${bodyTextHtml(sk.description)}</div>
      </div>
    </div>`).join('')}</div>`;
}

/* 图鉴注解：与技能同款卡片（无图标），标题 + 正文同处一卡 */
function notesBlocks(notes) {
  if (!notes || !notes.length) return '<p class="empty-hint">暂无数据</p>';
  return `<div class="enemy-skill-list">${notes.map(n => `
    <div class="enemy-skill enemy-note">
      <div class="enemy-skill-body">
        <div class="enemy-skill-head">
          <span class="enemy-skill-name">${escapeHtml(n.text)}</span>
        </div>
        <div class="enemy-skill-desc">${bodyTextHtml(n.desc)}</div>
      </div>
    </div>`).join('')}</div>`;
}

/* 成长曲线换算：value(level) = BaseValue × 曲线倍率[level-1] */
function scaledStat(base, curves, level) {
  if (!base || base.Value === '' || base.Value == null) return null;
  const factors = (curves || {})[base.Curve];
  const f = factors ? factors[level - 1] : null;
  return typeof f === 'number' ? Math.round(Number(base.Value) * f) : null;
}

/* 系数记法：绝对值 ÷ 该级曲线倍率 → 「多少H/F/P / B1/B2」（与游戏源数据一致） */
const CURVE_UNIT = { HP_1: 'H', HP_2: 'F', HP_3: 'P', ATK_1: 'B1', ATK_2: 'B2' };

function coeffText(absVal, curveName, curves, level) {
  if (absVal === null || absVal === undefined || absVal === '') return '—';
  const factors = (curves || {})[curveName];
  const f = factors ? factors[level - 1] : null;
  if (typeof f === 'number' && f > 0) {
    return `${(Number(absVal) / f).toFixed(1)}${CURVE_UNIT[curveName] || ''}`;
  }
  return formatNum(absVal);
}

/* 突破节点在轨道上的位置（与 level-sim.js 一致） */
const tickPos = (lv, maxLevel, thumb = 18) => {
  const p = (lv - 1) / (maxLevel - 1);
  return `calc(${(p * 100).toFixed(3)}% + ${((0.5 - p) * thumb).toFixed(2)}px)`;
};

/* 基础数值（角色属性面板式：数值卡片 + 等级滑块 + 系数表） */
const LEVEL_MAX = 110;

function baseStatsHtml(entry, curves, initialLevel) {
  const bs = entry.baseStats || {};
  const rows = entry.levelRows || [];
  const hpCurve = (bs.hp || {}).Curve;
  const atkCurve = (bs.atk || {}).Curve;

  /* 重量 / 韧性：从等级行里取（各档位相同），直接放进数值卡片 */
  const weight = (rows.find(r => r.weight != null) || {}).weight;
  const tenacity = (rows.find(r => r.tenacity != null) || {}).tenacity;

  const lv0 = Math.min(LEVEL_MAX, Math.max(1,
    initialLevel || entry.defaultLevel || (rows[0] || {}).level || 100));
  const hp0 = scaledStat(bs.hp, curves, lv0);
  const atk0 = scaledStat(bs.atk, curves, lv0);

  /* 数值卡片（生命值 / 攻击力随滑块联动；重量 / 韧性常驻） */
  const cells = [];
  if (hp0 !== null) cells.push({ id: 'lv-hp', label: '生命值', value: formatNum(hp0) });
  if (atk0 !== null) cells.push({ id: 'lv-atk', label: '攻击力', value: formatNum(atk0) });
  if (weight != null) cells.push({ label: '重量', value: String(weight) });
  if (tenacity != null) cells.push({ label: '韧性', value: String(tenacity) });

  /* 滑块刻度 = 等级行所在级 */
  const tickLevels = [...new Set(rows.map(r => r.level))]
    .filter(l => l >= 1 && l <= LEVEL_MAX)
    .sort((a, b) => a - b);

  const hasSlider = hp0 !== null || atk0 !== null;
  const mainLabel = (cells.length && entry.statVariants && entry.statVariants.length)
    ? ((rows.find(r => r.level === lv0) || rows[0] || {}).label || '等级')
    : '等级';
  const sliderHtml = (cells.length || hasSlider) ? `
    <div class="level-sim">
      ${cells.length ? `<div class="stat-row">${cells.map(c => `
        <div class="stat-cell">
          <span class="stat-label">${escapeHtml(c.label)}</span>
          <span class="stat-value"${c.id ? ` id="${c.id}"` : ''}>${c.value}</span>
        </div>`).join('')}</div>` : ''}
      ${hasSlider ? `
      <div class="level-slider-head">
        <span class="level-slider-label">${escapeHtml(mainLabel)}</span>
        <span class="level-current" id="lv-val">${lv0}</span>
      </div>
      <div class="level-track">
        <input type="range" class="level-range" id="lv-range" min="1" max="${LEVEL_MAX}" step="1"
               value="${lv0}" aria-label="等级" />
        <div class="level-ticks">
          ${tickLevels.map(lv => `
            <button type="button" class="level-tick${lv === lv0 ? ' active' : ''}" data-level="${lv}"
                    style="left:${tickPos(lv, LEVEL_MAX)}" title="跳到 ${lv} 级">
              <span class="level-tick-dot"></span><span class="level-tick-num">${lv}</span>
            </button>`).join('')}
        </div>
      </div>` : ''}
    </div>` : '';

  /* 档位表：档位 | HP（系数记法） | ATK（系数记法） */
  const tableRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${coeffText(r.hp, hpCurve, curves, r.level)}${r.hpNote ? ` <span class="stat-note">${escapeHtml(r.hpNote)}</span>` : ''}</td>
      <td>${coeffText(r.atk, atkCurve, curves, r.level)}${r.atkNote ? ` <span class="stat-note">${escapeHtml(r.atkNote)}</span>` : ''}</td>
    </tr>`).join('');

  /* 额外属性卡（合并进来的变体档，如秘影重现 Lv.100）：静态展示，不参与滑块换算 */
  const variants = entry.statVariants || [];
  const variantHtml = variants.length ? `
    <div class="stat-variants">${variants.map(v => `
      <div class="level-sim stat-variant">
        <div class="level-slider-head">
          <span class="level-slider-label">${escapeHtml(v.label || '变体')}</span>
          <span class="level-current">Lv.${v.level}</span>
        </div>
        <div class="stat-row">
          ${v.hp != null ? `<div class="stat-cell"><span class="stat-label">生命值</span><span class="stat-value">${formatNum(v.hp)}${v.hpNote ? `<span class="stat-note"> ${escapeHtml(v.hpNote)}</span>` : ''}</span></div>` : ''}
          ${v.atk != null ? `<div class="stat-cell"><span class="stat-label">攻击力</span><span class="stat-value">${formatNum(v.atk)}${v.atkNote ? `<span class="stat-note"> ${escapeHtml(v.atkNote)}</span>` : ''}</span></div>` : ''}
          ${v.weight != null ? `<div class="stat-cell"><span class="stat-label">重量</span><span class="stat-value">${escapeHtml(String(v.weight))}</span></div>` : ''}
          ${v.tenacity != null ? `<div class="stat-cell"><span class="stat-label">韧性</span><span class="stat-value">${escapeHtml(String(v.tenacity))}</span></div>` : ''}
        </div>
      </div>`).join('')}</div>` : '';

  const tableHtml = rows.length ? `
    <div class="table-wrap"><table class="res-table stat-table">
      <thead><tr><th>档位</th><th>HP</th><th>ATK</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <p class="section-note">系数说明：<b>H</b>=1丘丘人生命值 · <b>F</b>=1蕈兽生命值 · <b>P</b>=1机关·水下巡游型生命值 · <b>B1</b>=1老猪攻击力 · <b>B2</b>=1新猪/浮舍攻击力</p>` : '';

  if (!sliderHtml && !tableHtml && !variantHtml) return '<p class="empty-hint">暂无数据</p>';
  return `${sliderHtml}${variantHtml}${tableHtml}`;
}

/* 掉落能量（随血量变化的调度表） */
function energyHtml(energy) {
  if (!energy || !energy.rows || !energy.rows.length) return '';
  const rows = energy.rows.map(r => `
    <tr>
      <td>${r.hp}%</td>
      <td>${r.particle ? `${r.particle} 个` : '—'}</td>
      <td>${r.orb ? `${r.orb} 个` : '—'}</td>
    </tr>`).join('');
  return `
    <section class="enemy-section">
      <h2 class="section-title">掉落能量</h2>
      <div class="table-wrap"><table class="res-table energy-table">
        <thead><tr><th>血量阈值</th><th>元素微粒</th><th>元素微粒球</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
}

/* ============ 列表页 ============ */
function renderList(root) {
  const enemies = enemyIndex.enemies || [];

  // 筛选胶囊只列「分类」；「历经百战」这类跨分类标签只作条目标签（卡片徽章），不再单独成类
  const allTags = [];
  for (const c of (enemyIndex.categories || [])) {
    if (c.label && !allTags.includes(c.label)) allTags.push(c.label);
  }

  root.innerHTML = `
    <header class="page-header">
      <h1>敌人图鉴</h1>
      <p class="page-subtitle">ENEMY ARCHIVE · 共 ${enemies.length} 名敌人 · 点击查看档案详情</p>
    </header>

    <div class="filter-bar" id="enemy-filter">
      <div class="filter-row" role="group" aria-label="按标签筛选">
        <button class="fbtn active" data-tag="__all">全部</button>
        ${allTags.map(t => `
          <button class="fbtn" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
      <input type="search" id="enemy-search" placeholder="搜索敌人名…" aria-label="搜索敌人名" />
    </div>

    <div class="enemy-grid" id="enemy-grid"></div>
    <p class="empty-hint" id="enemy-empty" hidden>没有符合条件的敌人</p>
  `;

  const selTags = new Set();
  let keyword = '';
  const grid = root.querySelector('#enemy-grid');
  const emptyHint = root.querySelector('#enemy-empty');

  function applyFilter() {
    const list = enemies.filter(e => {
      const tagOk = !selTags.size || (e.tags || []).some(t => selTags.has(t));
      const kw = keyword.toLowerCase();
      const kwOk = !keyword || e.name.includes(keyword) ||
        (e.nameEn || '').toLowerCase().includes(kw) ||
        (e.aliases || []).some(a => a.includes(keyword)) ||
        (e.leyName || '').includes(keyword);
      return tagOk && kwOk;
    });
    grid.innerHTML = list.map(e => `
      <a class="enemy-card card hoverable" href="#/enemies/${encodeURIComponent(e.id)}">
        <span class="enemy-avatar-wrap">
          ${e.icon ? `<img class="enemy-avatar" src="${img(e.id, e.icon)}" alt="${escapeHtml(e.name)}" loading="lazy" />` : '👾'}
        </span>
        <span class="enemy-name">${escapeHtml(e.name)}</span>
        ${e.nameEn ? `<span class="enemy-name-en">${escapeHtml(e.nameEn)}</span>` : ''}
        <span class="enemy-card-meta">
          <span class="chip">${escapeHtml(e.categoryLabel || TIER_LABELS[e.tier] || e.tier)}</span>
          ${(e.tags || []).includes(VETERAN_TAG) ? `<span class="chip chip-veteran">${VETERAN_TAG}</span>` : ''}
          ${e.stateCount > 1 ? `<span class="chip chip-state">${e.stateCount} 形态</span>` : ''}
          ${e.hasLeyline ? '<span class="chip chip-leyline">幽境</span>' : ''}
        </span>
      </a>`).join('');
    emptyHint.hidden = list.length > 0;
  }

  root.querySelectorAll('#enemy-filter [data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const allBtn = root.querySelector('#enemy-filter [data-tag="__all"]');
      if (tag === '__all') {
        selTags.clear();
      } else {
        if (selTags.has(tag)) selTags.delete(tag); else selTags.add(tag);
      }
      root.querySelectorAll('#enemy-filter [data-tag]').forEach(b => {
        const t = b.dataset.tag;
        b.classList.toggle('active', t === '__all' ? selTags.size === 0 : selTags.has(t));
      });
      applyFilter();
    });
  });
  root.querySelector('#enemy-search').addEventListener('input', (e) => {
    keyword = e.target.value.trim();
    applyFilter();
  });

  applyFilter();
}

/* ============ 详情页 ============ */
/* 按难度过滤抗性状态：名称带 (N5)/(N6) 等标记的状态只在对应难度显示，
   未标记的常规状态所有难度都显示 */
/* 按难度过滤抗性状态：diffNote / 名称尾注的 (N5) 视为「N5 起生效、N6 继承」，
   未标记的常规状态只在被标记状态取代前显示 */
function difficultyResistances(resistances, key) {
  const states = resistances || [];
  const markOf = (st) => {
    const fromField = String(st.diffNote || '').match(/N(\d)/i);
    if (fromField) return Number(fromField[1]);
    const m = String(st.name || '').match(/\((N[3-6])\)\s*$/);
    return m ? Number(m[1].slice(1)) : null;
  };
  const keyNum = Number(String(key).replace(/\D/g, '')) || 0;
  let minMark = Infinity;
  for (const st of states) {
    const mk = markOf(st);
    if (mk !== null) minMark = Math.min(minMark, mk);
  }
  return states.filter(st => {
    const mk = markOf(st);
    if (mk !== null) return keyNum >= mk;   // 标记状态：该难度及以上显示
    return keyNum < minMark;                // 常规状态：被标记状态取代前显示
  });
}

function leylineHtml(ley, id) {
  const diffs = ley.difficulties || [];

  return `
  <section class="enemy-section leyline-section">
    <h2 class="section-title">幽境挑战 · <span class="leyline-name">${escapeHtml(ley.name)}</span></h2>
    ${ley.nameEn ? `<p class="section-sub">${escapeHtml(ley.nameEn)}</p>` : ''}

    <div class="leyline-layout">
      ${ley.portrait ? `
      <div class="leyline-portrait-wrap">
        <img class="leyline-portrait" src="${img(id, ley.portrait)}" alt="${escapeHtml(ley.name)}" loading="lazy" />
      </div>` : ''}

      <div class="leyline-main">
        <h3 class="subsection-title">难度数据</h3>
        <div class="diff-tabs" role="tablist">
          ${diffs.map((d, i) => `
            <button class="diff-tab${i === 0 ? ' active' : ''}" data-diff="${i}" role="tab"
                    aria-selected="${i === 0}">${escapeHtml(d.name)} · ${d.key}</button>`).join('')}
        </div>
        ${diffs.map((d, i) => `
        <div class="diff-panel${i === 0 ? ' active' : ''}" data-diff="${i}">
          <div class="stat-row">
            <div class="stat-cell"><span class="stat-label">等级</span><span class="stat-value">Lv.${d.level}</span></div>
            <div class="stat-cell"><span class="stat-label">HP</span><span class="stat-value">${formatNum(d.hp)}</span></div>
            <div class="stat-cell"><span class="stat-label">ATK</span><span class="stat-value">${formatNum(d.atk)}</span></div>
            <div class="stat-cell"><span class="stat-label">HP 倍率</span><span class="stat-value">${d.multiplier ?? '—'}×</span></div>
          </div>
          <h3 class="subsection-title">抗性数据</h3>
          ${resistanceTable(difficultyResistances(ley.resistances, d.key))}
        </div>`).join('')}

        <h3 class="subsection-title">技能变化</h3>
        ${skillList(ley.skills, id, 'leyline-skill')}

        <h3 class="subsection-title">机制说明</h3>
        ${notesBlocks(ley.notes)}
      </div>
    </div>
  </section>`;
}

/* 状态标签页（周本多阶段 / 同场多形态）：第一个状态为默认 */
function stateTabHtml(states, activeIdx) {
  if (!states || states.length < 2) return '';
  return `
    <div class="state-tabs" role="tablist" aria-label="状态切换">
      ${states.map((s, i) => `
        <button class="state-tab${i === activeIdx ? ' active' : ''}" data-state="${i}" role="tab"
                aria-selected="${i === activeIdx}" title="${escapeHtml(s.name || s.label)}">${escapeHtml(s.label)}</button>`).join('')}
    </div>`;
}

async function renderDetail(root, params) {
  const id = decodeURIComponent(params[0] || '');
  const loader = detailLoaders[`../data/enemies/items/${id}.json`];
  if (!loader) {
    root.innerHTML = `<div class="route-error">未找到敌人：${escapeHtml(id)}</div>`;
    return;
  }
  const entry = (await loader()).default;

  /* 多状态：states[] 里每个状态是一页；没有 states 时整条当作唯一状态 */
  const states = Array.isArray(entry.states) && entry.states.length ? entry.states : [];
  let activeIdx = states.length
    ? Math.max(0, states.findIndex(s => s.key === entry.defaultState))
    : 0;
  let userLevel = 0;   // 玩家手动调过的等级；切状态时同步保留
  const active = () => (states.length ? states[activeIdx] : entry);

  const headerSub = () => {
    const st = active();
    if (states.length && st.name && st.name !== entry.name) return st.name;
    return st.subtitle || entry.subtitle || '';
  };

  root.innerHTML = `
    <div class="enemy-detail scope-genshin">
      <a class="back-link" href="#/enemies">← 返回敌人图鉴</a>

      <header class="page-header enemy-detail-header">
        ${entry.icon ? `<img class="enemy-detail-avatar" id="enemy-state-avatar" src="${img(id, entry.icon)}" alt="" />` : ''}
        <div>
          <h1>${escapeHtml(entry.name)}</h1>
          <p class="page-subtitle" id="enemy-state-name"${headerSub() ? '' : ' hidden'}></p>
          ${entry.nameEn ? `<p class="page-subtitle">${escapeHtml(entry.nameEn)}</p>` : ''}
          <div class="enemy-card-meta" id="enemy-state-chips"></div>
        </div>
      </header>

      ${stateTabHtml(states, activeIdx)}

      <div id="state-body"></div>

      ${entry.leyline ? leylineHtml(entry.leyline, id) : ''}
    </div>`;

  const body = root.querySelector('#state-body');
  const subEl = root.querySelector('#enemy-state-name');
  const chipsEl = root.querySelector('#enemy-state-chips');
  const avatarEl = root.querySelector('#enemy-state-avatar');

  function renderHeader() {
    const st = active();
    const sub = headerSub();
    subEl.textContent = sub;
    subEl.hidden = !sub;
    const tierLabel = TIER_LABELS[st.tier] || st.tier || '';
    const chips = [];
    if (entry.categoryLabel) chips.push(entry.categoryLabel);
    if (tierLabel && tierLabel !== entry.categoryLabel) chips.push(tierLabel);
    chipsEl.innerHTML = chips.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
    if (avatarEl && st.icon) avatarEl.src = img(id, st.icon);
  }

  /* 等级滑块：实时换算 HP/ATK（value = BaseValue × 曲线倍率）+ 刻度联动 */
  function bindSlider(st) {
    const lvRange = body.querySelector('#lv-range');
    if (!lvRange) return;
    const lvVal = body.querySelector('#lv-val');
    const lvHp = body.querySelector('#lv-hp');
    const lvAtk = body.querySelector('#lv-atk');
    const bs = st.baseStats || {};
    const ticks = body.querySelectorAll('.level-tick');
    const syncTicks = (lv) => ticks.forEach(t =>
      t.classList.toggle('active', Number(t.dataset.level) === lv));
    lvRange.addEventListener('input', () => {
      const lv = Number(lvRange.value);
      userLevel = lv;
      if (lvVal) lvVal.textContent = lv;
      syncTicks(lv);
      const h = scaledStat(bs.hp, enemyIndex.curves, lv);
      const a = scaledStat(bs.atk, enemyIndex.curves, lv);
      if (lvHp && h !== null) lvHp.textContent = formatNum(h);
      if (lvAtk && a !== null) lvAtk.textContent = formatNum(a);
    });
    ticks.forEach(t => t.addEventListener('click', () => {
      const lv = Number(t.dataset.level);
      lvRange.value = lv;
      lvRange.dispatchEvent(new Event('input'));
    }));
  }

  function renderBody() {
    const st = active();
    const rows = st.levelRows || [];
    const lv0 = Math.min(LEVEL_MAX, Math.max(1,
      userLevel || st.defaultLevel || (rows[0] || {}).level || 100));
    body.innerHTML = `
      <section class="enemy-section">
        <h2 class="section-title">基础数值</h2>
        ${baseStatsHtml(st, enemyIndex.curves, lv0)}
      </section>

      <section class="enemy-section">
        <h2 class="section-title">抗性数据</h2>
        ${resistanceTable(st.resistances)}
      </section>

      ${energyHtml(st.energy)}

      <section class="enemy-section">
        <h2 class="section-title">技能</h2>
        ${skillList(st.skills, id, 'skill')}
      </section>

      <section class="enemy-section">
        <h2 class="section-title">图鉴注解</h2>
        ${notesBlocks(st.notes)}
      </section>`;
    bindSlider(st);
    renderHeader();
  }

  root.querySelectorAll('.state-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeIdx = Number(btn.dataset.state);
      root.querySelectorAll('.state-tab').forEach(b => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      renderBody();
    });
  });

  renderBody();

  // 幽境难度 Tab 切换
  root.querySelectorAll('.diff-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.diff;
      root.querySelectorAll('.diff-tab').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      root.querySelectorAll('.diff-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.diff === key);
      });
    });
  });
}

/* ============ 入口 ============ */
export function initEnemiesPage(root, params = []) {
  if (params.length) {
    renderDetail(root, params);
  } else {
    renderList(root);
  }
}
