/**
 * tooltip.js — 全局自定义深色气泡提示。
 * 给任意元素加 data-tip="多行文本" 即可悬停显示（事件委托，整个生命周期只初始化一次）。
 * 替代原生 title：样式可控、支持换行、带渐隐动画，自动上下翻转与横向钳制。
 */
let tipEl = null;
let currentTarget = null;
let showTimer = null;
let hideTimer = null;
let initialized = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureTip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'ui-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
}

function show(target) {
  const text = target?.dataset?.tip;
  if (!text) return;
  ensureTip();
  tipEl.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  tipEl.classList.add('visible');
  const r = target.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 10;
  if (top < 8) top = r.bottom + 10; // 空间不足时翻到下方
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

function hide() {
  tipEl?.classList.remove('visible');
  currentTarget = null;
}

export function initTooltip() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;

  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || t === currentTarget) return;
    currentTarget = t;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      if (currentTarget === t) show(t);
    }, 120);
  });

  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || t !== currentTarget) return;
    // 移向气泡本身时不隐藏（pointer-events:none，实际不会触发，这里做兜底）
    if (e.relatedTarget && tipEl && tipEl.contains(e.relatedTarget)) return;
    currentTarget = null;
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  });

  // 滚动/切页时立即隐藏，避免气泡悬挂在错误位置
  window.addEventListener('scroll', () => { clearTimeout(showTimer); hide(); }, { passive: true });
}
