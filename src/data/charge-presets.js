/**
 * charge-presets.js — 「后台持续 / 召唤物 / 协同」产球角色的 E 预设。
 *
 * 用途：这些角色不是放下 E 就一次性出球，产球分布在 E 之后的若干时间点上。
 *      轨道头点「预设」→ 填第一个 E 的时间 → 一次性铺出整串 E。
 *
 * 一个角色一条：
 *   note    说明文字（弹窗里显示，写清机制与折算方式）
 *   steps   产球步骤，相对「第一个 E」的时间
 *     at      相对首个 E 的秒数（必填）
 *     count   该点产球数量（必填，0 = 不产球）
 *     type    动作类型：skill（默认）/ na / burst
 *     every   重复间隔（秒）；填了就每隔 every 秒再来一个，直到轴末端
 *     times   配合 every：最多重复几次（不填 = 一直铺到轴末）
 *     element 覆盖产球元素（默认跟随角色元素，一般不用填）
 *
 * 填写口径（如实填写，不做等价换算）：
 *   · every 用数据里的真实攻击间隔（`2 s/次`、`2.8 s/次`、`1.9 s` 等），首次产球放在 +间隔；
 *   · count 按期望如实填写，可写分数或小数：
 *       0~1 个（1:2）→ '2/3'；0~1 个（1:1）→ '1/2'（或 0.5）；
 *       0~1 个（11:9）→ '9/20'（或 0.45）；1~2 个（2:1）→ '4/3'；1 个/次 → 1；
 *   · 召唤物先走冷却再攻击：首次产球在 +攻击间隔；协同攻击没有等待，at 写 0；
 *   · 有次数上限的（最多 5 次 / 只有前 6 次）在 summons 里用 times 截断；
 *   · duration 写持续时间，到点就停，且不超轴长。
 *
 * 全角色的数据出处：
 *   · 瞬时产球 / 站场整轮合计 → src/data/charge-particles.js（101 位）
 *   · 召唤物 / 协同 → 本文件（23 条预设）
 *   · 芭芭拉、诺艾尔、珐露珊 → 无产球
 *   · 米提亚、瓦列里 → 测试服角色，暂无数据
 */

import { parseCount } from '../core/charge-num.js';

export const E_PRESETS = {
  /* ============ 召唤物 / 协同 ============
   * duration   持续时间（秒）：到点后不再生成，且同时受轴长限制
   * summons    每个召唤物的首发时刻 at（= 出场冷却后的第一次攻击）、攻击间隔 every、每次产球数 count
   * cd         产球内置冷却：两次产球至少间隔这么久
   * 协同攻击没有出场等待，at 直接写 0。
   */

  /* ── 火系 ── */
  '迪希雅': {
    note: '净焰剑狱协同（协同无出场等待）：每 2.5 s 一次、每次 1 球；持续 12 s',
    duration: 12,
    summons: [{ at: 0, every: 2.5, count: 1 }],
  },
  '香菱': {
    note: '锅巴 1 s/次、每次 1 球；持续 4 s',
    duration: 4,
    summons: [{ at: 1, every: 1, count: 1 }],
  },
  '旅行者（火）': {
    note: '焰烈之槛 1 s/次（灼火之槛 3 s/次），共用 2.9 s 产球 CD；持续 6 s',
    duration: 6,
    cd: 2.9,
    summons: [{ at: 1, every: 1, count: 1 }],
  },

  /* ── 水系 ── */
  '珊瑚宫心海': {
    note: '化海月每 2 s 一次、0~1 个（1:2 → 2/3）；只有前 6 次攻击产球；持续 12 s',
    duration: 12,
    summons: [{ at: 2, every: 2, count: '2/3', times: 6 }],
  },
  '芙宁娜': {
    note: '乌瑟 2.9 s / 海薇玛 1.19 s / 谢贝蕾妲 4.8 s，三者共享 2.5 s 产球 CD 与 30 s 持续',
    duration: 30,
    cd: 2.5,
    summons: [
      { at: 2.9, every: 2.9, count: 1 },
      { at: 1.19, every: 1.19, count: 1 },
      { at: 4.8, every: 4.8, count: 1 },
    ],
  },
  '哥伦比娅': {
    note: '引力涟漪每 2 s 攻击一次，2 次攻击耗 4 s 已覆盖 3.5 s 产球 CD → 每 4 s 一次、1~2 个（2:1 → 4/3）；持续 25 s',
    duration: 25,
    summons: [{ at: 4, every: 4, count: '4/3' }],
  },
  '沃雅妮莎': {
    note: '唤春角笛：召唤后先冷却，第一次攻击在 +3 s 并产 1 球，之后每 3 s 一球；持续 16 s',
    duration: 16,
    summons: [{ at: 3, every: 3, count: 1 }],
  },

  /* ── 雷系 ── */
  '菲谢尔': {
    note: '奥兹每 1 s 攻击、0~1 个（1:2 → 2/3）；持续 10 s',
    duration: 10,
    summons: [{ at: 1, every: 1, count: '2/3' }],
  },
  '八重神子': {
    note: '三株杀生樱分别在 0 / 0.3 / 0.6 s 落位，各 2.8 s 攻击一次，共享 2.5 s 产球 CD；持续 14 s',
    duration: 14,
    cd: 2.5,
    summons: [
      { at: 2.8, every: 2.8, count: 1 },
      { at: 3.1, every: 2.8, count: 1 },
      { at: 3.4, every: 2.8, count: 1 },
    ],
  },
  '久岐忍': {
    note: '越祓草轮每 1.5 s 一次、0~1 个（11:9 → 9/20）；持续 12 s',
    duration: 12,
    summons: [{ at: 1.5, every: 1.5, count: '9/20' }],
  },
  '伊涅芙': {
    note: '薇尔琪塔每 2 s 一次、0~1 个（1:2 → 2/3）；持续 20 s',
    duration: 20,
    summons: [{ at: 2, every: 2, count: '2/3' }],
  },
  '雷电将军': {
    note: '雷罚恶曜之眼（协同，无出场等待）：每 1 s 一次、0~1 个（1:1 → 1/2）；持续 25 s',
    duration: 25,
    summons: [{ at: 0, every: 1, count: '1/2' }],
  },

  /* ── 冰系 ── */
  '七七': {
    note: '寒病鬼差协同（无出场等待）：每 2.2 s 攻击一次，产球 CD 6 s；持续 15 s',
    duration: 15,
    cd: 6,
    summons: [{ at: 0, every: 2.2, count: 2 }],
  },
  '莱依拉': {
    note: '飞星每 6 s 攻击一次（已覆盖 3 s 产球 CD），每次 1~2 个（2:1 → 4/3）；持续 12 s',
    duration: 12,
    summons: [{ at: 6, every: 6, count: '4/3' }],
  },

  /* ── 岩系 ── */
  '千织': {
    note: '袖 3.6 s/次、1~2 个（4:1 → 1.2 球）；持续 17 s',
    duration: 17,
    summons: [{ at: 3.6, every: 3.6, count: '6/5' }],
  },
  '钟离': {
    note: '岩脊共鸣（召唤物）：每 2 s 一次、0~1 个（1:1 → 1/2）；持续 30 s',
    duration: 30,
    summons: [{ at: 2, every: 2, count: '1/2' }],
  },
  '阿贝多': {
    note: '刹那之花（协同，无出场等待）：每 2 s 一次、0~1 个（1:2 → 2/3）；持续 30 s',
    duration: 30,
    summons: [{ at: 0, every: 2, count: '2/3' }],
  },
  '卡齐娜': {
    note: '冲天转转每 2 s 一次、0~1 个（1:2 → 2/3）；持续 12 s',
    duration: 12,
    summons: [{ at: 2, every: 2, count: '2/3' }],
  },

  /* ── 草系 ── */
  '瑶瑶': {
    note: '月桂·抛掷型 1 s/次，产球 CD 1.5 s → 实际每 2 s 一球；持续 10 s',
    duration: 10,
    cd: 1.5,
    summons: [{ at: 1, every: 1, count: 1 }],
  },
  '艾梅莉埃': {
    note: '纯露芳息 1.5 s/次，产球 CD 2.5 s → 实际每 3 s 一球；持续 22 s',
    duration: 22,
    cd: 2.5,
    summons: [{ at: 1.5, every: 1.5, count: 1 }],
  },
  '菈乌玛': {
    note: '霜林圣域 2 s/次，产球 1~2 个 / 3.3 s（2:1 → 4/3）；持续 15 s',
    duration: 15,
    cd: 3.3,
    summons: [{ at: 2, every: 2, count: '4/3' }],
  },
  '纳西妲': {
    note: '灭净三业（协同，无出场等待）2.5 s 触发、产球 CD 7 s → 每 7 s 3 球；持续 25 s',
    duration: 25,
    steps: [{ at: 0, count: 3, every: 7 }],
  },
  '莉奈娅': {
    note: '露米·超厉害形态 2.5 s/次，产球 3 个 / 9 s；持续 25 s',
    duration: 25,
    cd: 9,
    summons: [{ at: 2.5, every: 2.5, count: 3 }],
  },
};

export function presetOf(name) {
  return E_PRESETS[name] || null;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * 把预设展开成具体动作点。
 * @param {object} preset 预设对象
 * @param {number} firstT 第一个 E 的时间（秒）
 * @param {number} axisLength 轴总长（秒）
 * @returns {{t:number,type:string,count:number,element:string|null}[]}
 */
export function expandPreset(preset, firstT, axisLength) {
  const t0 = Math.max(0, Number(firstT) || 0);
  const axis = Math.max(0, Number(axisLength) || 0);
  const dur = Number(preset && preset.duration) || 0;
  /* 持续时间与轴长双上限：谁先到就在哪停 */
  const limit = dur > 0 ? Math.min(axis, t0 + dur) : axis;

  const out = [];
  const seen = new Set();
  const push = (t, count, type, element) => {
    const tt = round1(t);
    const key = `${tt}|${type || 'skill'}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ t: tt, type: type || 'skill', count, element: element || null });
  };

  /* ── 召唤物 / 协同：按各自的攻击间隔出手，共享产球 CD，再按 CD 过滤 ── */
  if (preset && Array.isArray(preset.summons) && preset.summons.length) {
    const cd = Number(preset.cd) || 0;
    const attacks = [];
    for (const s of preset.summons) {
      const at = Number(s.at) || 0;
      const every = Number(s.every) || 0;
      const count = Math.max(0, parseCount(s.count));
      const times = Number(s.times) || 0;
      if (every <= 0) {
        const t = t0 + at;
        if (t <= limit + 1e-9) attacks.push({ t, count });
        continue;
      }
      const cap = times > 0 ? times : 500;
      for (let k = 0; k < cap; k++) {
        const t = t0 + at + k * every;
        if (t > limit + 1e-9) break;
        attacks.push({ t, count });
      }
    }
    attacks.sort((a, b) => a.t - b.t);
    let last = -Infinity;
    for (const a of attacks) {
      /* 产球内置冷却：距上一次产球不足 cd 的攻击不产球 */
      if (cd > 0 && a.t - last < cd - 1e-9) continue;
      push(a.t, a.count, 'skill', null);
      last = a.t;
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /* ── 简单写法：固定节奏/固定次数 ── */
  for (const step of preset && preset.steps ? preset.steps : []) {
    const at = Number(step.at) || 0;
    /* 区间值按期望如实填写，支持 "2/3" 这类分数写法，不做等价换算 */
    const count = Math.max(0, parseCount(step.count));
    const type = step.type || 'skill';
    const every = Number(step.every) || 0;
    const times = Number(step.times) || 0;
    const element = step.element || null;

    if (every <= 0) {
      const t = t0 + at;
      if (t <= limit + 1e-9) push(t, count, type, element);
      continue;
    }
    const cap = times > 0 ? times : 500; // 保险上限，避免异常数据死循环
    for (let k = 0; k < cap; k++) {
      const t = t0 + at + k * every;
      if (t > limit + 1e-9) break;
      push(t, count, type, element);
    }
  }

  return out.sort((a, b) => a.t - b.t);
}
