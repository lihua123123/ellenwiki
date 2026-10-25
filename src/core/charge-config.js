/**
 * charge-config.js — 充能时间轴的配置文件规范（导入 / 导出）。
 *
 * 文件格式（v1）：
 * {
 *   "format": "ellen-charge",
 *   "version": 1,
 *   "axisLength": 18,
 *   "tracks": [
 *     { "character": "雷电将军", "element": "electro", "energy": 90,
 *       "events": [ { "t": 5, "type": "burst", "count": 3, "element": "electro" } ] }
 *   ],
 *   "switches": [ { "t": 4.5, "toTrack": 3 } ]
 * }
 *
 * 约定：
 * - 轨道顺序即 T1…Tn，"character": null 表示空轨道（保留位置，切人索引不会错位）。
 * - switches[].toTrack 为 1 起始的轨道号，与界面 T1/T2 一致，方便手改。
 * - t 单位为秒，保留 1 位小数；type 为 na / skill / burst。
 * - count 为产球数量，按期望精确填写：能写成有限小数的用数字（3.5、2.25），
 *   写不成的用分数字符串（"2/3"、"8/3"）。导入时两种写法都接受。
 * - energy 为 null 表示该角色 Q 不消耗元素能量（玛薇卡、丝柯克），充能要求显示 —；
 *   写成 0 同样按 null 处理。
 * - events[].preset: true 表示这个动作点由「产球预设」批量生成，重新加载预设时会整批替换；
 *   手放的点不带该字段。
 * - 兼容 v0（旧版直接导出内部 state：tracks[].char + switches[].to）。
 *
 * 本模块不依赖 DOM，可单独用 node 测试。
 */

import { encodeCount, parseCount, formatCount } from './charge-num.js';

export const CONFIG_FORMAT = 'ellen-charge';
export const CONFIG_VERSION = 1;

export const EVENT_TYPES = ['na', 'skill', 'burst', 'favonius'];
export const ELEMENTS = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro', 'colorless'];

const AXIS_MIN = 6;
const AXIS_MAX = 60;
const MAX_TRACKS = 4;
const MAX_COUNT = 20;
const MIN_SWITCH_GAP = 0.3;

const round1 = (n) => Math.round(n * 10) / 10;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------------- 导出 ---------------- */

export function buildConfig(state) {
  const axisLength = round1(clamp(Number(state.axisLength) || AXIS_MIN, AXIS_MIN, AXIS_MAX));
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    axisLength,
    tracks: (state.tracks || []).map((tr) => ({
      character: tr.char ? tr.char.name : null,
      element: tr.char ? tr.char.element : null,
      /* null = 该角色 Q 不消耗元素能量（玛薇卡 / 丝柯克），不能兜底成数值 */
      energy: tr.char && tr.char.energy != null ? Number(tr.char.energy) : null,
      events: (tr.events || [])
        .slice()
        .sort((a, b) => a.t - b.t)
        .map((ev) => ({
          t: round1(ev.t),
          type: ev.type,
          count: encodeCount(ev.count),
          element: ev.element,
          ...(ev.src === 'preset' ? { preset: true } : {}),
        })),
    })),
    switches: (state.switches || [])
      .slice()
      .sort((a, b) => a.t - b.t)
      .map((s) => ({ t: round1(s.t), toTrack: s.to + 1 })),
  };
}

export function serializeConfig(state) {
  return JSON.stringify(buildConfig(state), null, 2);
}

/* ---------------- 汇总（弹窗里显示的摘要） ---------------- */

export function summarizeConfig(config) {
  const tracks = config.tracks || [];
  const events = tracks.flatMap((t) => t.events || []);
  return {
    axisLength: config.axisLength,
    tracks: tracks.length,
    filled: tracks.filter((t) => t.character).length,
    events: events.length,
    orbs: events.filter((e) => parseCount(e.count) > 0).length,
    orbCount: events.reduce((s, e) => s + Math.max(0, parseCount(e.count)), 0),
    switches: (config.switches || []).length,
    characters: tracks.map((t) => t.character).filter(Boolean),
  };
}

/* ---------------- 文件名 ---------------- */

function sanitizeName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
}

export function configFileName(config, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const names = (config.tracks || []).map((t) => t.character).filter(Boolean);
  const base = names.length ? sanitizeName(names.join('-')) : 'empty';
  return `ellen-charge-${base}-${stamp}.json`;
}

/* ---------------- 导入 ---------------- */

/**
 * @param {string|object} input 文件文本或已解析的对象
 * @param {{roster?: Map<string,{element:string,energy:number}>}} opts
 * @returns {{ok:boolean, errors:string[], warnings:string[], config?:object, internal?:object, legacy?:boolean}}
 */
export function parseConfig(input, opts = {}) {
  const warnings = [];
  const errors = [];
  const roster = opts.roster instanceof Map ? opts.roster : new Map();

  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: ['文件不是合法的 JSON：' + e.message], warnings };
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['配置的最外层必须是一个对象（{ … }）'], warnings };
  }

  /* --- 格式 / 版本 --- */
  let legacy = false;
  if (raw.format === CONFIG_FORMAT) {
    const v = Number(raw.version);
    if (!Number.isFinite(v)) errors.push('缺少有效的 version 字段');
    else if (v > CONFIG_VERSION) {
      return {
        ok: false,
        errors: [`文件版本 v${v} 高于本工具支持的 v${CONFIG_VERSION}，请更新后再导入`],
        warnings,
      };
    }
  } else if (Array.isArray(raw.tracks) && raw.tracks.some((t) => t && (t.char || t.events))) {
    legacy = true;
    warnings.push('检测到旧版配置（无 format 字段），已按 v0 兼容导入');
  } else {
    return {
      ok: false,
      errors: [`这不像充能时间轴的配置：缺少 "format": "${CONFIG_FORMAT}"`],
      warnings,
    };
  }

  /* --- 轴长 --- */
  let axisLength = Number(raw.axisLength);
  if (!isNum(axisLength)) {
    warnings.push(`轴长缺失或非法，已重置为 ${AXIS_MIN}s`);
    axisLength = AXIS_MIN;
  } else if (axisLength < AXIS_MIN || axisLength > AXIS_MAX) {
    const fixed = clamp(axisLength, AXIS_MIN, AXIS_MAX);
    warnings.push(`轴长 ${axisLength}s 超出 ${AXIS_MIN}–${AXIS_MAX}s，已改为 ${fixed}s`);
    axisLength = fixed;
  }
  axisLength = round1(axisLength);

  /* --- 轨道 --- */
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  if (!rawTracks.length) errors.push('配置里没有任何轨道');
  if (rawTracks.length > MAX_TRACKS) {
    errors.push(`轨道数 ${rawTracks.length} 超过上限 ${MAX_TRACKS}，无法导入`);
  }

  const tracks = rawTracks.map((rt, ti) => {
    const label = `第 ${ti + 1} 轨`;
    if (!rt || typeof rt !== 'object') {
      warnings.push(`${label}不是对象，已置为空轨道`);
      return { character: null, element: null, energy: null, events: [] };
    }

    let name = legacy ? (rt.char && rt.char.name) : rt.character;
    if (name != null && (typeof name !== 'string' || !name.trim())) {
      warnings.push(`${label}的角色名无效，已置为空轨道`);
      name = null;
    }
    name = name ? name.trim() : null;

    let element = legacy ? (rt.char && rt.char.element) : rt.element;
    let energy = legacy ? (rt.char && rt.char.energy) : rt.energy;
    const known = name ? roster.get(name) : null;

    if (!name) {
      if (Array.isArray(rt.events) && rt.events.length) {
        warnings.push(`${label}没有角色，其 ${rt.events.length} 个动作点已丢弃`);
      }
      return { character: null, element: null, energy: null, events: [] };
    }

    if (!ELEMENTS.includes(element)) {
      if (known) {
        warnings.push(`${label}「${name}」的元素无效，已按图鉴取 ${known.element}`);
        element = known.element;
      } else {
        errors.push(`${label}「${name}」缺少有效元素，无法确定轨道颜色与同色判定`);
        element = 'colorless';
      }
    }

    const knownEnergy = known && known.energy != null && isNum(Number(known.energy))
      ? Number(known.energy) : null;
    /* 图鉴里没有的角色无法判断是否「无能量」，按旧默认 80 */
    const fallbackEnergy = known ? knownEnergy : 80;
    if (energy === null || energy === undefined || energy === '') {
      energy = fallbackEnergy; // 文件未写：跟随图鉴（可能为 null = 不消耗元素能量）
    } else {
      const n = Number(energy);
      if (!isNum(n) || n < 0 || n > 999) {
        warnings.push(`${label}「${name}」的能量无效，已取${fallbackEnergy == null ? '「无」' : ' ' + fallbackEnergy}`);
        energy = fallbackEnergy;
      } else {
        energy = n === 0 ? null : Math.round(n); // 0 也视为不消耗能量
      }
    }

    const events = [];
    (Array.isArray(rt.events) ? rt.events : []).forEach((ev, ei) => {
      const at = `${label}第 ${ei + 1} 个动作点`;
      if (!ev || typeof ev !== 'object') {
        warnings.push(`${at}不是对象，已跳过`);
        return;
      }
      let t = Number(ev.t);
      if (!isNum(t)) {
        warnings.push(`${at}缺少时间，已跳过`);
        return;
      }
      if (t < 0 || t > axisLength) {
        const fixed = clamp(round1(t), 0, axisLength);
        warnings.push(`${at}时间 ${t}s 超出轴长，已改为 ${fixed}s`);
        t = fixed;
      }
      t = round1(t);

      const type = EVENT_TYPES.includes(ev.type) ? ev.type : null;
      if (!type) {
        warnings.push(`${at}类型「${ev.type}」无法识别（应为 na / skill / burst），已跳过`);
        return;
      }

      let count = parseCount(ev.count);
      if (count < 0) {
        warnings.push(`${at}数量为负，已改为 0`);
        count = 0;
      } else if (count > MAX_COUNT) {
        warnings.push(`${at}数量 ${formatCount(count)} 超过上限，已改为 ${MAX_COUNT}`);
        count = MAX_COUNT;
      }

      let elem = ev.element;
      if (!ELEMENTS.includes(elem)) {
        warnings.push(`${at}的产球元素无效，已取轨道元素 ${element}`);
        elem = element;
      }

      const rec = { t, type, count, element: elem };
      if (ev.preset === true) rec.src = 'preset'; // 预设生成的点，再次加载预设时可整批替换
      events.push(rec);
    });
    events.sort((a, b) => a.t - b.t);
    return { character: name, element, energy, events };
  });

  /* --- 切人 --- */
  const rawSwitches = Array.isArray(raw.switches) ? raw.switches : [];
  const parsed = [];
  rawSwitches.forEach((s, si) => {
    const at = `第 ${si + 1} 个切人`;
    if (!s || typeof s !== 'object') {
      warnings.push(`${at}不是对象，已跳过`);
      return;
    }
    let t = Number(s.t);
    if (!isNum(t)) {
      warnings.push(`${at}缺少时间，已跳过`);
      return;
    }
    if (t < 0 || t > axisLength) {
      const fixed = clamp(round1(t), 0, axisLength);
      warnings.push(`${at}时间 ${t}s 超出轴长，已改为 ${fixed}s`);
      t = fixed;
    }
    // v1 用 1 起始的 toTrack；v0 用 0 起始的 to
    const num = legacy ? Number(s.to) + 1 : Number(s.toTrack);
    if (!Number.isInteger(num) || num < 1 || num > tracks.length) {
      warnings.push(`${at}目标轨道 ${Number.isFinite(num) ? num : s.toTrack} 不存在（共 ${tracks.length} 轨），已跳过`);
      return;
    }
    parsed.push({ t: round1(t), toTrack: num });
  });

  parsed.sort((a, b) => a.t - b.t);
  const switches = [];
  let current = 1;
  parsed.forEach((s) => {
    const prev = switches[switches.length - 1];
    if (prev && s.t - prev.t < MIN_SWITCH_GAP - 1e-9) {
      warnings.push(`切人 ${s.t}s 与上一个间隔不足 ${MIN_SWITCH_GAP}s，已忽略`);
      return;
    }
    if (s.toTrack === current) {
      warnings.push(`切人 ${s.t}s 的目标与当前轨道相同，已忽略`);
      return;
    }
    switches.push(s);
    current = s.toTrack;
  });

  const config = { format: CONFIG_FORMAT, version: CONFIG_VERSION, axisLength, tracks, switches };
  const internal = {
    axisLength,
    tracks: tracks.map((t) => ({
      char: t.character ? { name: t.character, element: t.element, energy: t.energy } : null,
      events: t.events.map((ev) => ({ ...ev })),
    })),
    switches: switches.map((s) => ({ t: s.t, to: s.toTrack - 1 })),
    playhead: 0,
  };

  return { ok: errors.length === 0, errors, warnings, config, internal, legacy };
}

/* ---------------- 下载 ---------------- */

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
