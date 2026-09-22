/**
 * main.js — 模块注册表 + hash 路由。
 * 路由：
 *   #/characters            角色图鉴
 *   #/characters/:name      角色详情
 *   #/weapons               武器图鉴
 *   #/weapons/:name         武器详情
 *   #/artifacts             圣遗物图鉴
 *   #/artifacts/:name       圣遗物详情
 *   #/formulas/:game        伤害公式（genshin / sr / zzz）
 *   #/boss                  幽境 Boss 图鉴
 */
import './styles/base.css';
import './core/colors.js';
import { initCharactersPage } from './pages/characters.js';
import { initWeaponsPage } from './pages/weapons.js';
import { initArtifactsPage } from './pages/artifacts.js';
import { initFormulasPage } from './pages/formulas.js';
import { initBossPage } from './pages/boss.js';

const MODULES = [
  { id: 'characters', title: '角色图鉴', icon: '👤', group: '数据图鉴', render: initCharactersPage },
  { id: 'weapons',    title: '武器图鉴', icon: '⚔️', group: '数据图鉴', render: initWeaponsPage },
  { id: 'artifacts',  title: '圣遗物图鉴', icon: '🏵️', group: '数据图鉴', render: initArtifactsPage },
  { id: 'boss',       title: '幽境 Boss', icon: '👹', group: '数据图鉴', render: initBossPage },
  { id: 'formulas',   title: '伤害公式', icon: '∑',  group: '计算工具', render: initFormulasPage },
];

const mainEl = document.getElementById('app-main');
const navEl = document.getElementById('side-nav');

// ---- 侧边导航（按组渲染） ----
const navLinks = {};
let lastGroup = null;
MODULES.forEach(mod => {
  if (mod.group !== lastGroup) {
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = mod.group;
    navEl.appendChild(label);
    lastGroup = mod.group;
  }
  const a = document.createElement('a');
  a.href = `#/${mod.id}`;
  a.dataset.module = mod.id;
  a.innerHTML = `<span class="nav-title">${mod.title}</span>`;
  navEl.appendChild(a);
  navLinks[mod.id] = a;
});

function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const moduleId = MODULES.some(m => m.id === parts[0]) ? parts[0] : 'characters';
  return { moduleId, params: parts.slice(1) };
}

function route() {
  const { moduleId, params } = parseHash();
  const mod = MODULES.find(m => m.id === moduleId);

  Object.entries(navLinks).forEach(([id, link]) => {
    link.classList.toggle('active', id === moduleId);
  });

  document.title = `${mod.title} · 艾莲的数据库`;
  mainEl.className = `app-main page-${moduleId}`;
  mainEl.innerHTML = '';
  mod.render(mainEl, params);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

route();
