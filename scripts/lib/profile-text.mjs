/**
 * profile-text.mjs — 角色技能描述文本的解析工具（generate-profiles.mjs 与 sync-buffs.mjs 共用）。
 *
 * 约定（与页面渲染一致）：
 *   - 描述里「标题 + 正文」式的状态说明块会被抽成 states（页面做成悬停术语）
 *   - 结尾连续的无机制词段落判为「角色逸闻」，抽成 lore（页面用附录色斜体显示）
 *   - 其余为正文 description
 * 两边用同一套规则解析，才能把「基础描述 → 加强描述」的差异算干净。
 */

/** 去掉游戏内富文本标记（{LINK} / <color> / 其他标签） */
export const stripHtml = (s) => String(s || '')
  .replace(/\{LINK#[^}]*\}/g, '')   // 游戏内链接标记 {LINK#S11325}文字{/LINK}
  .replace(/\{\/LINK\}/g, '')
  .replace(/<color=[^>]*>/gi, '')   // 游戏内颜色标记 <color=#FF9999FF>
  .replace(/<\/color>/gi, '')
  .replace(/<[^>]+>/g, '')
  .trim();

/** 攻击动作类小节标题：保持正文可见，不转悬停 */
export const ACTION_TITLES = new Set(['普通攻击', '重击', '下落攻击', '点按', '长按', '瞄准射击', '瞄准', '蓄力', '冲刺', '元素战技', '元素爆发', '连携技', '终结技', '空中攻击']);

/** 状态说明块正文特征 */
export const STATE_BODY_RE = /状态|进入|解除|持续消耗|耗尽|存在期间|结束时|结束时/;

export const isStateTitle = (t) => {
  const s = t.trim();
  return s.length >= 2 && s.length <= 14 && !/[。，、：]/.test(s) && !ACTION_TITLES.has(s);
};

/** 逸闻判定：去掉引文后不含机制词；且不以机制连接词开头。
 * 允许段内换行（逸闻常为多行连贯文本），换行仅作普通空白处理 */
export const MECH_RE = /状态|伤害|攻击|元素|冷却|持续|回复|恢复|提升|降低|命中|触发|消耗|获得|倍率|夜魂|燃素|战意|护盾|治疗|暴击|防御|生命|月兆|队伍|\d|%|秒|点/;
export const MECH_PREFIX = /^(此外|注|该效果|同时|并且|当|若|处于|施放|通过|点按|长按|短按|瞄准|在.+时)/;

export const isLorePara = (p) => {
  const flat = p.replace(/\n+/g, '');
  return /「[^」]+」/.test(flat)
    ? !MECH_RE.test(flat.replace(/「[^」]*」/g, ''))
    : flat.includes('。') && flat.length >= 12 && !MECH_RE.test(flat) && !MECH_PREFIX.test(flat);
};

/** 把清洗后的描述拆成「正文 + 逸闻」：从末尾连续截取逸闻段落，至少给正文留一段 */
export function splitLore(desc) {
  const paras = String(desc || '').split('\n\n');
  if (paras.length < 2) return { main: desc, lore: '' };
  let cut = paras.length;
  while (cut - 1 > 0 && isLorePara(paras[cut - 1])) cut--;
  if (cut === paras.length) return { main: desc, lore: '' };
  return {
    main: paras.slice(0, cut).join('\n\n'),
    lore: paras.slice(cut).join('\n\n'),
  };
}

/** 完整描述解析：提取「标题+正文」式状态说明块（转为悬停信息），剩余部分再拆逸闻 */
export function parseDescription(raw) {
  const paras = stripHtml(raw).split('\n\n');
  const states = [];
  const kept = [];
  for (const para of paras) {
    const lines = para.split('\n');
    if (lines.length >= 2 && isStateTitle(lines[0]) && STATE_BODY_RE.test(lines.slice(1).join(''))) {
      states.push({ name: lines[0].trim(), text: lines.slice(1).join('\n') });
    } else {
      kept.push(para);
    }
  }
  const { main, lore } = splitLore(kept.join('\n\n'));
  return { description: main, lore, states };
}
