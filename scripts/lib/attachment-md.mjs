/**
 * attachment-md.mjs — 向 content/attachment/元素附着及产球.md 追加新角色的占位小节。
 *
 * 数据源同步到「本地还没有的角色」时调用：按元素分组把小节插到该组末尾；
 * 已存在同名小节则不动（幂等）。附着量与产球数据仍需人工按游戏实测补。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from './local-store.mjs';

export const MD_FILE = join(CONTENT, 'attachment', '元素附着及产球.md');

/** 元素名（数据源文案）→ 附着 md 的分节标题 */
export const ELEMENT_SECTION = {
  火元素: '火系', 火: '火系',
  水元素: '水系', 水: '水系',
  草元素: '草系', 草: '草系',
  雷元素: '雷系', 雷: '雷系',
  冰元素: '冰系', 冰: '冰系',
  风元素: '风系', 风: '风系',
  岩元素: '岩系', 岩: '岩系',
};

export function attachmentHas(name) {
  try {
    return readFileSync(MD_FILE, 'utf-8').includes(`## ${name}（`);
  } catch {
    return true;
  }
}

/**
 * 追加占位小节。element 传元素名（如「冰元素」），weaponType 传武器类型（如「单手剑」）。
 * 返回 true = 已追加（dry 模式返回「会追加」）。
 */
export function appendPlaceholder(name, { element = '', weaponType = '', energy = '' } = {}, { dry = false } = {}) {
  const sectionHead = ELEMENT_SECTION[element] || '';
  if (!sectionHead) return false;
  try {
    const md = readFileSync(MD_FILE, 'utf-8');
    if (md.includes(`## ${name}（`)) return false;
    if (!md.includes(`# ${sectionHead}`)) return false;

    const start = md.indexOf(`# ${sectionHead}`);
    const next = md.indexOf('\n# ', start + 1);
    const end = next === -1 ? md.length : next;

    const block = [
      '',
      `## ${name}（${weaponType}/${energy || 0}）`,
      '',
      '| 技能 | 元素量 | 附着规则 | 产球 | 备注 | 抗打断 |',
      '| :-: | :-: | :-: | :-: | :-: | :-: |',
      '| E |  |  |  |  |  |',
      '| Q |  |  |  |  |  |',
      '',
    ].join('\n');

    if (dry) return true;
    writeFileSync(MD_FILE, md.slice(0, end).replace(/\s*$/, '\n') + block + md.slice(end), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
