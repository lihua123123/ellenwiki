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
 *   #/boss                  幽境危战（周期挑战）
 *   #/enemies               敌人图鉴
 *   #/enemies/:id           敌人详情
 *   #/my-characters         我的角色（UID 取数 / GOOD 导入 + 圣遗物副词条统计）
 *   #/developer             开发者 · 数据 API（对外只读 JSON 接口说明）
 */
import './styles/tokens.css';
import './styles/base.css';
import './core/colors.js';

// 路由级动态加载：每个页面独立成 chunk，首屏只加载当前页 + 公共依赖；
// katex / marked 等随各自页面按需懒加载，避免全部打进首屏包。
const MODULES = [
  { id: 'characters', title: '角色图鉴', icon: '👤', group: '数据图鉴', loader: () => import('./pages/characters.js'), init: 'initCharactersPage' },
  { id: 'weapons',    title: '武器图鉴', icon: '⚔️', group: '数据图鉴', loader: () => import('./pages/weapons.js'), init: 'initWeaponsPage' },
  { id: 'artifacts',  title: '圣遗物图鉴', icon: '🏵️', group: '数据图鉴', loader: () => import('./pages/artifacts.js'), init: 'initArtifactsPage' },
  { id: 'enemies',    title: '敌人图鉴', icon: '📖', group: '数据图鉴', loader: () => import('./pages/enemies.js'), init: 'initEnemiesPage' },
  { id: 'boss',       title: '幽境危战', icon: '👹', group: '周期挑战', loader: () => import('./pages/boss.js'), init: 'initBossPage' },
  { id: 'formulas',   title: '伤害公式', icon: '∑',  group: '计算工具', loader: () => import('./pages/formulas.js'), init: 'initFormulasPage' },
  { id: 'my-characters', title: '我的角色', icon: '🎴', group: '计算工具', loader: () => import('./pages/my-characters.js'), init: 'initMyCharactersPage' },
  { id: 'developer',  title: '开发者 · 数据 API', icon: '🔌', group: '关于', loader: () => import('./pages/developer.js'), init: 'initDeveloperPage' },
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

// ---- 导航完毕（账号入口已移除：取数改用 UID / GOOD 导入） ----

function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const moduleId = MODULES.some(m => m.id === parts[0]) ? parts[0] : 'characters';
  return { moduleId, params: parts.slice(1) };
}

let routeToken = 0;

async function route() {
  const { moduleId, params } = parseHash();
  const mod = MODULES.find(m => m.id === moduleId);
  const token = ++routeToken;

  Object.entries(navLinks).forEach(([id, link]) => {
    link.classList.toggle('active', id === moduleId);
  });
  document.title = `${mod.title} · 艾莲的数据库`;
  mainEl.className = `app-main page-${moduleId}`;
  mainEl.innerHTML = '<div class="route-loading">加载中…</div>';

  let modExports;
  try {
    modExports = await mod.loader();
  } catch (err) {
    mainEl.innerHTML = `<div class="route-error">模块加载失败：${err?.message ?? err}</div>`;
    return;
  }
  if (token !== routeToken) return; // 已被更新的路由取代，丢弃本次渲染
  mainEl.innerHTML = '';
  modExports[mod.init](mainEl, params);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

route();
