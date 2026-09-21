/**
 * boss.js — 幽境 Boss 图鉴模块。
 * 数据源：src/data/bosses.json（由 scripts/parse-boss.mjs 从 content/boss/幽境boss.md 生成）。
 * 卡片正面为机制，点击翻面查看介绍与背景；版本珠子串切换。
 */
import '../styles/boss.css';
import data from '../data/bosses.json';
import { renderRichText } from '../core/richtext.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 解析敌人技能数据：__SEP__ 分隔为 机制 / 介绍 / 背景 三组
function parseEnemyContent(boss) {
  if (!boss.skills || boss.skills.length === 0) {
    return { mechanic: [], intro: [], detail: [] };
  }
  const parts = boss.skills.join('\n').split('__SEP__').map(s => s.trim());
  const toLines = (str) => (str ? str.split('\n').map(s => s.trim()).filter(Boolean) : []);
  return {
    mechanic: toLines(parts[0]),
    intro: toLines(parts[1]),
    detail: toLines(parts[2]),
  };
}

function renderBlocks(lines) {
  if (!lines || lines.length === 0) return '<p class="empty-hint">暂无数据</p>';
  let html = '<div class="block-list">';
  lines.forEach((line) => {
    if (!line.trim()) return;
    const isTitleLine = /^\*\*[^*]+\*\*$/.test(line.trim());
    if (isTitleLine) {
      const titleText = line.replace(/\*\*/g, '');
      html += `<div class="block block-title"><span class="block-title-mark"></span>${escapeHtml(titleText)}</div>`;
    } else {
      html += `<div class="block block-text">${renderRichText(line)}</div>`;
    }
  });
  html += '</div>';
  return html;
}

function createEnemyCard(boss, versionStr, index, cardStates) {
  const cardStateKey = `${versionStr}-${index}`;
  if (!cardStates[cardStateKey]) cardStates[cardStateKey] = { flipped: false };
  const state = cardStates[cardStateKey];
  const { mechanic, intro, detail } = parseEnemyContent(boss);

  const card = document.createElement('div');
  card.className = 'enemy-card' + (state.flipped ? ' flipped' : '');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `查看${boss.fullName || boss.shortName}的介绍与背景`);

  let imgHtml;
  if (boss.imgMissing) {
    imgHtml = `
      <div class="image-placeholder">
        <div>🖼️ 图片待补充</div>
        <code>${escapeHtml(boss.imgLocal || '')}</code>
        <span>请将图片放入 content/boss/images/ 后重新构建</span>
      </div>`;
  } else {
    imgHtml = `<img src="./images/${encodeURIComponent(boss.imgLocal)}" alt="${escapeHtml(boss.fullName || boss.shortName)}" loading="lazy" />`;
  }

  card.innerHTML = `
    <div class="flip-inner">
      <div class="flip-face flip-front">
        <div class="enemy-image-container">${imgHtml}</div>
        <div class="enemy-card-content">
          <div class="enemy-header">
            <h2 class="enemy-name">${escapeHtml(boss.fullName || boss.shortName)}</h2>
            <p class="enemy-hp">${escapeHtml(boss.hp)}</p>
          </div>
          <div class="face-title">机制</div>
          <div class="face-body">${renderBlocks(mechanic)}</div>
        </div>
      </div>
      <div class="flip-face flip-back">
        <div class="enemy-card-content">
          <div class="enemy-header">
            <h2 class="enemy-name">${escapeHtml(boss.shortName || boss.fullName)}</h2>
            <p class="enemy-hp">${escapeHtml(boss.hp)}</p>
          </div>
          <div class="face-title">介绍</div>
          <div class="face-body">
            ${intro.length ? renderBlocks(intro) : ''}
            ${detail.length ? `
              <div class="background-section">
                <button class="background-toggle" aria-expanded="false">
                  <span>背景</span>
                  <span class="bg-arrow">▾</span>
                </button>
                <div class="background-content">${renderBlocks(detail)}</div>
              </div>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="flip-hint">
      <span class="hint-front">点击翻面 · 查看介绍与背景</span>
      <span class="hint-back">点击返回 · 查看机制</span>
    </div>`;

  const flipCard = () => {
    state.flipped = !state.flipped;
    card.classList.toggle('flipped', state.flipped);
    card.setAttribute('aria-expanded', String(state.flipped));
  };
  card.addEventListener('click', flipCard);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flipCard();
    }
  });

  // 背景折叠（阻止冒泡避免触发翻面）
  const bgToggle = card.querySelector('.background-toggle');
  if (bgToggle) {
    const bgContent = card.querySelector('.background-content');
    bgToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = bgToggle.getAttribute('aria-expanded') === 'true';
      if (!isOpen) {
        bgContent.style.maxHeight = bgContent.scrollHeight + 'px';
        bgToggle.setAttribute('aria-expanded', 'true');
        bgToggle.classList.add('open');
        bgContent.classList.add('open');
      } else {
        bgContent.style.maxHeight = bgContent.scrollHeight + 'px';
        requestAnimationFrame(() => { bgContent.style.maxHeight = '0px'; });
        bgToggle.setAttribute('aria-expanded', 'false');
        bgToggle.classList.remove('open');
        setTimeout(() => bgContent.classList.remove('open'), 400);
      }
    });
  }

  return card;
}

export function initBossPage(root) {
  // 默认展示最新版本
  let currentVersion = data.length ? data[data.length - 1].version : '';
  const cardStates = {};

  root.innerHTML = `
    <div class="boss-page scope-genshin">
      <header class="page-header boss-header">
        <h1>幽境 Boss 图鉴</h1>
        <p class="page-subtitle">VERSION ARCHIVE · 点击卡片翻面查看介绍与背景</p>
        <div id="boss-version-tabs" class="tabs" role="tablist" aria-label="选择版本"></div>
      </header>
      <div id="enemy-grid" class="enemy-grid"></div>
    </div>`;

  const versionTabsEl = root.querySelector('#boss-version-tabs');
  const enemyGridEl = root.querySelector('#enemy-grid');

  function renderVersionTabs() {
    versionTabsEl.innerHTML = '';
    const chain = document.createElement('div');
    chain.className = 'bead-chain';
    chain.setAttribute('role', 'tablist');

    data.forEach((versionData) => {
      const isActive = versionData.version === currentVersion;
      const btn = document.createElement('button');
      btn.className = 'bead' + (isActive ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(isActive));
      btn.title = versionData.version;
      btn.innerHTML = `<span class="bead-dot"></span><span class="bead-tip">${escapeHtml(versionData.version)}</span>`;
      btn.addEventListener('click', () => {
        currentVersion = versionData.version;
        renderVersionTabs();
        renderEnemyCards();
      });
      chain.appendChild(btn);
    });
    versionTabsEl.appendChild(chain);
  }

  function renderEnemyCards() {
    enemyGridEl.innerHTML = '';
    const versionData = data.find((v) => v.version === currentVersion);
    if (!versionData || !versionData.bosses || !versionData.bosses.length) {
      enemyGridEl.innerHTML = '<div class="empty-state"><p>该版本暂无数据</p></div>';
      return;
    }
    versionData.bosses.forEach((boss, index) => {
      enemyGridEl.appendChild(createEnemyCard(boss, versionData.version, index, cardStates));
    });
  }

  renderVersionTabs();
  renderEnemyCards();
}
