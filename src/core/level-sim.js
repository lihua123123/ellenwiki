/**
 * level-sim.js — 「等级滑块 + 突破节点 + 突破勾选」通用组件（角色属性 / 武器属性共用）。
 *
 * 数据约定（与 content 里的 curve / stats 一致）：
 *   series[key][lv-1] 该等级「已尽可能突破」时的值
 *   pre[key][cap]     停在突破节点、尚未突破时的值（只有 20/40/50/60/70/80 有）
 *   format[key]       'int' 取整 | 'pct' 小数转百分比（0.384 → 38.4%）
 *
 * 用法：
 *   root.innerHTML = levelSimHtml({ maxLevel, value, cells, hint });
 *   bindLevelSim(root, { series, pre, format, maxLevel });
 */

export const ASC_CAPS = [20, 40, 50, 60, 70, 80];

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 数值单元格（页面按 data-out="key" 取值） */
export const statCellsHtml = (cells) => `
  <div class="stat-row">
    ${cells.map((c) => `
      <div class="stat-cell">
        <span class="stat-label">${escapeHtml(c.label)}</span>
        <span class="stat-value" data-out="${escapeHtml(c.key)}">—</span>
      </div>`).join('')}
  </div>`;

/** 突破节点在轨道上的位置：与原生 range 的滑块中心对齐（端点各留半个滑块） */
const tickPos = (cap, maxLevel, thumb = 18) => {
  const p = (cap - 1) / (maxLevel - 1);
  return `calc(${(p * 100).toFixed(3)}% + ${((0.5 - p) * thumb).toFixed(2)}px)`;
};

export function levelSimHtml({ maxLevel = 90, value, cells = [], caps = ASC_CAPS, hint = '' }) {
  const start = value ?? maxLevel;
  const ticks = caps.filter((c) => c < maxLevel);
  return `
    <div class="level-sim">
      ${cells.length ? statCellsHtml(cells) : ''}
      <div class="level-slider-head">
        <span class="level-slider-label">等级</span>
        <span class="level-current">${start}</span>
      </div>
      <div class="level-track">
        <input type="range" class="level-range" min="1" max="${maxLevel}" step="1"
               value="${start}" aria-label="等级" />
        <div class="level-ticks">
          ${ticks.map((c) => `
            <button type="button" class="level-tick" data-level="${c}" style="left:${tickPos(c, maxLevel)}"
                    title="跳到 ${c} 级"><span class="level-tick-dot"></span><span class="level-tick-num">${c}</span></button>`).join('')}
        </div>
      </div>
      <div class="level-slider-foot">
        <label class="asc-toggle">
          <input type="checkbox" class="asc-check" checked />
          <span>已突破</span>
        </label>
        <span class="asc-hint">${hint || `仅在 ${ticks.join(' / ')} 级可切换`}</span>
      </div>
    </div>`;
}

/** 绑定：滑块拖动 / 点节点跳级 / 突破勾选 */
export function bindLevelSim(root, { series = {}, pre = {}, format = {}, maxLevel = 90, caps = ASC_CAPS }) {
  const panel = root.querySelector('.level-sim');
  if (!panel) return;

  const range = panel.querySelector('.level-range');
  const ascCheck = panel.querySelector('.asc-check');
  const current = panel.querySelector('.level-current');
  const outs = [...panel.querySelectorAll('[data-out]')];
  if (!range) return;

  const fmt = (v, mode) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
    if (mode === 'pct') return `${(Number(v) * 100).toFixed(1)}%`;
    return String(Math.round(Number(v)));
  };

  function apply() {
    const lv = Number(range.value);
    const atCap = caps.includes(lv);
    ascCheck.disabled = !atCap;
    /* 非突破节点的等级必然已经突破过 */
    if (!atCap) ascCheck.checked = true;

    const usePre = atCap && !ascCheck.checked;
    for (const el of outs) {
      const key = el.dataset.out;
      const preMap = pre[key] || {};
      const v = usePre ? preMap[String(lv)] : (series[key] || [])[lv - 1];
      el.textContent = fmt(v, format[key]);
    }
    current.textContent = lv;
    panel.querySelectorAll('.level-tick').forEach((t) => {
      t.classList.toggle('active', Number(t.dataset.level) === lv);
    });
  }

  range.addEventListener('input', apply);
  ascCheck.addEventListener('change', apply);
  panel.querySelectorAll('.level-tick').forEach((t) => {
    t.addEventListener('click', () => {
      range.value = t.dataset.level;
      apply();
    });
  });
  apply();
  return { apply, maxLevel };
}
