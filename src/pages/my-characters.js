/**
 * my-characters.js — 「我的角色」页：圣遗物副词条统计
 *
 * 两条数据来源（都在浏览器本地，只写 sessionStorage，关闭标签页即清除）：
 *   1) **UID**：走 Enka.Network 的公开接口，免登录，读游戏内「角色展示柜」（含武器与圣遗物数值）
 *   2) **GOOD 导入**：把 GOODScanner（https://github.com/Anyrainel/GOODScanner）导出的 GOODv3.json
 *       拖进来 —— 这是拿到「账号下全部角色 / 全部圣遗物」的唯一途径
 *
 * 布局：
 *   · 左侧内容：状态卡（UID 输入 / GOOD 拖拽）→ 角色面板（属性 · 武器与圣遗物卡片）→ 词条数排序
 *   · 右侧角色抽屉：头像**竖向**排列，点底部的「展开」按钮或拖动左边缘即可加宽（收起时只显示头像）
 *
 * 词条排序只统计**当前角色**。属性名/图标/部位名靠下面两张生成表还原：
 *   src/data/game-ids.json       avatarId / GOOD 英文键 → 中文名
 *   src/data/artifacts-index.json  套装名 → 各部位的图标与**部位名**（如「异种的期许」）
 *
 * 路由：#/my-characters
 */
import '../styles/my-characters.css';
import artifactsIndex from '../data/artifacts-index.json';
import { aggregateSubstats, clearBundle, loadBundle, saveBundle } from '../core/substats.js';
import { enkaNote, fetchEnka, normalizeEnka } from '../core/enka.js';
import { parseGood } from '../core/good.js';

/** 站内角色头像（content/characters/images/<角色名>.png） */
const avatarModules = import.meta.glob('../../content/characters/images/*.png', { eager: true, query: '?url', import: 'default' });
const AVATARS = {};
for (const [path, url] of Object.entries(avatarModules)) {
  AVATARS[decodeURIComponent(path.split('/').pop().replace(/\.png$/, ''))] = url;
}
const avatarSrc = (ch) => AVATARS[ch?.name] || ch?.extra?.image || '';

/** 套装名 → 各部位的图标 / 部位名 */
const PIECE_ICONS = new Map(artifactsIndex.map((a) => [a.name, a.pieceIcons || {}]));
const PIECE_NAMES = new Map(artifactsIndex.map((a) => [a.name, a.pieceNames || {}]));
const artifactIcon = (a) => PIECE_ICONS.get(a.setName)?.[a.slotKey] || '';
/** 圣遗物的精确名字：优先用部位名（如「异种的期许」），GOOD 数据只有套装名时退回套装名 */
const artifactName = (a) => PIECE_NAMES.get(a.setName)?.[a.slotKey] || a.setName || '';

/** 武器完整资料：非 eager，切到角色时才加载该武器的 JSON（拿特效文本） */
const WEAPON_LOADERS = import.meta.glob('../../content/weapons/*.json');
const weaponCache = new Map();

async function loadWeapon(slug) {
  if (!slug) return null;
  if (!weaponCache.has(slug)) {
    const loader = WEAPON_LOADERS[`../../content/weapons/${slug}.json`];
    try {
      const mod = loader ? await loader() : null;
      weaponCache.set(slug, mod?.default || mod || null);
    } catch {
      weaponCache.set(slug, null);
    }
  }
  return weaponCache.get(slug);
}

/** 取该精炼档的特效描述 */
async function weaponPassive(slug, refine) {
  const w = await loadWeapon(slug);
  const refs = w?.refinements || [];
  if (!refs.length) return null;
  const i = Math.min(Math.max((Number(refine) || 1) - 1, 0), refs.length - 1);
  return { effectName: w.effectName || '', level: refs[i].level ?? i + 1, description: refs[i].description || '' };
}

/** 上次用的 UID（只写 sessionStorage，关闭标签页即清除） */
const UID_KEY = 'ellen-wiki.enka.uid';
const loadUid = () => { try { return sessionStorage.getItem(UID_KEY) || ''; } catch { return ''; } };
const saveUid = (uid) => { try { sessionStorage.setItem(UID_KEY, String(uid || '')); } catch { /* 隐私模式 */ } };

/** 角色抽屉：每列最多 15 个头像，超过就横向多开几列（不滚动） */
const RAIL_CELL = 42;        // 单个头像格子（含内边距）
const RAIL_GAP = 6;
const RAIL_PAD = 18;         // 面板内边距（8×2）+ 边框（1×2）
const RAIL_HEAD = 32;        // 面板标题行
const RAIL_TOGGLE = 40;      // 展开 / 收起按钮
const RAIL_MAX_ROWS = 15;    // 每列最多放几个头像
const RAIL_SPAN = RAIL_CELL + RAIL_GAP;
const RAIL_COLLAPSED = RAIL_CELL + RAIL_PAD;  // 收起时的宽度（一列）
const RAIL_RESERVE = RAIL_COLLAPSED + 16;     // 主体右侧留出的宽度（收起宽度 + 间距）

/** 当前挂载中的抽屉刷新器（页面重挂载时替换，避免 window 监听器堆积） */
let railRefit = null;
let railResizeBound = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 圣遗物/武器属性短名：固定生命值 → 生命值、百分比攻击力 → 攻击力（百分数带 %，不会混） */
const shortLabel = (label) => String(label || '').replace(/^(固定|百分比)/, '');

/** 星级 → 底色类（5★ 金、4★ 紫、3★ 蓝、2★ 绿、1★ 灰） */
const rarityClass = (n) => {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= 5 ? `rar-${v}` : 'rar-none';
};

/** 右上角数字徽标（命之座 / 精炼），空值不显示 */
const badge = (n) => (n === null || n === undefined || n === '' ? '' : `<span class="cp-badge">${escapeHtml(String(n))}</span>`);

const SOURCE_LABEL = { enka: 'Enka.Network（公开接口）', good: 'GOODScanner 导入' };

export function initMyCharactersPage(root) {
  let bundle = loadBundle();
  let selected = bundle?.characters?.[0]?.name || '';
  let busy = false;
  let notice = '';
  let noticeCls = '';
  let uidDraft = loadUid();
  let railCollapsed = true;      // 默认收起：一列窄条
  let railWidth = 0;             // 展开后按角色数自动算宽度（不支持自由拉伸）
  let pickedProps = new Set();   // 排序表里选中的属性 id（可多选，同步高亮卡片里的副词条）
  let passiveToken = 0;          // 切换角色时作废上一次的武器特效加载

  root.innerHTML = `
    <div class="my-page">
      <div class="my-main">
        <header class="page-header">
          <h1>我的角色</h1>
          <p class="page-subtitle">输入 UID 直读展示柜角色，或导入 GOODScanner 导出的全部圣遗物 —— 数据只在本标签页，关闭即清除</p>
        </header>

        <section class="card record-card" id="mine-state"></section>

        <section class="card record-card" id="mine-chars" hidden>
          <div class="char-panel" id="char-panel"></div>
        </section>

        <section class="card record-card" id="record-result-card" hidden>
          <div class="record-head">
            <h2>圣遗物词条统计</h2>
          </div>
          <div id="record-result"></div>
        </section>
      </div>

      <aside class="mine-rail" id="mine-rail" hidden data-collapsed="true">
        <span class="mine-rail-resizer" id="mine-rail-resizer" title="向左右拖动 = 展开 / 收起"></span>
        <div class="mine-rail-panel">
          <div class="mine-rail-head"><span>角色</span><b id="mine-rail-count">0</b></div>
          <div class="mine-rail-list" id="mine-rail-list"></div>
        </div>
        <button type="button" class="mine-rail-toggle" id="mine-rail-toggle" title="展开角色列表">展开</button>
      </aside>
    </div>`;

  const q = (id) => root.querySelector('#' + id);

  /** 一列能放几行：最多 15 行，屏幕较矮时按可视高度再减 */
  function railRows() {
    const availH = Math.max(RAIL_SPAN, window.innerHeight * 0.82 - RAIL_HEAD - RAIL_TOGGLE - RAIL_PAD);
    return Math.max(1, Math.min(RAIL_MAX_ROWS, Math.floor(availH / RAIL_SPAN)));
  }

  /** 展开时需要的列数与宽度（每列最多 15 行） */
  function railFit(count) {
    const total = Math.max(1, count || 1);
    const rows = railRows();
    const maxW = Math.max(RAIL_CELL + RAIL_PAD, document.documentElement.clientWidth - 24);
    let cols = Math.min(total, Math.ceil(total / rows));
    let width = cols * RAIL_CELL + (cols - 1) * RAIL_GAP + RAIL_PAD;
    if (width > maxW) {
      cols = Math.max(1, Math.floor((maxW - RAIL_PAD + RAIL_GAP) / RAIL_SPAN));
      width = cols * RAIL_CELL + (cols - 1) * RAIL_GAP + RAIL_PAD;
    }
    return { cols, rows, width };
  }

  /** 宽度 → 列数（拖动调宽时重新排版） */
  function railCols(width, count) {
    const cols = Math.floor((width - RAIL_PAD + RAIL_GAP) / RAIL_SPAN);
    return Math.max(1, Math.min(Math.max(1, count || 1), cols));
  }

  /** 角色多到一列（最多 15 个）放不下时才需要展开 */
  function railCanExpand() {
    const count = bundle?.characters?.length || 0;
    return count > railFit(count).rows;
  }

  /** 收起 = 一列窄条；展开 = 按角色数多开几列（每列最多 15 个），都不滚动 */
  function applyRailWidth() {
    const rail = q('mine-rail');
    if (!rail) return;
    const count = bundle?.characters?.length || 0;
    const fit = railFit(count);
    const canExpand = count > fit.rows;
    if (!canExpand) railCollapsed = true;   // 一列就放得完，没有展开的意义
    rail.dataset.collapsed = railCollapsed ? 'true' : 'false';
    if (railCollapsed) {
      railWidth = 0;
      rail.style.setProperty('--rail-w', `${RAIL_COLLAPSED}px`);
      rail.style.setProperty('--rail-cols', '1');
      rail.style.setProperty('--rail-list-h', `${fit.rows * RAIL_SPAN - RAIL_GAP}px`);
    } else {
      railWidth = fit.width;
      rail.style.setProperty('--rail-w', `${railWidth}px`);
      rail.style.setProperty('--rail-cols', String(railCols(railWidth, count)));
      rail.style.setProperty('--rail-list-h', 'none');
    }
    const btn = q('mine-rail-toggle');
    if (btn) {
      btn.hidden = !canExpand;              // 一屏就摆得下时不显示展开按钮
      btn.textContent = railCollapsed ? '展开' : '收起';
      btn.title = railCollapsed ? `展开角色列表（共 ${count} 个角色）` : '收起角色列表';
    }
    /* 主体右侧留出抽屉收起时的宽度，避免被悬浮的窄条盖住 */
    root.querySelector('.my-page')?.style.setProperty('--rail-reserve', count ? `${RAIL_RESERVE}px` : '0px');
  }
  railRefit = () => { if (!q('mine-rail')?.hidden) applyRailWidth(); };
  if (!railResizeBound) {
    railResizeBound = true;
    window.addEventListener('resize', () => railRefit?.());
  }
  /* 内容区尺寸变了（例如滚动条出现）就重算一次列数 */
  const pageEl = root.querySelector('.my-page');
  if (pageEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => railRefit?.()).observe(pageEl);
  }

  /* ============ 1. 顶部状态卡 ============ */
  function renderState() {
    const card = q('mine-state');
    const chars = bundle?.characters?.length || 0;
    const meta = bundle?.meta || {};

    /* ① 还没数据：UID 取数 + GOOD 导入（两种方式并排） */
    if (!chars) {
      card.innerHTML = `
        <div class="mine-empty">
          <p class="mine-empty-title">读取你的角色与圣遗物</p>

          <div class="mine-methods">
            <div class="mine-method">
              <b>方式一 · 输入 UID</b>
              <p class="record-hint">
                读游戏内「角色展示柜」里公开详情的角色（含武器与圣遗物副词条），只读、不用登录。
              </p>
              <div class="mine-uid">
                <input id="mine-uid" class="mine-input" inputmode="numeric" autocomplete="off"
                       value="${escapeHtml(uidDraft)}" />
                <button type="button" class="record-btn primary" id="mine-uid-go">获取</button>
              </div>
            </div>

            <div class="mine-method">
              <b>方式二 · 导入 GOODv3.json</b>
              <p class="record-hint">
                用 <a href="https://github.com/Anyrainel/GOODScanner" target="_blank" rel="noopener">GOODScanner</a>
                导出的 <code>GOODv3.json</code>，含账号下全部角色与圣遗物。
              </p>
              <label class="mine-drop" id="mine-drop">
                <input type="file" id="mine-file" accept=".json,application/json" hidden />
                <span>拖入 GOODv3.json / 点击选择文件</span>
              </label>
            </div>
          </div>

          ${notice ? `<p class="mine-notice ${noticeCls}">${escapeHtml(notice)}</p>` : ''}
          <p class="record-hint mine-privacy">数据只留在这个标签页（sessionStorage），关闭标签页即清除，不会上传到任何服务器。</p>
        </div>`;

      const input = q('mine-uid');
      input?.addEventListener('input', () => { uidDraft = input.value.trim(); });
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') goByUid(); });
      q('mine-uid-go')?.addEventListener('click', goByUid);

      const drop = q('mine-drop');
      const file = q('mine-file');
      file?.addEventListener('change', () => {
        if (file.files?.[0]) importGoodFile(file.files[0]);
        file.value = '';
      });
      drop?.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop?.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop?.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        const f = e.dataTransfer?.files?.[0];
        if (f) importGoodFile(f);
      });
      return;
    }

    /* ② 有数据 */
    const role = (bundle.roles || [])[0];
    const title = meta.source === 'good'
      ? 'GOODScanner 导入'
      : (meta.nickname || role?.nickname || '我的角色');
    const line = meta.source === 'good'
      ? `${SOURCE_LABEL.good}${meta.exportedBy ? ` · 导出工具 ${escapeHtml(meta.exportedBy)}` : ''}`
      : `UID ${escapeHtml(bundle.uid)} · ${SOURCE_LABEL[meta.source] || SOURCE_LABEL.enka}`;

    card.innerHTML = `
      <div class="record-head">
        <h2>${escapeHtml(title)}</h2>
        <div class="record-actions">
          <span class="record-hint">${chars} 个角色 · 数据只在本标签页</span>
          ${meta.source === 'enka' ? '<button type="button" class="record-btn primary" id="mine-retry">重新获取</button>' : ''}
          <button type="button" class="record-btn" id="mine-reset">清除数据</button>
        </div>
      </div>
      <div class="record-meta"><span>${line}</span></div>
      ${notice ? `<p class="mine-notice ${noticeCls}">${escapeHtml(notice)}</p>` : ''}`;

    q('mine-retry')?.addEventListener('click', () => fetchByUid(bundle.uid));
    q('mine-reset')?.addEventListener('click', () => {
      clearBundle();
      bundle = null;
      selected = '';
      pickedProps.clear();
      notice = '';
      noticeCls = '';
      renderAll();
    });
  }

  /* ============ 2. 右侧角色抽屉（竖向头像） ============ */
  function currentCharacter() {
    return bundle?.characters?.find((c) => c.name === selected) || bundle?.characters?.[0] || null;
  }

  function renderRail() {
    const rail = q('mine-rail');
    if (!bundle?.characters?.length) {
      rail.hidden = true;
      q('mine-rail-list').innerHTML = '';     // 清掉上一次的角色列表
      root.querySelector('.my-page')?.style.setProperty('--rail-reserve', '0px');
      return;
    }
    rail.hidden = false;
    applyRailWidth();
    const ch = currentCharacter();
    q('mine-rail-count').textContent = bundle.characters.length;

    q('mine-rail-list').innerHTML = bundle.characters.map((c) => {
      const src = avatarSrc(c);
      return `
      <button type="button" class="mine-rail-item${c.name === ch?.name ? ' active' : ''}" data-name="${escapeHtml(c.name)}"
              title="${escapeHtml(`${c.name}（${c.artifacts.length} 件圣遗物）`)}">
        <span class="mine-rail-face">
          ${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" />` : `<span class="face-fallback">${escapeHtml(c.name.slice(0, 1))}</span>`}
          ${badge(c.extra?.constellation)}
        </span>
      </button>`;
    }).join('');

    q('mine-rail-list').querySelectorAll('.mine-rail-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.name === selected) return;
        selected = btn.dataset.name;
        pickedProps.clear();          // 换角色就取消属性高亮
        renderRail();
        renderPanel();
        renderRolls();
      });
    });
  }

  /* ============ 3. 角色面板（属性 / 武器 + 圣遗物卡片） ============ */
  function renderPanel() {
    const panel = q('char-panel');
    const section = q('mine-chars');
    const ch = currentCharacter();
    if (!ch) {
      section.hidden = true;
      panel.innerHTML = '';
      return;
    }
    section.hidden = false;
    selected = ch.name;
    passiveToken += 1;
    const ex = ch.extra || {};
    const attrs = Array.isArray(ex.attrs) ? ex.attrs : [];
    const w = ex.weapon;
    const avatar = avatarSrc(ch);
    const cons = ex.constellation;
    const refine = w?.affix_level || w?.refinement || '';
    const weaponAttrs = (w?.attrs || []).map((a) => `${a.label} ${a.value}`);

    panel.innerHTML = `
      <div class="cp-head">
        <div class="cp-avatar">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : `<span class="face-fallback">${escapeHtml(ch.name.slice(0, 1))}</span>`}
          ${badge(cons)}
        </div>
        <div class="cp-title">
          <b>${escapeHtml(ch.name)}</b>
          <span>${ch.level !== '' && ch.level != null ? `Lv.${escapeHtml(String(ch.level))}` : ''}</span>
        </div>
        ${attrs.length ? `<div class="cp-attrs">
          ${attrs.map((a) => `<span class="cp-attr"><i>${escapeHtml(a.label)}</i><b>${escapeHtml(String(a.value))}</b></span>`).join('')}
        </div>` : ''}
      </div>

      <div class="cp-block">
        <div class="cp-items">
          ${w ? `
          <div class="cp-item">
            <span class="cp-item-icon ${rarityClass(w.rarity)}">
              ${w.icon ? `<img src="${escapeHtml(w.icon)}" alt="" />` : `<span class="face-fallback">${escapeHtml((w.name || '?').slice(0, 1))}</span>`}
              ${badge(refine)}
            </span>
            <div class="cp-item-body">
              <div class="cp-item-head">
                <b>${escapeHtml(w.name || '')}</b>
                <span>${w.level !== '' && w.level != null ? `Lv.${escapeHtml(String(w.level))}` : ''}</span>
              </div>
              <div class="cp-item-stats">
                ${weaponAttrs.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}
              </div>
              <div class="cp-passive-slot" id="cp-weapon-passive"></div>
            </div>
          </div>` : ''}

          ${ch.artifacts.map((a) => {
            const icon = artifactIcon(a);
            const name = artifactName(a);
            const level = a.level !== '' && a.level != null ? `+${a.level}` : '';
            const main = a.main ? `${escapeHtml(shortLabel(a.main.label))}${a.main.raw ? '+' + escapeHtml(String(a.main.raw)) : ''}` : '';
            const setLine = [a.setName, a.slot].filter(Boolean).map((t) => escapeHtml(String(t))).join(' · ');
            return `
            <div class="cp-item">
              <span class="cp-item-icon ${rarityClass(a.rarity)}">
                ${icon ? `<img src="${escapeHtml(icon)}" alt="" loading="lazy" />` : `<span class="face-fallback">${escapeHtml((a.slot || '?').slice(0, 1))}</span>`}
              </span>
              <div class="cp-item-body">
                <div class="cp-item-head"><b>${escapeHtml(name)}${escapeHtml(level)}</b>${main ? `<span>${main}</span>` : ''}</div>
                <div class="cp-item-set">${setLine}</div>
                <div class="cp-item-subs">
                  ${a.substats.map((s) => `
                  <span class="cp-sub${pickedProps.has(s.prop) ? ' active' : ''}" data-prop="${s.prop}">
                    <i>${escapeHtml(shortLabel(s.label))}</i>
                    <em>${s.rolls === null ? '—' : `${s.rolls.toFixed(1)} 词条`}</em>
                    <b>+${escapeHtml(String(s.raw))}</b>
                  </span>`).join('')}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    fillWeaponPassive(ch, passiveToken);
    applySubHighlight();
  }

  /** 把排序表里选中的属性（可多个）同步高亮到卡片里的副词条 */
  function applySubHighlight() {
    q('char-panel')?.querySelectorAll('.cp-sub').forEach((el) => {
      el.classList.toggle('active', pickedProps.has(Number(el.dataset.prop)));
    });
  }

  /** 武器特效文本是异步加载的，单独填进去（切换角色时用 token 作废旧结果） */
  async function fillWeaponPassive(ch, token) {
    const slot = q('cp-weapon-passive');
    if (!slot) return;
    const w = ch.extra?.weapon;
    if (!w?.slug) return;
    const p = await weaponPassive(w.slug, w.affix_level || w.refinement);
    const el = q('cp-weapon-passive');
    if (!el || token !== passiveToken) return;
    el.innerHTML = p
      ? `<p class="cp-passive">${escapeHtml(p.description)}</p>`
      : '';
  }

  /* ============ 4. 词条排序（只统计当前角色） ============ */
  function renderRolls() {
    const card = q('record-result-card');
    const resultEl = q('record-result');
    const ch = currentCharacter();
    if (!ch) {
      card.hidden = true;
      return;
    }
    const rows = aggregateSubstats([ch]);
    const unknown = rows.filter((r) => r.avg === null);

    card.hidden = false;
    resultEl.innerHTML = `
      <div class="table-wrap"><table class="roll-table">
        <thead><tr><th>属性</th><th>词条数</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="roll-row${pickedProps.has(r.prop) ? ' active' : ''}" data-prop="${r.prop}" title="点击高亮 / 取消高亮（可多选）">
            <td class="roll-name">${escapeHtml(r.label)}</td>
            <td class="roll-value">${(r.rolls ?? 0).toFixed(1)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="record-hint">
        词条数 = 副词条数值 ÷ 该属性的平均词条值（取自角色图鉴「工具」页「圣遗物词条分布」表格的平均值，保留一位小数），已按词条数从大到小排列。
        <b>点击属性可多选高亮</b>，再点一次取消；高亮会同步到上方圣遗物卡片的副词条。
        ${bundle.meta?.noMainStatValue ? 'GOOD 格式不含主词条数值，卡片里主词条只显示属性名。' : ''}
        ${unknown.length ? `⚠️ 有 ${unknown.length} 项属性不在该表格里（${unknown.map((u) => escapeHtml(u.label)).join('、')}），未计入。` : ''}
      </p>`;

    /* 点属性行 = 加入 / 移出高亮集合（可多选） */
    resultEl.querySelectorAll('.roll-row').forEach((row) => {
      row.addEventListener('click', () => {
        const prop = Number(row.dataset.prop);
        if (pickedProps.has(prop)) pickedProps.delete(prop);
        else pickedProps.add(prop);
        resultEl.querySelectorAll('.roll-row').forEach((tr) => {
          tr.classList.toggle('active', pickedProps.has(Number(tr.dataset.prop)));
        });
        applySubHighlight();
      });
    });
  }

  function renderAll() {
    renderState();
    renderRail();
    renderPanel();
    renderRolls();
  }

  /* ============ 5. 取数 ============ */

  /** UID → Enka */
  async function fetchByUid(uid) {
    if (busy) return;
    const id = String(uid || '').trim();
    if (!/^\d{9,10}$/.test(id)) {
      notice = 'UID 应该是 9~10 位数字（游戏内「派蒙菜单 → 设置 → 账号 → 用户中心」能看到）。';
      noticeCls = 'err';
      renderState();
      return;
    }
    busy = true;
    notice = '正在从 Enka.Network 取数…';
    noticeCls = '';
    renderState();
    try {
      const next = normalizeEnka(await fetchEnka(id));
      if (!next.characters.length) throw new Error('这个 UID 的展示柜里没有公开详情的角色（游戏内打开「显示角色详情」后重试）');
      bundle = next;
      selected = bundle.characters[0].name;
      pickedProps.clear();
      saveBundle(bundle);
      saveUid(id);
      uidDraft = id;
      notice = `已取到 ${bundle.characters.length} 个角色。${enkaNote(bundle)}`.trim();
      noticeCls = 'ok';
      renderAll();
    } catch (err) {
      notice = `取数失败：${err.message}`;
      noticeCls = 'err';
      renderState();
    } finally {
      busy = false;
    }
  }

  function goByUid() {
    const input = q('mine-uid');
    const uid = String(input?.value || uidDraft || '').trim();
    uidDraft = uid;
    fetchByUid(uid);
  }

  /** 文件 → GOOD */
  async function importGoodFile(file) {
    let text;
    try {
      text = await file.text();
    } catch {
      notice = '读不到这个文件。';
      noticeCls = 'err';
      renderState();
      return;
    }
    importGoodText(text, file.name);
  }

  function importGoodText(text, filename = '') {
    const parsed = parseGood(text);
    if (parsed.error) {
      notice = `导入失败：${parsed.error}${filename ? `（文件：${filename}）` : ''}`;
      noticeCls = 'err';
      renderState();
      return;
    }
    bundle = parsed.bundle;
    selected = bundle.characters[0]?.name || '';
    pickedProps.clear();
    saveBundle(bundle);
    notice = `已导入 ${bundle.meta.scanned} 件圣遗物 · ${bundle.characters.length} 个角色。${parsed.note || ''}`.trim();
    noticeCls = 'ok';
    renderAll();
  }

  /* ============ 6. 抽屉的展开 / 收起 / 拖边框 ============ */
  q('mine-rail-toggle')?.addEventListener('click', () => {
    if (!railCanExpand()) return;
    railCollapsed = !railCollapsed;
    applyRailWidth();
  });

  /* 拖左边框 = 同一个「展开 / 收起」开关：往左拖开、往右拖合（不做自由拉伸） */
  const resizer = q('mine-rail-resizer');
  const DRAG_THRESHOLD = 10;
  resizer?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    resizer.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (!railCanExpand()) return;   // 没有可展开的（一列就放完）就直接忽略拖动
      const delta = startX - ev.clientX;      // 往左拖为正
      const next = delta > DRAG_THRESHOLD ? false : (delta < -DRAG_THRESHOLD ? true : railCollapsed);
      if (next !== railCollapsed) {
        railCollapsed = next;
        applyRailWidth();
      }
    };
    const up = () => {
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      resizer.removeEventListener('pointercancel', up);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
    resizer.addEventListener('pointercancel', up);
  });
  /* 双击边框 = 在收起 / 展开之间切换 */
  resizer?.addEventListener('dblclick', () => {
    if (!railCanExpand()) return;
    railCollapsed = !railCollapsed;
    applyRailWidth();
  });

  renderAll();
}
