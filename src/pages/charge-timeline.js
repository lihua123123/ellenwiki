/**
 * charge-timeline.js — 角色图鉴 → 工具页：充能时间轴。
 *
 * 从 workspace/charge-timeline/index.html 移植，改为 Wiki 主题 token、全角色数据。
 * 交互：新建轨道 → 选角色 → 放普攻/E/Q（含产球数量/元素）→ 放切人；
 *       运行时光点在节点减速，粒子弹出后弧形飞向光点，落点计入前台/后台。
 */
import '../styles/charge-timeline.css';
import { renderMarkdown } from '../core/markdown.js';
import {
  buildConfig, parseConfig, serializeConfig, summarizeConfig, configFileName, downloadText,
} from '../core/charge-config.js';
import { characters, elementIds } from '../data/characters.js';
import { eParticleOf, E_SEQUENCE, E_HOLD } from '../data/charge-particles.js';
import { parseCount, formatCount } from '../core/charge-num.js';
import { presetOf, expandPreset } from '../data/charge-presets.js';
import mdSource from '../../content/attachment/元素附着及产球.md?raw';

const EL_MAP = {
  fire: 'pyro', water: 'hydro', thunder: 'electro', ice: 'cryo',
  wind: 'anemo', rock: 'geo', grass: 'dendro',
};
const EL = {
  electro:  { color: '#b197fc', label: '雷' },
  pyro:     { color: '#ff6b6b', label: '火' },
  hydro:    { color: '#4dabf7', label: '水' },
  dendro:   { color: '#86efac', label: '草' },
  cryo:     { color: '#a5f3fc', label: '冰' },
  anemo:    { color: '#a7f3d0', label: '风' },
  geo:      { color: '#fde047', label: '岩' },
  colorless:{ color: '#9aa3b2', label: '无' },
};
const TYPE_LABEL = {
  na:    { short: 'NA', full: '普通攻击' },
  skill: { short: 'E',  full: '战技释放' },
  burst: { short: 'Q',  full: '元素爆发' },
  favonius: { short: '西风', full: '西风产球' },
};

/* 全角色名册（按元素分组，去重） */
const ROSTER = [];
const seen = new Set();
for (const el of elementIds) {
  for (const c of characters[el] || []) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    /* 数据里能量写成「无」的角色（玛薇卡、丝柯克）Q 不消耗元素能量，
       记为 null 而不是兜底成 80；数字字符串才当数值用。 */
    const raw = String(c.energy ?? '').trim();
    ROSTER.push({
      name: c.name,
      element: EL_MAP[el],
      energy: /^\d+$/.test(raw) ? Number(raw) : null,
    });
  }
}
const ROSTER_MAP = new Map(ROSTER.map((r) => [r.name, r]));

/* 原工具页顶部 intro 拆成两张表，供弹窗使用 */
const firstH1 = mdSource.search(/^#\s+/m);
const INTRO = firstH1 > 0 ? mdSource.slice(0, firstH1) : mdSource;
const NA_SPLIT = INTRO.indexOf('## 普通攻击产生的能量');
const STATS_MD = NA_SPLIT >= 0 ? INTRO.slice(0, NA_SPLIT) : INTRO;
const NA_MD = NA_SPLIT >= 0 ? INTRO.slice(NA_SPLIT) : '';

const LAYOUT = {
  LANE_X: 201, LANE_W: 784, RULER_Y: 68,
  TRACK_TOP0: 116, TRACK_H: 138, TRACK_GAP: 8,
  LANE_H: 82, CHIP_H: 24, CHIP_GAP: 2,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function shellHtml() {
  const tiles = [
    ['na', '普通攻击', '<path d="M14.5 3.5 21 3l-.5 6.5L9 21l-3-3L14.5 3.5z"/><path d="m6 18 3 3"/><path d="m3 21 3-3"/>', 'none', '#dde1e8'],
    ['skill', '战技释放', '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>', 'none', '#6aa3f0'],
    ['burst', '元素爆发', '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>', '#ffcf6b', '#ffcf6b'],
    ['switch', '切人', '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>', 'none', '#b3a1ff'],
    ['favonius', '西风', '<circle cx="12" cy="5.6" r="4.1"/><circle cx="6.6" cy="17" r="4.1"/><circle cx="17.4" cy="17" r="4.1"/>', '#cfd8e6', '#cfd8e6'],
  ];
  const tileHtml = tiles.map(([act, label, path, fill, stroke], k) => `
    <button type="button" class="ct-tile ct-t${k + 1}" data-act="${act}">
      <svg class="ct-ic" width="16" height="16" viewBox="0 0 24 24" fill="${fill}" stroke="${fill === 'none' ? stroke : 'none'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
      <span class="ct-lab">${label}</span>
    </button>`).join('');

  return `
  <div class="ct-shell">
    <div class="ct-toolbar">
      <div class="ct-tb-left">
        <label class="ct-axis">轴总长 <input id="ct-axis" type="number" min="6" max="60" step="0.5" value="18" /> s</label>
      </div>
      <div class="ct-tb-right">
        <button type="button" class="ct-btn" id="ct-stats">属性表</button>
        <button type="button" class="ct-btn" id="ct-na">普攻回能表</button>
        <button type="button" class="ct-btn" id="ct-reset">重置</button>
        <button type="button" class="ct-icon-btn primary" id="ct-run" title="运行模拟" aria-label="运行模拟">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button type="button" class="ct-icon-btn" id="ct-pause" title="暂停" aria-label="暂停" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        </button>
      </div>
    </div>

    <div class="ct-scroll">
      <div class="ct-workbench" id="ct-workbench">
        <div class="ct-wb-hint" id="ct-hint"></div>
        <div class="ct-time-chip"><span class="ct-cur mono" id="ct-curTime">0.0s</span><span class="ct-tot mono" id="ct-totTime">/ 18.0s</span></div>

        <div class="ct-ruler-head">
          <span class="ct-rh-title">轨道</span>
          <button type="button" class="ct-add" id="ct-addTrack">新建</button>
        </div>
        <div class="ct-ruler" id="ct-ruler"></div>

        <div id="ct-tracks"></div>

        <svg class="ct-overlay" id="ct-overlay" width="1016" height="600">
          <g id="ct-grid"></g>
          <polyline id="ct-path" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" opacity="0.8" points=""></polyline>
        </svg>

        <div id="ct-switchLayer"></div>
        <div class="ct-playhead" id="ct-playhead"></div>
        <div class="ct-ph-handle" id="ct-handle" style="top:62px"></div>
        <div class="ct-lp-glow" id="ct-lpGlow"></div>
        <div class="ct-lp-core" id="ct-lp"></div>
        <div id="ct-balls"></div>
        <div class="ct-toast" id="ct-toast"></div>
      </div>

      <div class="ct-bottom">
        <div class="ct-left-col">
          <div class="ct-toolbox">
            <span class="ct-tt">动作素材库</span>
            ${tileHtml}
          </div>
          <div class="ct-io">
            <button type="button" class="ct-btn2" id="ct-import">导入配置</button>
            <button type="button" class="ct-btn2" id="ct-export">导出配置</button>
            <input type="file" id="ct-importFile" accept="application/json,.json" hidden />
          </div>
        </div>

        <div class="ct-calc">
          <div class="ct-calc-title">充能计算表</div>
          <table class="ct-table">
            <thead>
              <tr>
                <th rowspan="2">角色</th>
                <th rowspan="2">能量</th>
                <th colspan="2" class="v">同色球</th>
                <th colspan="2" class="v">无色球</th>
                <th colspan="2" class="v">异色球</th>
                <th rowspan="2" class="v">充能要求</th>
              </tr>
              <tr>
                <th class="v sub">前台</th><th class="v sub">后台</th>
                <th class="v sub">前台</th><th class="v sub">后台</th>
                <th class="v sub">前台</th><th class="v sub">后台</th>
              </tr>
            </thead>
            <tbody id="ct-calcBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 动作点编辑 -->
    <div class="ct-mask" id="ct-evMask">
      <div class="ct-modal">
        <h3 id="ct-evTitle">编辑动作点</h3>
        <div class="ct-mh" id="ct-evSub">T1</div>
        <div class="ct-row2">
          <div class="ct-field"><label>时间点 (s)</label><input id="ct-evTime" type="number" step="0.1" min="0" /></div>
          <div class="ct-field"><label>动作类型</label>
            <select id="ct-evType">
              <option value="na">普通攻击</option>
              <option value="skill">战技释放</option>
              <option value="burst">元素爆发</option>
              <option value="favonius">西风产球（无色 ×3）</option>
            </select>
          </div>
        </div>
        <div class="ct-field" id="ct-evHoldWrap" style="display:none">
          <label>释放方式（该角色点按 / 长按产球不同）</label>
          <div class="ct-seg">
            <button type="button" class="ct-seg-btn" data-hold="0">点按</button>
            <button type="button" class="ct-seg-btn" data-hold="1">长按</button>
          </div>
        </div>
        <div class="ct-row2">
          <div class="ct-field"><label>产球数量（0 = 不产球）</label><input id="ct-evCount" type="text" inputmode="decimal" placeholder="2/3 或 0.67" /></div>
          <div class="ct-field"><label>产球元素</label><select id="ct-evElem"></select></div>
        </div>
        <div class="ct-modal-btns">
          <button type="button" class="ct-mb-del" id="ct-evDelete">删除</button>
          <button type="button" class="ct-mb-cancel" id="ct-evCancel">取消</button>
          <button type="button" class="ct-mb-ok" id="ct-evSave">保存</button>
        </div>
      </div>
    </div>

    <!-- 角色选择 -->
    <div class="ct-mask" id="ct-roleMask">
      <div class="ct-modal wide">
        <h3>选择角色</h3>
        <div class="ct-mh">选定后会在下方充能表添加该角色，轨道底色与产球颜色随元素更新</div>
        <input class="ct-search" id="ct-roleSearch" type="search" placeholder="搜索角色名…" />
        <div class="ct-roster" id="ct-roster"></div>
        <div class="ct-modal-btns"><button type="button" class="ct-mb-cancel" id="ct-roleCancel">取消</button></div>
      </div>
    </div>

    <!-- 数据表弹窗 -->
    <div class="ct-mask" id="ct-dataMask">
      <div class="ct-modal wide">
        <h3 id="ct-dataTitle">数据表</h3>
        <div class="markdown-body ct-md" id="ct-dataBody"></div>
        <div class="ct-modal-btns"><button type="button" class="ct-mb-cancel" id="ct-dataClose">关闭</button></div>
      </div>
    </div>

    <!-- 产球预设 -->
    <div class="ct-mask" id="ct-presetMask">
      <div class="ct-modal">
        <h3 id="ct-presetTitle">产球预设</h3>
        <div class="ct-mh" id="ct-presetSub"></div>
        <div class="ct-preset-steps" id="ct-presetBody"></div>
        <div class="ct-field">
          <label>第一个 E 的时间（秒）</label>
          <input id="ct-presetFirst" type="number" step="0.1" min="0" />
        </div>
        <div class="ct-preset-preview" id="ct-presetPreview"></div>
        <div class="ct-modal-btns">
          <button type="button" class="ct-mb-del" id="ct-presetClear">清除已生成</button>
          <button type="button" class="ct-mb-cancel" id="ct-presetCancel">取消</button>
          <button type="button" class="ct-mb-ok" id="ct-presetApply">生成</button>
        </div>
      </div>
    </div>

    <!-- 切人时间 -->
    <div class="ct-mask" id="ct-swMask">
      <div class="ct-modal">
        <h3>切人时间</h3>
        <div class="ct-mh" id="ct-swSub"></div>
        <div class="ct-field"><label>时间（秒，相邻切人至少间隔 0.3 s）</label><input id="ct-swTime" type="number" step="0.1" min="0" /></div>
        <div class="ct-modal-btns">
          <button type="button" class="ct-mb-del" id="ct-swDelete">删除</button>
          <button type="button" class="ct-mb-cancel" id="ct-swCancel">取消</button>
          <button type="button" class="ct-mb-ok" id="ct-swSave">保存</button>
        </div>
      </div>
    </div>

    <!-- 导入 / 导出 -->
    <div class="ct-mask" id="ct-ioMask">
      <div class="ct-modal wide">
        <h3 id="ct-ioTitle">导出配置</h3>
        <div class="ct-mh" id="ct-ioSub"></div>
        <div id="ct-ioBody"></div>
        <div class="ct-modal-btns" id="ct-ioBtns"></div>
      </div>
    </div>
  </div>`;
}

export function initChargeTimeline(root) {
  if (!root) return;
  root.innerHTML = shellHtml();

  const $ = (id) => root.querySelector('#' + id);
  const L = LAYOUT;

  const state = {
    axisLength: 18,
    /* 初始只有一条空轨道，角色与动作点都从零开始配 */
    tracks: [ { char: null, events: [] } ],
    switches: [],
    playhead: 0,
  };

  let running = false;
  let runToken = 0;
  /* 只有「真正在播」才禁止编辑；暂停状态下编辑就直接结束这轮 */
  const playingNow = () => running && runCtl && !runCtl.paused;
  const guardEdit = () => {
    if (playingNow()) return false;
    if (running) finishRun();
    return true;
  };
  let armed = null;
  let dragging = false;
  let switchDrag = null;
  let modalCtx = { ti: 0, ei: null };
  let roleTrack = 0;
  const ac = new AbortController();

  const timeToX = (t) => L.LANE_X + (t / state.axisLength) * L.LANE_W;
  const xInLane = (t) => (t / state.axisLength) * L.LANE_W;
  const trackTop = (i) => L.TRACK_TOP0 + i * (L.TRACK_H + L.TRACK_GAP);
  const laneCenterY = (i) => trackTop(i) + 30 + 41;

  const sortSwitches = () => state.switches.sort((a, b) => a.t - b.t);
  function activeTrackAt(t) {
    let idx = 0;
    for (const s of state.switches) {
      if (s.t <= t + 1e-9) idx = s.to;
      else break;
    }
    return clamp(idx, 0, state.tracks.length - 1);
  }

  /* ---------- header / ruler ---------- */
  function renderHeader() {
    $('ct-totTime').textContent = '/ ' + state.axisLength.toFixed(1) + 's';
    const ax = $('ct-axis');
    if (ax && document.activeElement !== ax) ax.value = state.axisLength;
    const add = $('ct-addTrack');
    if (add) add.disabled = state.tracks.length >= 4;
  }

  function renderRuler() {
    const r = $('ct-ruler');
    r.innerHTML = '';
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = (state.axisLength / steps) * i;
      const tick = document.createElement('div');
      tick.className = 'ct-tick mono';
      tick.style.left = (i / steps) * L.LANE_W + 'px';
      if (i === 0) tick.style.transform = 'none';
      else if (i === steps) tick.style.transform = 'translateX(-100%)';
      tick.textContent = (Math.round(t * 10) / 10) + 's';
      r.appendChild(tick);
    }
    const g = $('ct-grid');
    g.innerHTML = '';
    for (let i = 1; i < steps; i++) {
      const x = timeToX0(i / steps);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', x); ln.setAttribute('x2', x);
      ln.setAttribute('y1', L.RULER_Y); ln.setAttribute('y2', tracksBottom());
      ln.setAttribute('stroke', 'rgba(255,255,255,.09)');
      ln.setAttribute('stroke-width', '1');
      g.appendChild(ln);
    }
  }
  const timeToX0 = (frac) => L.LANE_X + frac * L.LANE_W;
  function tracksBottom() {
    const n = state.tracks.length;
    return L.TRACK_TOP0 + (n - 1) * (L.TRACK_H + L.TRACK_GAP) + L.TRACK_H + 12;
  }

  function layout() {
    const bottom = tracksBottom();
    const wb = $('ct-workbench');
    const w = wb.clientWidth || 1016;
    /* 时间轴可用宽度 = 容器宽 − 左 20 − 轨道头 168 − 泳道内缩 12 − 右 20 − 泳道内缩 12 */
    L.LANE_W = Math.max(240, w - 232);
    wb.style.height = (bottom + 20) + 'px';
    $('ct-overlay').setAttribute('width', w);
    $('ct-overlay').setAttribute('height', bottom + 20);
    $('ct-playhead').style.height = (bottom - L.RULER_Y) + 'px';
  }

  /* ---------- tracks ---------- */
  function renderTracks() {
    const c = $('ct-tracks');
    c.innerHTML = '';
    state.tracks.forEach((tr, i) => {
      const col = tr.char ? EL[tr.char.element].color : '#3f4654';
      const pv = tr.char ? presetOf(tr.char.name) : null;
      const inst = tr.char ? eParticleOf(tr.char.name) : null;
      const row = document.createElement('div');
      row.className = 'ct-track';
      row.style.top = trackTop(i) + 'px';
      row.style.borderColor = hexToRgba(col, 0.35);
      row.innerHTML = `
        <div class="ct-thead">
          <div class="ct-accent" style="background:${col}"></div>
          <div class="ct-tnum mono">T${i + 1}</div>
          <button type="button" class="ct-role-btn ${tr.char ? '' : 'empty'}" data-i="${i}">
            ${tr.char
              ? `<span class="ct-rd" style="background:${col}"></span><span class="ct-rname">${tr.char.name}</span><span class="ct-chev">▾</span>`
              : `<span>＋ 选择角色</span>`}
          </button>
          ${tr.char ? `<button type="button" class="ct-preset-btn ${pv ? '' : 'off'}" data-i="${i}" title="${pv
              ? '加载产球预设'
              : inst ? `E 产球已按数据自动填入（${inst.raw}），无需预设` : '该角色暂无产球预设'}">预设</button>` : ''}
          ${state.tracks.length > 1 ? `<button type="button" class="ct-del" data-i="${i}" title="删除轨道">×</button>` : ''}
        </div>
        <div class="ct-tmain">
          <div class="ct-lane" data-i="${i}" style="background:${hexToRgba(col, 0.12)};border-color:${hexToRgba(col, 0.28)}"></div>
        </div>`;
      c.appendChild(row);

      const lane = row.querySelector('.ct-lane');
      const rowEnds = [-1e9, -1e9, -1e9];
      const placed = [];
      tr.events.slice().sort((a, b) => a.t - b.t).forEach((ev) => {
        const ecol = EL[ev.element].color;
        const chip = document.createElement('div');
        chip.className = 'ct-chip' + (ev.count === 0 ? ' dim' : '');
        chip.dataset.ei = tr.events.indexOf(ev);
        const left = clamp(xInLane(ev.t), 32, L.LANE_W - 32);
        chip.style.left = left + 'px';
        chip.style.borderColor = hexToRgba(ecol, 0.45);
        const srcNote = ev.src === 'preset' ? ' · 预设' : ev.src === 'data' ? ' · 产球数据' : '';
        chip.title = `${TYPE_LABEL[ev.type].full} · ${ev.t}s · ${EL[ev.element].label} ×${formatCount(ev.count)}${srcNote}`;
        chip.innerHTML = `<span class="ct-cdot" style="background:${ecol}"></span><span class="ct-ctype" style="color:${ecol}">${TYPE_LABEL[ev.type].short}</span><span class="ct-ctime">${ev.t.toFixed(1)}s</span><span class="ct-ccount">×${formatCount(ev.count)}</span>`;
        const evIndex = tr.events.indexOf(ev);
        chip.onclick = (e) => { e.stopPropagation(); };
        chip.onpointerdown = (e) => {
          if (!guardEdit()) return;
          if (armed) return;
          e.preventDefault();
          e.stopPropagation();
          beginChipDrag(e, i, evIndex, ev, chip, lane);
        };
        lane.appendChild(chip);
        const w = chip.offsetWidth;
        let rowIdx = 0;
        while (rowIdx < 3 && left - w / 2 - 4 < rowEnds[rowIdx]) rowIdx++;
        if (rowIdx === 3) rowIdx = rowEnds.indexOf(Math.min(...rowEnds));
        placed.push({ chip, rowIdx });
        rowEnds[rowIdx] = Math.max(rowEnds[rowIdx], left + w / 2);
      });
      /* 动作点整体在泳道里垂直居中（单行也居中） */
      const rows = placed.reduce((m, p) => Math.max(m, p.rowIdx + 1), 0);
      const stackH = rows * L.CHIP_H + (rows - 1) * L.CHIP_GAP;
      const top0 = (L.LANE_H - stackH) / 2;
      placed.forEach(({ chip, rowIdx }) => {
        chip.style.top = (top0 + rowIdx * (L.CHIP_H + L.CHIP_GAP)) + 'px';
      });

      lane.onclick = (e) => {
        if (!guardEdit()) return;
        const rect = lane.getBoundingClientRect();
        const t = clamp(((e.clientX - rect.left) / rect.width) * state.axisLength, 0, state.axisLength);
        const ts = Math.round(t * 10) / 10;
        if (armed === 'switch') { addSwitch(ts, i); return; }
        if (armed) {
          const tr = state.tracks[i];
          if (!tr.char) { hint('先在轨道头选择角色'); return; }
          if (armed === 'favonius') {
            tr.events.push({ t: ts, type: 'favonius', count: 3, element: 'colorless', src: 'data' });
            tr.events.sort((a, b) => a.t - b.t);
            renderAll();
            hint('已放入西风 · 无色 ×3');
            return;
          }
          if (armed === 'skill' && tr.char) {
            /* 一次释放会铺多个动作点的角色（妮露 / 刻晴） */
            const seq = E_SEQUENCE[tr.char.name];
            if (seq) {
              seq.forEach((st) => {
                const tt = Math.round((ts + st.at) * 10) / 10;
                if (tt <= state.axisLength + 1e-9) {
                  tr.events.push({ t: tt, type: 'skill', count: parseCount(st.count), element: tr.char.element, src: 'data' });
                }
              });
              tr.events.sort((a, b) => a.t - b.t);
              renderAll();
              hint(`${tr.char.name}：已铺出 ${seq.length} 个战技动作点`);
              return;
            }
            /* 点按 / 长按产球不同的角色：弹窗里选 */
            if (E_HOLD[tr.char.name]) { openEventModal(i, null, { t: ts, type: armed }); return; }
            /* 瞬间产球角色：直接按数据落点，不弹窗 */
            const data = eParticleOf(tr.char.name);
            if (data) {
              /* 同一处重复放 E 时覆盖，不叠加（E 有 CD，0.25s 内不可能按两次） */
              const dup = tr.events.find((e) => e.type === 'skill' && Math.abs(e.t - ts) < 0.25);
              if (dup) {
                dup.t = ts; dup.count = parseCount(data.n); dup.element = tr.char.element; dup.src = 'data';
              } else {
                tr.events.push({ t: ts, type: 'skill', count: parseCount(data.n), element: tr.char.element, src: 'data' });
              }
              tr.events.sort((a, b) => a.t - b.t);
              renderAll();
              hint(`已放入 E · ${EL[tr.char.element].label} ×${formatCount(data.n)}（${data.raw}）`);
              return;
            }
            if (presetOf(tr.char.name)) hint(`${tr.char.name} 的产球请用轨道头「预设」生成`);
          }
          openEventModal(i, null, { t: ts, type: armed });
          return;
        }
        seek(t);
      };
    });

    c.querySelectorAll('.ct-role-btn').forEach((b) => { b.onclick = () => openRoleModal(+b.dataset.i); });
    c.querySelectorAll('.ct-del').forEach((b) => { b.onclick = () => removeTrack(+b.dataset.i); });
    c.querySelectorAll('.ct-preset-btn').forEach((b) => {
      b.onclick = () => {
        const tr = state.tracks[+b.dataset.i];
        if (!tr.char) return;
        if (!presetOf(tr.char.name)) {
          hint(eParticleOf(tr.char.name) ? '该角色 E 产球已自动填入，无需预设' : '该角色暂无产球预设');
          return;
        }
        openPresetModal(+b.dataset.i);
      };
    });
  }

  function renderSwitches() {
    const layer = $('ct-switchLayer');
    layer.innerHTML = '';
    state.switches.forEach((s) => {
      const from = activeTrackAt(s.t - 0.001);
      const to = clamp(s.to, 0, state.tracks.length - 1);
      if (to === from) return;
      const y0 = laneCenterY(from), y1 = laneCenterY(to);
      const x = timeToX(s.t);

      const hit = document.createElement('div');
      hit.className = 'ct-switch-hit';
      hit.style.left = x + 'px';
      hit.style.top = Math.min(y0, y1) + 'px';
      hit.style.height = Math.abs(y1 - y0) + 'px';
      hit.title = '拖动竖线调整切人时间（相邻至少 0.3s）';
      hit.onpointerdown = (e) => beginSwitchDrag(e, s);
      layer.appendChild(hit);

      const pill = document.createElement('div');
      pill.className = 'ct-switch-pill';
      pill.style.left = (x + 7) + 'px';
      pill.style.top = (y0 + (y1 - y0) * 0.72 - 9) + 'px';
      pill.title = '拖动调整时间（相邻至少 0.3s）';
      pill.innerHTML = `<span>⇅ T${to + 1}</span><span class="ct-sx" title="删除切人">×</span>`;
      pill.onpointerdown = (e) => {
        if (e.target.classList.contains('ct-sx')) return;
        beginSwitchDrag(e, s);
      };
      pill.querySelector('.ct-sx').onclick = (e) => {
        e.stopPropagation();
        if (!guardEdit()) return;
        state.switches = state.switches.filter((x2) => x2 !== s);
        renderAll();
        hint('已删除切人');
      };
      layer.appendChild(pill);
    });
  }

  function renderPath() {
    const pts = [];
    let cur = 0;
    pts.push([timeToX(0), laneCenterY(cur)]);
    state.switches.forEach((s) => {
      const to = clamp(s.to, 0, state.tracks.length - 1);
      if (to === cur) return;
      pts.push([timeToX(s.t), laneCenterY(cur)]);
      pts.push([timeToX(s.t), laneCenterY(to)]);
      cur = to;
    });
    pts.push([timeToX(state.axisLength), laneCenterY(cur)]);
    $('ct-path').setAttribute('points', pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  }

  function renderPlayhead(t) {
    state.playhead = t;
    const x = timeToX(t);
    const y = laneCenterY(activeTrackAt(t));
    $('ct-playhead').style.left = x + 'px';
    $('ct-handle').style.left = x + 'px';
    $('ct-lpGlow').style.left = x + 'px'; $('ct-lpGlow').style.top = y + 'px';
    $('ct-lp').style.left = x + 'px'; $('ct-lp').style.top = y + 'px';
    $('ct-curTime').textContent = t.toFixed(1) + 's';
  }

  /* ---------- calc ---------- */
  function computeAcc(upTo) {
    const acc = state.tracks.map(() => ({
      same: { f: 0, b: 0 }, colorless: { f: 0, b: 0 }, diff: { f: 0, b: 0 },
    }));
    const evs = [];
    state.tracks.forEach((tr) => tr.events.forEach((ev) => {
      if (ev.count > 0) evs.push({ t: ev.t, count: ev.count, element: ev.element });
    }));
    evs.sort((a, b) => a.t - b.t);
    evs.forEach((ev) => {
      if (ev.t > upTo + 1e-9) return;
      const col = activeTrackAt(ev.t);
      state.tracks.forEach((tr, i) => {
        if (!tr.char) return;
        const rel = ev.element === 'colorless' ? 'colorless' : (ev.element === tr.char.element ? 'same' : 'diff');
        const key = i === col ? 'f' : 'b';
        acc[i][rel][key] += ev.count;
      });
    });
    return acc;
  }

  function renderCalc(upTo) {
    const acc = computeAcc(upTo);
    const body = $('ct-calcBody');
    body.innerHTML = '';
    let any = false;
    state.tracks.forEach((tr, i) => {
      if (!tr.char) return;
      any = true;
      const a = acc[i];
      /* 能量为 null 表示该角色不消耗元素能量（如玛薇卡），充能要求不适用 */
      const need = tr.char.energy == null ? null : Number(tr.char.energy);
      /* 原表格公式：能量 / (同色前台×3 + 无色前台×2 + 异色前台 + 0.6×(同色后台×3 + 无色后台×2 + 异色后台)) */
      const onField = a.same.f * 3 + a.colorless.f * 2 + a.diff.f;
      const offField = a.same.b * 3 + a.colorless.b * 2 + a.diff.b;
      const denom = onField + 0.6 * offField;
      const req = need == null || denom <= 0 ? '—' : ((need / denom) * 100).toFixed(1) + '%';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="ct-role-cell"><span class="ct-rd" style="background:${EL[tr.char.element].color}"></span>${tr.char.name}</span></td>
        <td class="ct-energy"><input class="ct-energy-inp" data-i="${i}" value="${need == null ? '无' : need}" title="可直接改能量，填「无」表示不消耗元素能量" /></td>
        <td>${formatCount(a.same.f)}</td><td>${formatCount(a.same.b)}</td>
        <td>${formatCount(a.colorless.f)}</td><td>${formatCount(a.colorless.b)}</td>
        <td>${formatCount(a.diff.f)}</td><td>${formatCount(a.diff.b)}</td>
        <td class="ct-req">${req}</td>`;
      body.appendChild(row);
    });
    if (!any) body.innerHTML = '<tr><td colspan="9" class="ct-empty">先在轨道头选择角色</td></tr>';
    body.querySelectorAll('.ct-energy-inp').forEach((inp) => {
      inp.onchange = () => {
        const tr = state.tracks[+inp.dataset.i];
        if (!tr || !tr.char) return;
        const raw = String(inp.value).trim();
        if (!raw || raw === '无') tr.char.energy = null;
        else {
          const v = parseFloat(raw);
          if (isNaN(v)) { inp.value = tr.char.energy == null ? '无' : tr.char.energy; return; }
          tr.char.energy = clamp(Math.round(v * 100) / 100, 0, 999);
        }
        renderCalc(state.playhead);
      };
    });
  }

  /* ---------- helpers ---------- */
  function hint(msg) {
    const el = $('ct-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(hint._t);
    hint._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function seek(t) {
    renderPlayhead(clamp(t, 0, state.axisLength));
    renderCalc(state.playhead);
  }

  function updateArmUI() {
    root.querySelectorAll('.ct-tile').forEach((t) => t.classList.toggle('active', t.dataset.act === armed));
    $('ct-tracks').classList.toggle('placing', !!armed);
    const h = $('ct-hint');
    if (armed === 'switch') h.textContent = '切人：点击目标轨道放置';
    else if (armed === 'skill') h.textContent = '放置「战技释放」：点击轨道（瞬间产球角色会自动带入产球数）';
    else if (armed) h.textContent = `放置「${TYPE_LABEL[armed].full}」：点击轨道（可贴着已有节点放）`;
    else h.textContent = '';
  }

  function addSwitch(t, to) {
    const from = activeTrackAt(t - 0.001);
    if (from === to) { hint('光点已经在该轨道，无需切人'); return; }
    if (state.switches.some((s) => Math.abs(s.t - t) < 0.3 - 1e-9)) { hint('切人之间至少间隔 0.3s'); return; }
    state.switches.push({ t, to });
    sortSwitches();
    armed = null;
    updateArmUI();
    renderAll();
    hint(`已在 ${t.toFixed(1)}s 切到 T${to + 1}`);
  }

  let chipDrag = null;
  function beginChipDrag(e, ti, ei, ev, chip, lane) {
    chipDrag = { ti, ei, ev, chip, lane, startX: e.clientX, moved: false };
    window.addEventListener('pointermove', moveChipDrag);
    window.addEventListener('pointerup', endChipDrag);
  }
  function moveChipDrag(e) {
    if (!chipDrag) return;
    if (!chipDrag.moved && Math.abs(e.clientX - chipDrag.startX) < 3) return;
    chipDrag.moved = true;
    const rect = chipDrag.lane.getBoundingClientRect();
    const raw = clamp(((e.clientX - rect.left) / rect.width) * state.axisLength, 0, state.axisLength);
    chipDrag.ev.t = Math.round(raw * 10) / 10;
    chipDrag.chip.style.left = clamp(xInLane(chipDrag.ev.t), 32, L.LANE_W - 32) + 'px';
    const tm = chipDrag.chip.querySelector('.ct-ctime');
    if (tm) tm.textContent = chipDrag.ev.t.toFixed(1) + 's';
  }
  function endChipDrag() {
    if (!chipDrag) return;
    const { ti, ei, ev, moved } = chipDrag;
    window.removeEventListener('pointermove', moveChipDrag);
    window.removeEventListener('pointerup', endChipDrag);
    chipDrag = null;
    if (!moved) { openEventModal(ti, ei); return; }
    state.tracks[ti].events.sort((a, b) => a.t - b.t);
    renderAll();
    hint(`已把动作点移到 ${ev.t.toFixed(1)}s`);
  }

  function beginSwitchDrag(e, sw) {
    if (!guardEdit()) return;
    e.preventDefault();
    e.stopPropagation();
    switchDrag = { sw, startX: e.clientX, moved: false };
    document.body.classList.add('ct-dragging');
    window.addEventListener('pointermove', moveSwitchDrag);
    window.addEventListener('pointerup', endSwitchDrag);
  }
  let swEditing = null;
  function openSwitchModal(sw) {
    if (!guardEdit()) return;
    swEditing = sw;
    const to = clamp(sw.to, 0, state.tracks.length - 1);
    $('ct-swSub').textContent = `切到 T${to + 1}` + (state.tracks[to] && state.tracks[to].char ? ' · ' + state.tracks[to].char.name : '');
    $('ct-swTime').value = sw.t.toFixed(1);
    $('ct-swMask').classList.add('show');
  }
  $('ct-swSave').onclick = () => {
    if (!swEditing) return;
    const v = parseFloat($('ct-swTime').value);
    if (isNaN(v) || v < 0 || v > state.axisLength) { hint('时间需在 0 ~ 轴总长之间'); return; }
    const lim = switchLimits(swEditing);
    const minT = Math.ceil(lim.minT * 10 - 1e-9) / 10;
    const maxT = Math.floor(lim.maxT * 10 + 1e-9) / 10;
    const t = clamp(Math.round(v * 10) / 10, minT, Math.max(minT, maxT));
    if (Math.abs(t - v) > 1e-9) hint(`已夹到 ${t.toFixed(1)}s（相邻切人需间隔 0.3 s）`);
    swEditing.t = t;
    swEditing = null;
    $('ct-swMask').classList.remove('show');
    sortSwitches();
    renderAll();
  };
  $('ct-swDelete').onclick = () => {
    if (!swEditing) return;
    state.switches = state.switches.filter((x) => x !== swEditing);
    swEditing = null;
    $('ct-swMask').classList.remove('show');
    renderAll();
    hint('已删除切人');
  };
  $('ct-swCancel').onclick = () => { swEditing = null; $('ct-swMask').classList.remove('show'); };
  $('ct-swMask').addEventListener('click', (e) => { if (e.target.id === 'ct-swMask') { swEditing = null; $('ct-swMask').classList.remove('show'); } });

  function switchLimits(sw) {
    const others = state.switches.filter((s) => s !== sw);
    const prev = others.filter((s) => s.t < sw.t).sort((a, b) => b.t - a.t)[0];
    const next = others.filter((s) => s.t > sw.t).sort((a, b) => a.t - b.t)[0];
    const minT = prev ? prev.t + 0.3 : 0;
    const maxT = next ? next.t - 0.3 : state.axisLength;
    return { minT, maxT: Math.max(minT, maxT) };
  }
  function moveSwitchDrag(e) {
    if (!switchDrag) return;
    if (!switchDrag.moved && Math.abs(e.clientX - switchDrag.startX) < 3) return;
    switchDrag.moved = true;
    const rect = $('ct-ruler').getBoundingClientRect();
    const raw = clamp(((e.clientX - rect.left) / rect.width) * state.axisLength, 0, state.axisLength);
    const { minT, maxT } = switchLimits(switchDrag.sw);
    switchDrag.sw.t = clamp(raw, minT, maxT);
    renderSwitches();
    renderPath();
    renderPlayhead(state.playhead);
  }
  function endSwitchDrag() {
    if (!switchDrag) return;
    const sw = switchDrag.sw;
    const moved = switchDrag.moved;
    switchDrag = null;
    document.body.classList.remove('ct-dragging');
    window.removeEventListener('pointermove', moveSwitchDrag);
    window.removeEventListener('pointerup', endSwitchDrag);
    if (!moved) { openSwitchModal(sw); return; }
    const lim = switchLimits(sw);
    const minT = Math.ceil(lim.minT * 10 - 1e-9) / 10;
    const maxT = Math.floor(lim.maxT * 10 + 1e-9) / 10;
    sw.t = clamp(Math.round(sw.t * 10) / 10, minT, Math.max(minT, maxT));
    sortSwitches();
    renderAll();
  }

  function renderAll() {
    sortSwitches();
    renderHeader();
    layout();
    renderRuler();
    renderTracks();
    renderSwitches();
    renderPath();
    renderPlayhead(state.playhead);
    renderCalc(state.playhead);
  }

  /* ---------- drag playhead ---------- */
  function seekFromClientX(cx) {
    const rect = $('ct-ruler').getBoundingClientRect();
    seek(clamp(((cx - rect.left) / rect.width) * state.axisLength, 0, state.axisLength));
  }
  $('ct-handle').addEventListener('pointerdown', (e) => { if (!guardEdit()) return; dragging = true; e.preventDefault(); });
  $('ct-ruler').addEventListener('pointerdown', (e) => { if (!guardEdit()) return; dragging = true; seekFromClientX(e.clientX); });
  window.addEventListener('pointermove', (e) => { if (dragging) seekFromClientX(e.clientX); }, { signal: ac.signal });
  window.addEventListener('pointerup', () => { dragging = false; }, { signal: ac.signal });

  /* ---------- tools ---------- */
  root.querySelectorAll('.ct-tile').forEach((t) => {
    t.onclick = () => {
      if (!guardEdit()) return;
      armed = armed === t.dataset.act ? null : t.dataset.act;
      updateArmUI();
    };
  });

  /* ---------- event modal ---------- */
  function fillElemOptions() {
    const sel = $('ct-evElem');
    sel.innerHTML = '';
    Object.keys(EL).forEach((k) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k === 'colorless' ? '无色' : EL[k].label + '元素';
      sel.appendChild(o);
    });
  }
  function openEventModal(ti, ei, seed) {
    modalCtx = { ti, ei };
    const tr = state.tracks[ti];
    const ev = (ei == null)
      ? { t: seed.t, type: seed.type, count: 0, element: tr.char ? tr.char.element : 'colorless' }
      : tr.events[ei];
    $('ct-evTitle').textContent = ei == null ? '新建动作点' : '编辑动作点';
    $('ct-evSub').textContent = `T${ti + 1}${tr.char ? ' · ' + tr.char.name : ' · 未设置角色'}`;
    $('ct-evTime').value = ev.t;
    $('ct-evType').value = ev.type;
    $('ct-evCount').value = formatCount(ev.count);
    $('ct-evElem').value = ev.element;
    $('ct-evDelete').style.display = ei == null ? 'none' : '';
    /* 点按 / 长按：只有该角色两种释放方式产球不同时才出现 */
    const hold = tr.char ? E_HOLD[tr.char.name] : null;
    const wrap = $('ct-evHoldWrap');
    wrap.style.display = hold && ev.type === 'skill' ? '' : 'none';
    if (hold) {
      const isHold = ev.hold === true;
      wrap.querySelectorAll('.ct-seg-btn').forEach((b) => {
        b.classList.toggle('on', (b.dataset.hold === '1') === isHold);
        b.onclick = () => {
          const toHold = b.dataset.hold === '1';
          $('ct-evCount').value = formatCount(toHold ? hold.hold : hold.tap);
          wrap.querySelectorAll('.ct-seg-btn').forEach((x) => x.classList.toggle('on', x === b));
        };
      });
    }
    if (hold && ei == null) $('ct-evCount').value = formatCount(hold.tap);
    $('ct-evMask').classList.add('show');
  }
  $('ct-evSave').onclick = () => {
    const t = parseFloat($('ct-evTime').value);
    const count = clamp(parseCount($('ct-evCount').value), 0, 20);
    if (isNaN(t) || t < 0 || t > state.axisLength) { hint('时间点需在 0 ~ 轴总长之间'); return; }
    const rec = { t: Math.round(t * 10) / 10, type: $('ct-evType').value, count, element: $('ct-evElem').value };
    const _tr = state.tracks[modalCtx.ti];
    const holdCfg = _tr.char ? E_HOLD[_tr.char.name] : null;
    if (holdCfg && rec.type === 'skill') rec.hold = $('ct-evHoldWrap').querySelector('.ct-seg-btn.on')?.dataset.hold === '1';
    const tr = state.tracks[modalCtx.ti];
    if (modalCtx.ei == null) tr.events.push(rec);
    else tr.events[modalCtx.ei] = rec;
    tr.events.sort((a, b) => a.t - b.t);
    $('ct-evMask').classList.remove('show');
    renderAll();
  };
  $('ct-evDelete').onclick = () => {
    state.tracks[modalCtx.ti].events.splice(modalCtx.ei, 1);
    $('ct-evMask').classList.remove('show');
    renderAll();
  };
  $('ct-evCancel').onclick = () => $('ct-evMask').classList.remove('show');
  $('ct-evMask').addEventListener('click', (e) => { if (e.target.id === 'ct-evMask') $('ct-evMask').classList.remove('show'); });

  /* ---------- 产球预设 ---------- */
  let presetTrack = 0;

  function presetStepsHtml(preset) {
    const head = '<div class="ct-pstep head"><span class="ct-pwhen">相对首个 E</span><span class="ct-pwhat">动作 / 产球</span></div>';
    const rows = (preset.steps || []).map((s) => {
      const at = Number(s.at) || 0;
      const count = parseCount(s.count);
      const every = Number(s.every) || 0;
      const times = Number(s.times) || 0;
      const when = every > 0
        ? `+${at.toFixed(1)}s 起，每 ${every}s${times ? ` ×${times}` : ' 至轴末'}`
        : `+${at.toFixed(1)}s`;
      const what = count > 0
        ? `${TYPE_LABEL[s.type || 'skill'].short} · 产 ${formatCount(count)} 球`
        : `${TYPE_LABEL[s.type || 'skill'].short} · 不产球`;
      return `<div class="ct-pstep"><span class="ct-pwhen mono">${when}</span><span class="ct-pwhat">${what}</span></div>`;
    }).join('');
    return head + rows;
  }

  function updatePresetPreview() {
    const tr = state.tracks[presetTrack];
    const preset = tr && tr.char ? presetOf(tr.char.name) : null;
    if (!preset) return;
    const first = parseFloat($('ct-presetFirst').value);
    if (isNaN(first) || first < 0) { $('ct-presetPreview').textContent = '请填写 ≥ 0 的首个 E 时间'; return; }
    const gen = expandPreset(preset, first, state.axisLength);
    if (!gen.length) { $('ct-presetPreview').textContent = '从该时间起，轴内没有可生成的动作点'; return; }
    const orbs = gen.reduce((s, e) => s + e.count, 0);
    $('ct-presetPreview').textContent =
      `将生成 ${gen.length} 个动作点：${gen[0].t.toFixed(1)}s → ${gen[gen.length - 1].t.toFixed(1)}s，共 ${formatCount(orbs)} 球`;
  }

  function openPresetModal(i) {
    if (!guardEdit()) return;
    const tr = state.tracks[i];
    if (!tr || !tr.char) return;
    const preset = presetOf(tr.char.name);
    if (!preset) { hint('该角色暂无产球预设'); return; }
    presetTrack = i;
    $('ct-presetTitle').textContent = '产球预设 · ' + tr.char.name;
    $('ct-presetSub').textContent = `T${i + 1}${preset.note ? ' · ' + preset.note : ''}`;
    $('ct-presetBody').innerHTML = presetStepsHtml(preset);
    $('ct-presetFirst').value = Math.round(state.playhead * 10) / 10;
    updatePresetPreview();
    $('ct-presetMask').classList.add('show');
  }

  $('ct-presetFirst').addEventListener('input', updatePresetPreview);

  $('ct-presetApply').onclick = () => {
    const tr = state.tracks[presetTrack];
    if (!tr || !tr.char) return;
    const preset = presetOf(tr.char.name);
    if (!preset) return;
    const first = parseFloat($('ct-presetFirst').value);
    if (isNaN(first) || first < 0 || first > state.axisLength) { hint('首个 E 的时间需在 0 ~ 轴总长之间'); return; }
    const gen = expandPreset(preset, first, state.axisLength);
    /* 先清掉上一次预设生成的点，避免重复叠加 */
    tr.events = tr.events.filter((e) => e.src !== 'preset');
    gen.forEach((g) => tr.events.push({
      t: g.t, type: g.type, count: g.count, element: g.element || tr.char.element, src: 'preset',
    }));
    tr.events.sort((a, b) => a.t - b.t);
    $('ct-presetMask').classList.remove('show');
    renderAll();
    hint(`已按预设生成 ${gen.length} 个动作点`);
  };

  $('ct-presetClear').onclick = () => {
    const tr = state.tracks[presetTrack];
    if (!tr) return;
    const n = tr.events.filter((e) => e.src === 'preset').length;
    tr.events = tr.events.filter((e) => e.src !== 'preset');
    $('ct-presetMask').classList.remove('show');
    renderAll();
    hint(n ? `已清除 ${n} 个预设动作点` : '这条轨道没有预设生成的动作点');
  };

  $('ct-presetCancel').onclick = () => $('ct-presetMask').classList.remove('show');
  $('ct-presetMask').addEventListener('click', (e) => { if (e.target.id === 'ct-presetMask') $('ct-presetMask').classList.remove('show'); });

  /* ---------- role picker ---------- */
  function openRoleModal(i) {
    if (!guardEdit()) return;
    roleTrack = i;
    $('ct-roleSearch').value = '';
    renderRoster('');
    $('ct-roleMask').classList.add('show');
    setTimeout(() => $('ct-roleSearch').focus(), 30);
  }
  function renderRoster(keyword) {
    const c = $('ct-roster');
    const kw = (keyword || '').trim();
    const list = kw ? ROSTER.filter((r) => r.name.includes(kw)) : ROSTER;
    c.innerHTML = list.map((r) => `
      <button type="button" class="ct-roster-item" data-name="${r.name}">
        <span class="ct-rd" style="background:${EL[r.element].color}"></span>
        <span class="ct-rn">${r.name}</span>
        <span class="ct-re">${r.energy == null ? '无' : r.energy}</span>
      </button>`).join('') || '<p class="ct-empty">没有匹配的角色</p>';
    c.querySelectorAll('.ct-roster-item').forEach((b) => {
      b.onclick = () => {
        const r = ROSTER.find((x) => x.name === b.dataset.name);
        if (r) applyRole(r);
      };
    });
  }
  function applyRole(r) {
    const tr = state.tracks[roleTrack];
    tr.char = { name: r.name, element: r.element, energy: r.energy };
    tr.events.forEach((ev) => { if (ev.count > 0) ev.element = r.element; });
    $('ct-roleMask').classList.remove('show');
    renderAll();
  }
  $('ct-roleSearch').addEventListener('input', (e) => renderRoster(e.target.value));
  $('ct-roleCancel').onclick = () => $('ct-roleMask').classList.remove('show');
  $('ct-roleMask').addEventListener('click', (e) => { if (e.target.id === 'ct-roleMask') $('ct-roleMask').classList.remove('show'); });

  /* ---------- track add / remove ---------- */
  $('ct-addTrack').onclick = () => {
    if (!guardEdit()) return;
    if (state.tracks.length >= 4) return;
    state.tracks.push({ char: null, events: [] });
    renderAll();
    openRoleModal(state.tracks.length - 1);
  };
  function removeTrack(i) {
    if (!guardEdit()) return;
    if (state.tracks.length <= 1) return;
    state.tracks.splice(i, 1);
    state.switches = state.switches
      .filter((s) => s.to !== i)
      .map((s) => ({ t: s.t, to: s.to > i ? s.to - 1 : s.to }));
    sortSwitches();
    renderAll();
  }

  /* ---------- animation ---------- */
  function pulseLP() {
    const g = $('ct-lpGlow');
    g.classList.remove('pulse');
    void g.offsetWidth;
    g.classList.add('pulse');
  }
  function animateParticle(wrap, dot, x0, y0, x1, y1, done) {
    const POP = 320, HOLD = 160, FLY = 680;
    const cx = (x0 + x1) / 2 + 56;
    const cy = Math.min(y0, y1) - 40;
    const st = performance.now();
    function fr(now) {
      const p = now - st;
      let x, y, s;
      if (p < POP) {
        const k = p / POP, e = 1 - Math.pow(1 - k, 3);
        x = x0; y = y0 - 22 * e; s = 0.4 + 0.7 * e;
      } else if (p < POP + HOLD) {
        x = x0; y = y0 - 22; s = 1.1;
      } else if (p < POP + HOLD + FLY) {
        const k = (p - POP - HOLD) / FLY;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
        y = (1 - e) * (1 - e) * (y0 - 22) + 2 * (1 - e) * e * cy + e * e * y1;
        s = 1.1 - 0.1 * e;
      } else { x = x1; y = y1; s = 1; }
      wrap.style.transform = `translate(${x - x0}px,${y - y0}px)`;
      dot.style.transform = `scale(${s})`;
      wrap.style.opacity = p < POP ? Math.min(1, p / (POP * 0.45)) : 1;
      if (p < POP + HOLD + FLY) requestAnimationFrame(fr);
      else done();
    }
    requestAnimationFrame(fr);
  }
  function spawnFlyingParticle(ev, k, total, onDone) {
    const sx = timeToX(ev.t) + (k - (total - 1) / 2) * 16;
    const sy = laneCenterY(ev.ti);
    const tx = timeToX(ev.t);
    const ty = laneCenterY(activeTrackAt(ev.t));
    const wrap = document.createElement('div');
    wrap.className = 'ct-pt';
    wrap.style.left = sx + 'px';
    wrap.style.top = sy + 'px';
    const dot = document.createElement('div');
    dot.className = 'ct-pt-dot';
    dot.style.background = EL[ev.element].color;
    dot.style.boxShadow = `0 0 10px ${EL[ev.element].color}`;
    const lab = document.createElement('div');
    lab.className = 'ct-plabel';
    lab.style.borderColor = hexToRgba(EL[ev.element].color, 0.6);
    lab.style.color = EL[ev.element].color;
    lab.textContent = `${EL[ev.element].label === '无' ? '无色' : EL[ev.element].label + '元素'}微粒 ×${formatCount(ev.count)}`;
    wrap.appendChild(dot);
    wrap.appendChild(lab);
    $('ct-balls').appendChild(wrap);
    animateParticle(wrap, dot, sx, sy, tx, ty, () => {
      wrap.remove();
      pulseLP();
      onDone && onDone();
    });
  }

  /* ---------- run / pause ---------- */
  let runCtl = null;

  function updateRunButtons() {
    const playing = running && runCtl && !runCtl.paused;
    $('ct-run').disabled = !!playing;
    $('ct-pause').disabled = !playing;
  }

  $('ct-run').onclick = () => {
    if (running && runCtl) {
      if (runCtl.paused) {
        runCtl.paused = false;
        runCtl.last = performance.now();
        updateRunButtons();
      }
      return;
    }
    startRun();
  };

  $('ct-pause').onclick = () => {
    if (!running || !runCtl || runCtl.paused) return;
    runCtl.paused = true;
    updateRunButtons();
  };

  function startRun() {
    running = true; armed = null; updateArmUI();
    $('ct-balls').innerHTML = '';
    runToken++;
    const token = runToken;

    const list = [];
    state.tracks.forEach((tr, ti) => tr.events.forEach((ev) => {
      if (ev.count > 0) list.push({ t: ev.t, ti, count: ev.count, element: ev.element, type: ev.type });
    }));
    list.sort((a, b) => a.t - b.t);

    seek(0);
    const ctl = { token, simT: 0, idx: 0, last: performance.now(), phase: 'run', paused: false };
    runCtl = ctl;
    updateRunButtons();

    const NORMAL = 1.0, SLOW = 0.2, WIN = 0.6;

    function frame(now) {
      if (token !== runToken || !root.isConnected) return;
      if (ctl.paused) {
        ctl.last = now;
        requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.05, (now - ctl.last) / 1000);
      ctl.last = now;

      if (ctl.phase === 'run') {
        let sp = NORMAL;
        if (ctl.idx < list.length) {
          const d = list[ctl.idx].t - ctl.simT;
          if (d < WIN) sp = SLOW + (NORMAL - SLOW) * Math.max(0, d / WIN);
        }
        ctl.simT += sp * dt;
        if (ctl.simT > state.axisLength) ctl.simT = state.axisLength;
        renderPlayhead(ctl.simT);
        renderCalc(ctl.simT);

        if (ctl.idx < list.length && ctl.simT >= list[ctl.idx].t) {
          ctl.simT = list[ctl.idx].t;
          renderPlayhead(ctl.simT);
          const t0 = list[ctl.idx].t;
          const batch = [];
          while (ctl.idx < list.length && Math.abs(list[ctl.idx].t - t0) < 1e-9) { batch.push(list[ctl.idx]); ctl.idx++; }
          ctl.phase = 'particle';
          let pending = batch.length;
          batch.forEach((ev, k) => {
            spawnFlyingParticle(ev, k, batch.length, () => {
              if (token !== runToken) return;
              pending--;
              if (pending === 0) {
                renderCalc(ctl.simT);
                ctl.phase = 'run';
                ctl.last = performance.now();
              }
            });
          });
        }
      }

      if (ctl.simT < state.axisLength) requestAnimationFrame(frame);
      else { seek(state.axisLength); finishRun(); }
    }
    requestAnimationFrame(frame);
  }

  function finishRun() {
    running = false;
    runCtl = null;
    updateRunButtons();
  }

  $('ct-reset').onclick = () => {
    runToken++;
    running = false;
    runCtl = null;
    armed = null;
    updateArmUI();
    $('ct-balls').innerHTML = '';
    seek(0);
    updateRunButtons();
  };

  /* ---------- axis ---------- */
  $('ct-axis').addEventListener('change', () => {
    const v = parseFloat($('ct-axis').value);
    if (isNaN(v)) { $('ct-axis').value = state.axisLength; return; }
    state.axisLength = clamp(Math.round(v * 10) / 10, 6, 60);
    state.playhead = clamp(state.playhead, 0, state.axisLength);
    renderAll();
  });

  /* ---------- data modals ---------- */
  function openDataModal(title, md) {
    $('ct-dataTitle').textContent = title;
    $('ct-dataBody').innerHTML = renderMarkdown(md);
    $('ct-dataMask').classList.add('show');
  }
  $('ct-stats').onclick = () => openDataModal('圣遗物属性表', STATS_MD);
  $('ct-na').onclick = () => openDataModal('普通攻击回能表', NA_MD);
  $('ct-dataClose').onclick = () => $('ct-dataMask').classList.remove('show');
  $('ct-dataMask').addEventListener('click', (e) => { if (e.target.id === 'ct-dataMask') $('ct-dataMask').classList.remove('show'); });
  $('ct-ioMask').addEventListener('click', (e) => { if (e.target.id === 'ct-ioMask') closeIo(); });

  /* ---------- 导入 / 导出（格式规范见 core/charge-config.js） ---------- */
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const closeIo = () => $('ct-ioMask').classList.remove('show');

  function openIoModal({ title, sub, body, btns }) {
    $('ct-ioTitle').textContent = title;
    $('ct-ioSub').innerHTML = sub || '';
    $('ct-ioBody').innerHTML = body;
    const box = $('ct-ioBtns');
    box.innerHTML = '';
    btns.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = b.cls;
      el.textContent = b.label;
      el.onclick = b.onClick;
      box.appendChild(el);
    });
    $('ct-ioMask').classList.add('show');
  }

  function ioSummaryHtml(cfg) {
    const s = summarizeConfig(cfg);
    const chips = [
      `轴长 ${s.axisLength.toFixed(1)}s`,
      `${s.tracks} 轨道 · ${s.filled} 已配角色`,
      `${s.events} 动作点`,
      `${formatCount(s.orbCount)} 颗产球`,
      `${s.switches} 切人`,
    ];
    return `<div class="ct-sum">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>`;
  }

  function ioNoteHtml(kind, title, items, limit = 8) {
    if (!items || !items.length) return '';
    const shown = items.slice(0, limit);
    const rest = items.length - shown.length;
    return `<div class="ct-io-note ${kind}"><b>${escapeHtml(title)}</b><ul>${
      shown.map((t) => `<li>${escapeHtml(t)}</li>`).join('')
    }</ul>${rest > 0 ? `<div class="ct-io-more">还有 ${rest} 条…</div>` : ''}</div>`;
  }

  $('ct-export').onclick = () => {
    const cfg = buildConfig(state);
    const text = JSON.stringify(cfg, null, 2);
    const fileName = configFileName(cfg);

    const copyText = () => {
      const done = () => hint('JSON 已复制');
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch { hint('复制失败，请手动选中'); }
        ta.remove();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else fallback();
    };

    openIoModal({
      title: '导出配置',
      sub: '包含角色、轨道上的动作点与切人时间点；导入时会替换当前内容',
      body: ioSummaryHtml(cfg) + `<pre class="ct-code" id="ct-ioCode">${escapeHtml(text)}</pre>`,
      btns: [
        { label: '复制 JSON', cls: 'ct-mb-cancel', onClick: copyText },
        {
          label: '下载 .json',
          cls: 'ct-mb-ok',
          onClick: () => { downloadText(fileName, text); closeIo(); hint('已导出 ' + fileName); },
        },
        { label: '关闭', cls: 'ct-mb-cancel', onClick: closeIo },
      ],
    });
  };

  function showImportError(errors, warnings) {
    openIoModal({
      title: '无法导入',
      sub: '文件未通过校验，当前内容保持不变',
      body: ioNoteHtml('err', '需要修正', errors) + ioNoteHtml('warn', '其他提示', warnings),
      btns: [{ label: '关闭', cls: 'ct-mb-cancel', onClick: closeIo }],
    });
  }

  function applyImported(next) {
    runToken++;
    running = false;
    runCtl = null;
    armed = null;
    updateArmUI();
    $('ct-balls').innerHTML = '';
    state.axisLength = next.axisLength;
    state.tracks = next.tracks;
    state.switches = next.switches;
    state.playhead = 0;
    $('ct-axis').value = next.axisLength;
    renderAll();
    seek(0);
    updateRunButtons();
    hint(`已导入 ${next.tracks.length} 轨道 / ${next.switches.length} 切人`);
  }

  function confirmImport(text) {
    const res = parseConfig(text, { roster: ROSTER_MAP });
    if (!res.ok) { showImportError(res.errors, res.warnings); return; }
    const warnTitle = res.legacy
      ? `已自动修正 ${res.warnings.length} 处（含旧版格式兼容）`
      : `已自动修正 ${res.warnings.length} 处`;
    const cur = summarizeConfig(buildConfig(state));
    const nxt = summarizeConfig(res.config);
    const diff = `<div class="ct-io-diff">当前 <b>${cur.axisLength.toFixed(1)}s · ${cur.tracks} 轨 · ${cur.orbCount} 球</b>`
      + ` → 导入后 <b>${nxt.axisLength.toFixed(1)}s · ${nxt.tracks} 轨 · ${nxt.orbCount} 球</b></div>`;
    openIoModal({
      title: '导入配置',
      sub: '将用这份配置替换当前内容，替换后无法撤销',
      body: diff + ioSummaryHtml(res.config) + ioNoteHtml('warn', warnTitle, res.warnings),
      btns: [
        { label: '取消', cls: 'ct-mb-cancel', onClick: closeIo },
        { label: '替换当前', cls: 'ct-mb-ok', onClick: () => { applyImported(res.internal); closeIo(); } },
      ],
    });
  }

  function readConfigFile(file) {
    if (file.size > 1024 * 1024) {
      showImportError([`文件「${file.name}」大于 1 MB，可能不是配置文件`], []);
      return;
    }
    const rd = new FileReader();
    rd.onerror = () => showImportError(['读取文件失败，请确认文件可访问'], []);
    rd.onload = () => {
      try { confirmImport(String(rd.result)); }
      catch (err) { showImportError(['解析时出错：' + err.message], []); }
    };
    rd.readAsText(file, 'utf-8');
  }

  $('ct-import').onclick = () => {
    const inp = $('ct-importFile');
    inp.value = '';
    inp.click();
  };
  $('ct-importFile').onchange = () => {
    const inp = $('ct-importFile');
    const f = inp.files && inp.files[0];
    if (f) readConfigFile(f);
    inp.value = '';
  };

  /* ---------- esc (scoped cleanup on route change) ---------- */
  window.addEventListener('keydown', (e) => {
    if (!root.isConnected) return;
    if (e.key === 'Escape') {
      armed = null; updateArmUI();
      $('ct-evMask').classList.remove('show');
      $('ct-roleMask').classList.remove('show');
      $('ct-presetMask').classList.remove('show');
      $('ct-swMask').classList.remove('show');
      $('ct-dataMask').classList.remove('show');
      $('ct-ioMask').classList.remove('show');
    }
  }, { signal: ac.signal });
  window.addEventListener('hashchange', () => ac.abort(), { once: true });

  fillElemOptions();
  sortSwitches();
  renderAll();
  /* 分辨率/容器变化后重排时间轴 */
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (!root.isConnected) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => renderAll(), 120);
  }, { signal: ac.signal });
  updateRunButtons();
}
