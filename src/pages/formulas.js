/**
 * formulas.js — 伤害计算公式模块（原神 / 星穹铁道 / 绝区零）。
 * 数据源：content/formulas/*.md（单一数据源，直接 ?raw 引入）。
 *
 * 展示层优化：
 *   - 每个 ## 章节渲染为独立卡片，带锚点 id
 *   - 右侧粘性目录，滚动时自动高亮当前章节（scroll-spy）
 *   - 行间公式居中 + 深色底卡，长公式横向滚动
 */
import { renderMarkdown } from '../core/markdown.js';
import '../styles/formulas.css';
import genshinContent from '../../content/formulas/genshin.md?raw';
import srContent from '../../content/formulas/sr.md?raw';
import zzzContent from '../../content/formulas/zzz.md?raw';

const GAMES = [
  { id: 'genshin', title: '原神', heading: '原神 · 伤害计算公式', content: genshinContent },
  { id: 'sr',      title: '星穹铁道', heading: '崩坏：星穹铁道 · 伤害计算公式', content: srContent },
  { id: 'zzz',     title: '绝区零', heading: '绝区零 · 伤害计算公式', content: zzzContent },
];

/* renderMarkdown 已按 h2 把内容包成 .section-card（markdown.css），
 * 这里只给各章节 h2 加锚点 id 并收集目录条目 */
function setupSections(container, gameId) {
  const heads = [...container.querySelectorAll('.section-card > h2')];
  return heads.map((h2, i) => {
    const id = `sec-${gameId}-${i}`;
    h2.id = id;
    return { id, title: h2.textContent.trim() };
  });
}

function buildToc(ol, toc, activeId) {
  ol.innerHTML = toc.map(({ id, title }) => `
    <li><a href="javascript:void(0)" data-target="${id}" class="${id === activeId ? 'active' : ''}">${title}</a></li>
  `).join('');
  ol.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      const el = document.getElementById(a.dataset.target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

export function initFormulasPage(root, params) {
  const sub = Array.isArray(params) ? params[0] : params;
  root.innerHTML = `
    <div class="formulas-page">
      <div class="subnav-tabs game-tabbar" role="tablist" aria-label="选择游戏"></div>
      <div class="game-views"></div>
    </div>
  `;

  /* 懒渲染缓存：每个游戏首次切换时才做 markdown + KaTeX 渲染。
   * 必须定义在页面初始化内部——路由切换会整体重建 DOM，模块级缓存会导致重建后不再渲染。 */
  const rendered = new Set();

  const tabbar = root.querySelector('.game-tabbar');
  const viewsHost = root.querySelector('.game-views');
  const tabs = {};
  const views = {};
  let spyObserver = null;

  GAMES.forEach(({ id, title, heading }) => {
    const tab = document.createElement('a');
    tab.href = `#/formulas/${id}`;
    tab.dataset.game = id;
    tab.setAttribute('role', 'tab');
    tab.textContent = title;
    tabbar.appendChild(tab);
    tabs[id] = tab;

    const view = document.createElement('section');
    view.className = `game-view scope-${id}`;
    view.dataset.game = id;
    view.style.display = 'none';
    view.innerHTML = `
      <header class="page-header"><h1>${heading}</h1></header>
      <div class="formulas-layout">
        <div class="markdown-body formula-content" id="formula-content-${id}"></div>
        <aside class="formula-toc card" aria-label="章节目录">
          <h4>目录</h4>
          <ol class="toc-list"></ol>
        </aside>
      </div>`;
    viewsHost.appendChild(view);
    views[id] = view;
  });

  function renderGame(id) {
    if (rendered.has(id)) return;
    const el = root.querySelector(`#formula-content-${id}`);
    if (!el) return;
    el.innerHTML = renderMarkdown(GAMES.find(g => g.id === id).content);
    const toc = setupSections(el, id);
    const tocList = views[id].querySelector('.toc-list');
    buildToc(tocList, toc, toc[0]?.id);
    rendered.add(id);
  }

  /* 滚动高亮当前章节 */
  function setupSpy(id) {
    if (spyObserver) spyObserver.disconnect();
    const view = views[id];
    const tocList = view.querySelector('.toc-list');
    const sections = [...view.querySelectorAll('.section-card')];
    if (!sections.length) return;
    spyObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (!visible.length) return;
      const active = visible[0].target.querySelector('h2')?.id;
      if (active) {
        tocList.querySelectorAll('a').forEach(a =>
          a.classList.toggle('active', a.dataset.target === active));
      }
    }, { rootMargin: '-72px 0px -65% 0px' });
    sections.forEach(s => spyObserver.observe(s));
  }

  function switchGame(id, updateHash = true) {
    if (!GAMES.some(g => g.id === id)) id = 'genshin';
    renderGame(id);
    Object.entries(tabs).forEach(([key, tab]) => {
      const active = key === id;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    Object.entries(views).forEach(([key, view]) => {
      view.style.display = key === id ? '' : 'none';
    });
    setupSpy(id);
    if (updateHash && window.location.hash !== `#/formulas/${id}`) {
      window.location.hash = `/formulas/${id}`;
    }
  }

  const initial = GAMES.some(g => g.id === sub) ? sub : 'genshin';
  switchGame(initial, false);
}
