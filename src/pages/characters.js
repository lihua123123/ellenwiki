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
import { initTooltip } from '../core/tooltip.js';
import { levelSimHtml, bindLevelSim } from '../core/level-sim.js';
import { elementLabels, elementIds, weaponTypes, characters } from '../data/characters.js';
import { elementIcons, weaponIcons } from '../assets/icons.js';
import { initChargeTimeline } from './charge-timeline.js';
import { elementVariant } from '../core/palette.js';

/* 角色轻量索引（列表/排序用，构建时由 scripts/gen-char-index.mjs 生成，~30KB）：
 * { 名称: { version, rarity, title } }。完整资料改为详情页按需 fetch /api/characters/<名称>.json，
 * 不再把 127 份角色 JSON 全打进 bundle（见 P4 优化）。 */
import charIndexData from '../data/char-index.json';
const CHAR_INDEX = charIndexData;

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

/* 元素 id ↔ 主题色（取自 src/data/palette.json） */
const ELEMENT_META = {
  fire:    { color: elementVariant('pyro', 'color'), iconLabel: '火系' },
  water:   { color: elementVariant('hydro', 'color'), iconLabel: '水系' },
  thunder: { color: elementVariant('electro', 'color'), iconLabel: '雷系' },
  ice:     { color: elementVariant('cryo', 'color'), iconLabel: '冰系' },
  wind:    { color: elementVariant('anemo', 'color'), iconLabel: '风系' },
  rock:    { color: elementVariant('geo', 'color'), iconLabel: '岩系' },
  grass:   { color: elementVariant('dendro', 'color'), iconLabel: '草系' },
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
  ['V7.2.0', [
    '新增「我的角色」页面（侧边栏 → 我的角色）：导入米游社取数结果，按公式表格的平均词条值统计副词条并降序排列',
    '取数在米游社官方页面内完成，数据只存 sessionStorage（关闭标签页自动清除），全程不经服务器',
  ]],
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

/* 天赋 / 命之座图标（enka CDN；缺 iconUrl 的角色——如体验服新增——自然不显示） */
function talentIconHtml(item, cls = 'talent-icon') {
  return item?.iconUrl
    ? `<img class="${cls}" src="${escapeHtml(item.iconUrl)}" alt="" loading="lazy" />`
    : '';
}

/* 拍平角色数据并补上元素字段，再按实装版本倒序（新角色在前）；
 * 版本来自 content/characters/<名>.json 的 version 字段（内容管线写入），
 * 暂无版本的排在最后 */
const versionParts = (v) => String(v || '').split('.').map(Number);
function versionRank(name) {
  const v = CHAR_INDEX[name]?.version;
  if (!v) return [-1, -1];
  const p = versionParts(v);
  return [p[0] || 0, p[1] || 0];
}
const ALL_CHARACTERS = elementIds
  .flatMap(el => (characters[el] || []).map(c => ({ ...c, element: el })))
  .sort((a, b) => {
    const [am, an] = versionRank(a.name);
    const [bm, bn] = versionRank(b.name);
    const ar = CHAR_INDEX[a.name]?.rarity || 0;
    const br = CHAR_INDEX[b.name]?.rarity || 0;
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
    return `color:${elementVariant('anemo', 'soft')};font-weight:600;`;
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
          <button class="fbtn fbtn-icon" data-element="${id}" title="${elementLabels[id]}" style="--el-color:${ELEMENT_META[id].color}">
            ${iconImg(elementIcons, ELEMENT_META[id].iconLabel)}
          </button>`).join('')}
      </div>
      <div class="filter-row" role="group" aria-label="按武器筛选（可多选，不选为全部）">
        ${weaponTypes.map(w => `
          <button class="fbtn fbtn-icon" data-weapon="${w}" title="${w}">
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
      const rar = CHAR_INDEX[c.name]?.rarity;
      const rarCls = rar === 5 ? 'r5' : rar === 4 ? 'r4' : '';
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

/* ============ 工具页（充能时间轴） ============ */
function renderTools(root) {
  root.innerHTML = `
    <header class="page-header">
      <h1>充能时间轴</h1>
    </header>

    <div class="subnav-tabs" role="tablist">
      <a href="#/characters">角色</a>
      <a href="#/characters/tools" class="active">工具</a>
    </div>

    <div id="ct-root"></div>

    <details class="card changelog">
      <summary>更新日志</summary>
      ${CHANGELOG.map(([ver, items]) => `
        <h3>${ver}</h3>
        <ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`).join('')}
      <p class="changelog-sign">--艾莲其实是爱恋的意思</p>
    </details>
  `;
  initChargeTimeline(root.querySelector('#ct-root'));
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

/* 把产球/附着行按名称归入天赋分组：普攻/重击→attack，E→skill，Q→burst，冲刺→sprint，
 * 命座N→constellation N，突破/固有天赋N→passive N（归入突破天赋卡片） */
function groupAttachmentRows(rows) {
  const groups = { attack: [], skill: [], burst: [], sprint: [], other: [], passives: [] };
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
    } else if (n.includes('冲刺')) {
      groups.sprint.push(s);
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
  /* 固定值天赋（如「替代冲刺」）只有 1 级：只列数值，不上无法使用的等级步进器 */
  if (maxLevel <= 1) {
    return `
    <div class="level-panel fixed" data-max="1">
      <div class="level-select-label"><span>天赋数值</span></div>
      <div class="level-rows">${rows}</div>
    </div>`;
  }
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

/* 文本段落换行；<buff>…</buff> 标记（由内容管线写入）转成加强色 */
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
 * 有 buffs.description（加强版文本，只给新增片段包了 <buff>）时优先渲染它。 */
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

/* 角色逸闻：附录色斜体，纯展示不做悬停提示 */
const loreHtml = (lore) => lore
  ? `<br><span class="talent-lore">${textHtml(lore)}</span>`
  : '';

/* 天赋类型 / 命之座序号：跟在名称后面，用与逸闻同款的小字斜体样式 */
const talentKindHtml = (text) => text
  ? `<span class="talent-kind">${escapeHtml(text)}</span>`
  : '';

/* 页面加载后绑定等级选择器事件 */
function bindLevelSelectors(root) {
  root.querySelectorAll('.level-panel').forEach(panel => {
    const current = panel.querySelector('.level-current');
    if (!current) return;   /* 固定值天赋没有等级步进器 */
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

/* ============ 角色档案（立绘 / 装扮 / 名片 / 料理 / 资料 / 故事） ============ */

/* 图片统一走 enka CDN（与天赋图标同源）：档案 JSON 只存图标名，不存完整 URL */
const ENKA_UI = 'https://enka.network/ui';
const uiUrl = (name) => (name ? `${ENKA_UI}/${name}.png` : '');

/* 文本 → 段落（源文本用单个 \n 分段） */
const paragraphs = (text) => String(text || '')
  .split(/\n+/)
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => `<p>${escapeHtml(p)}</p>`)
  .join('');

/* 语音分区：战斗/成长 → 关于/了解 → 其余（闲聊、天气、问候、喜好…） */
const VOICE_BATTLE_RE = /元素战技|元素爆发|冲刺|风之翼|宝箱|生命值低|倒下|重受击|加入队伍|突破的感受/;
function voiceGroup(title) {
  const t = String(title || '');
  if (VOICE_BATTLE_RE.test(t)) return '战斗与成长';
  if (/^关于|^想要了解/.test(t)) return '关于与了解';
  return '闲聊与问候';
}

/* 统一的折叠外壳：标题 + 右侧摘要 + 正文 */
function archiveDetails(key, label, meta, body) {
  return `
    <details class="archive-item" data-archive="${key}">
      <summary>
        <span class="archive-label">${escapeHtml(label)}</span>
        ${meta ? `<span class="archive-meta">${escapeHtml(meta)}</span>` : ''}
      </summary>
      <div class="archive-body">${body}</div>
    </details>`;
}

const splashBody = (a, name) => (a.splash ? `
  <figure class="splash-wrap">
    <img class="splash-img" src="${escapeHtml(uiUrl(a.splash))}" alt="${escapeHtml(name)} 立绘" loading="lazy" decoding="async" onerror="this.closest('details').remove()" />
  </figure>` : '');

const costumeBody = (a) => (a.costumes?.length ? `
  <div class="costume-grid">
    ${a.costumes.map((c) => `
      <article class="costume-card">
        <span class="costume-thumb"><img src="${escapeHtml(uiUrl(c.icon || a.icon))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" /></span>
        <div class="costume-text">
          <h4>${escapeHtml(c.name)}${c.isDefault ? '<span class="archive-tag">默认</span>' : ''}</h4>
          ${c.desc ? `<p>${escapeHtml(c.desc)}</p>` : ''}
        </div>
      </article>`).join('')}
  </div>` : '');

const nameCardBody = (a) => {
  const nc = a.nameCard;
  if (!nc) return '';
  const pic = nc.pic ? uiUrl(`${nc.pic}_P`) : '';
  return `
    <div class="namecard">
      ${pic ? `<div class="namecard-pic-wrap"><img class="namecard-pic" src="${escapeHtml(pic)}" alt="${escapeHtml(nc.name)}" loading="lazy" /></div>` : ''}
      <div class="namecard-info">
        ${nc.icon ? `<img class="namecard-icon" src="${escapeHtml(uiUrl(nc.icon))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />` : ''}
        <div class="namecard-text">
          <h4>${escapeHtml(nc.name)}</h4>
          ${nc.desc ? paragraphs(nc.desc) : ''}
        </div>
      </div>
    </div>`;
};

/* 特色料理图标偶有 CDN 缺图（新版本物料滞后），失败时回退到原始料理图标 */
const dishCardHtml = (item, label, fallbackIcon) => (item ? `
  <article class="dish-card">
    <span class="dish-thumb">${item.icon ? `<img src="${escapeHtml(uiUrl(item.icon))}" alt="" loading="lazy"
      data-fallback="${escapeHtml(uiUrl(fallbackIcon))}"
      onerror="if(this.dataset.fallback&&this.src!==this.dataset.fallback){this.src=this.dataset.fallback}else{this.style.visibility='hidden'}" />` : ''}</span>
    <span class="dish-kind">${escapeHtml(label)}</span>
    <span class="dish-name">${escapeHtml(item.name)}</span>
  </article>` : '');

const dishBody = (a) => {
  if (!a.dish) return '';
  const sp = a.dish.special || {};
  return `
    <div class="dish-row">
      ${dishCardHtml(a.dish.special, '特色料理', a.dish.origin?.icon)}
      ${dishCardHtml(a.dish.origin, '原始料理')}
      <div class="dish-text">
        ${sp.desc ? `<p class="dish-desc">${escapeHtml(sp.desc)}</p>` : ''}
        ${sp.effect ? `<p class="dish-effect"><span class="dish-effect-label">效果</span>${escapeHtml(sp.effect)}</p>` : ''}
      </div>
    </div>`;
};

/* 基础档案：称号 / 所属 / 生日 / 神之眼 / 命之座 / 声优 */
const infoGrid = (info) => {
  if (!info) return '';
  const rows = [
    ['称号', info.title],
    ['所属', info.native],
    ['生日', info.birthday],
    ['神之眼', [info.visionType, info.vision].filter(Boolean).join(' · ')],
    ['命之座', info.constellation],
  ].filter(([, v]) => v);
  const cv = info.cv || {};
  const cvs = [['中', cv.cn], ['日', cv.jp], ['英', cv.en], ['韩', cv.kr]].filter(([, v]) => v);
  return `
    <dl class="info-grid">
      ${rows.map(([k, v]) => `<div class="info-cell"><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
      ${cvs.length ? `<div class="info-cell info-cv"><dt>声优</dt><dd>${cvs.map(([k, v]) => `<span class="cv-item"><span class="cv-lang">${k}</span>${escapeHtml(v)}</span>`).join('')}</dd></div>` : ''}
    </dl>`;
};

const voiceBody = (a) => {
  if (!a.voices?.length) return '';
  const groups = new Map();
  for (const v of a.voices) {
    const g = voiceGroup(v.title);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  return `
    <div class="voice-groups">
      ${[...groups].map(([g, list]) => `
        <section class="voice-group">
          <h4 class="voice-group-title">${g}<span class="archive-count">${list.length}</span></h4>
          ${list.map((v) => `
            <details class="voice-item">
              <summary>${escapeHtml(v.title)}</summary>
              ${paragraphs(v.text)}
            </details>`).join('')}
        </section>`).join('')}
    </div>`;
};

const storyBody = (a) => (a.stories?.length ? `
  <div class="story-list">
    ${a.stories.map((s) => `
      <details class="story-item">
        <summary>${escapeHtml(s.title)}</summary>
        <div class="story-body">${paragraphs(s.text)}</div>
      </details>`).join('')}
  </div>` : '');

/* 角色档案整块：命之座之后，六个折叠项（全部默认收起） */
function archiveSection(archive, name) {
  if (!archive) return '';
  const items = [];
  if (archive.splash) items.push(archiveDetails('splash', '立绘', '', splashBody(archive, name)));
  if (archive.costumes?.length) items.push(archiveDetails('costume', '装扮', `${archive.costumes.length} 套`, costumeBody(archive)));
  if (archive.nameCard) items.push(archiveDetails('namecard', '名片', archive.nameCard.name || '', nameCardBody(archive)));
  if (archive.dish) items.push(archiveDetails('dish', '料理', archive.dish.special?.name || '', dishBody(archive)));
  if (archive.info || archive.voices?.length) {
    items.push(archiveDetails('voice', '资料', archive.voices?.length ? `${archive.voices.length} 条语音` : '', `${infoGrid(archive.info)}${voiceBody(archive)}`));
  }
  if (archive.stories?.length) items.push(archiveDetails('story', '故事', `${archive.stories.length} 篇`, storyBody(archive)));
  if (!items.length) return '';
  return `
      <section class="talent-section char-archive">
        <h2>角色档案</h2>
        <div class="archive-list">${items.join('')}</div>
      </section>`;
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

function renderDetailPlain(root, char, meta, archive) {
  const groups = groupAttachmentRows(char.skills);
  const restRows = [
    ...groups.sprint,
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
      ${archiveSection(archive, char.name)}
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
function renderDetailProfile(root, char, meta, profile, archive) {
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
              ${talentIconHtml(sk)}
              <h3 class="talent-name">${escapeHtml(sk.name || '')}</h3>
              ${talentKindHtml(sk.type || '')}
            </header>
            ${descHtml(sk, refs)}
          </div>
          ${hasLevels ? levelSelector(sk) : ''}
        </div>
        ${attachmentTable(rows)}
      </article>`;
  }).join('');

  /* 没有「替代冲刺」天赋的角色：其附着行仍归入「其他」，不因分组而丢行 */
  if (!(profile.skills || []).some(sk => sk.id === 'sprint') && groups.sprint.length) groups.other.push(...groups.sprint);

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
      <header class="talent-head">${talentIconHtml(t)}<h3 class="talent-name">${escapeHtml(t.name)}</h3></header>
      ${descHtml(t, refs)}
      ${attachmentTable(rows)}
    </article>`;

  const constellationCards = (profile.constellations || []).map(c => {
    const rows = groups.constellations[c.level] || [];
    return `
      <article class="talent-card compact constellation-panel" data-constellation="${c.level}" ${c.level === 1 ? '' : 'hidden'}>
        <div class="constellation-body">
          ${talentIconHtml(c)}
          <div class="constellation-text">${descHtml(c, refs)}</div>
        </div>
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

      ${archiveSection(archive, char.name)}

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

/* 角色完整资料：import.meta.glob 懒加载（与敌人图鉴同模式，纯静态可用，不依赖 /api） */
const profileLoaders = import.meta.glob('../../content/characters/*.json');

/* 角色档案（立绘/装扮/名片/料理/资料/故事）：独立子目录，由 scripts/fetch-avatar-archive.mjs 生成 */
const archiveLoaders = import.meta.glob('../../content/characters/archive/*.json');

async function loadArchive(name) {
  const loader = archiveLoaders[`../../content/characters/archive/${name}.json`];
  if (!loader) return null;
  try {
    const mod = await loader();
    return mod.default || mod;
  } catch {
    return null;
  }
}

async function renderDetail(root, char) {
  const meta = ELEMENT_META[char.element];
  root.innerHTML = '<div class="route-loading">加载角色详情…</div>';
  const archivePromise = loadArchive(char.name);
  let profile = null;
  /* ① 优先走 R2 版本化数据：/api/wiki/* 由 Worker 映射到 releases/{v}/data/wiki/... */
  try {
    const res = await fetch(`/api/wiki/characters/${encodeURIComponent(char.name)}.json`, { headers: { Accept: 'application/json' } });
    if (res.ok && (res.headers.get('content-type') || '').includes('json')) profile = await res.json();
  } catch { /* 网络异常 → 回退打包 chunk */ }
  /* ② 兜底：打包内 content/characters/<名>.json（离线/断网可用） */
  if (!profile) {
    const loader = profileLoaders[`../../content/characters/${char.name}.json`];
    if (loader) {
      try {
        const mod = await loader();
        profile = mod.default || mod;
      } catch { /* 损坏 → 退化为纯文本详情 */ }
    }
  }
  const archive = await archivePromise;
  if (profile) {
    renderDetailProfile(root, char, meta, profile, archive);
  } else {
    renderDetailPlain(root, char, meta, archive);
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
