// 运行：node scripts/test-charge-config.mjs（或 npm run test:charge）
import { buildConfig, parseConfig, summarizeConfig, configFileName, CONFIG_FORMAT } from '../src/core/charge-config.js';
import { expandPreset, presetOf, E_PRESETS } from '../src/data/charge-presets.js';
import { characters, elementIds } from '../src/data/characters.js';
import { parseCount, formatCount, encodeCount } from '../src/core/charge-num.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' → ' + JSON.stringify(a));

const roster = new Map([
  ['雷电将军', { element: 'electro', energy: 90 }],
  ['香菱', { element: 'pyro', energy: 80 }],
]);

const state = {
  axisLength: 18,
  tracks: [
    { char: { name: '雷电将军', element: 'electro', energy: 90 }, events: [{ t: 5, type: 'burst', count: 3, element: 'electro' }] },
    { char: null, events: [] },
    { char: { name: '香菱', element: 'pyro', energy: 80 }, events: [{ t: 4, type: 'skill', count: 2, element: 'pyro' }, { t: 6.04, type: 'na', count: 0, element: 'pyro' }] },
  ],
  switches: [{ t: 12, to: 0 }, { t: 4.5, to: 2 }],
  playhead: 7.3,
};

console.log('[1] 导出结构');
const cfg = buildConfig(state);
eq(Object.keys(cfg).sort(), ['axisLength', 'format', 'switches', 'tracks', 'version'], '顶层字段');
eq([cfg.format, cfg.version, cfg.axisLength], [CONFIG_FORMAT, 1, 18], 'format/version/axisLength');
eq(cfg.switches, [{ t: 4.5, toTrack: 3 }, { t: 12, toTrack: 1 }], '切人按时间排序、toTrack 1 起始');
eq(cfg.tracks[1], { character: null, element: null, energy: null, events: [] }, '空轨道保留位置');
eq(cfg.tracks[2].events.map(e => e.t), [4, 6], '动作点排序并四舍五入到 0.1（6.04→6）');
ok(!('playhead' in cfg), '不导出指针位置 / 运行态');

console.log('[2] 往返一致');
const rt = parseConfig(JSON.stringify(cfg), { roster });
ok(rt.ok, '导出再导入通过校验');
eq(rt.warnings, [], '无警告');
eq(rt.internal.tracks.map(t => t.char && t.char.name), ['雷电将军', null, '香菱'], '角色名还原');
eq(rt.internal.switches, [{ t: 4.5, to: 2 }, { t: 12, to: 0 }], '切人索引 0 起始还原');
eq(rt.internal.playhead, 0, '导入后指针归零');

console.log('[3] v0 旧格式兼容');
const v0 = { axisLength: 18, tracks: state.tracks, switches: state.switches };
const r0 = parseConfig(v0, { roster });
ok(r0.ok && r0.legacy, 'v0 可用并标记 legacy');
eq(r0.internal.switches, [{ t: 4.5, to: 2 }, { t: 12, to: 0 }], 'v0 切人索引正确');
ok(r0.warnings.some(w => w.includes('旧版')), '给出兼容提示');

console.log('[4] 阻断性错误');
ok(!parseConfig('not json', { roster }).ok, '非 JSON 被拒');
ok(!parseConfig({ hello: 1 }, { roster }).ok, '缺少 format 被拒');
const future = parseConfig({ format: CONFIG_FORMAT, version: 9, axisLength: 18, tracks: [{ character: '香菱', element: 'pyro', energy: 80, events: [] }] }, { roster });
ok(!future.ok && future.errors[0].includes('v9'), '高于支持版本被拒');
const tooMany = parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: Array.from({ length: 5 }, () => ({ character: '香菱', element: 'pyro', energy: 80, events: [] })) }, { roster });
ok(!tooMany.ok && tooMany.errors[0].includes('超过上限'), '5 轨道被拒');
ok(!parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [] }, { roster }).ok, '空轨道被拒');

console.log('[5] 自动修正 + 警告');
const dirty = parseConfig({
  format: CONFIG_FORMAT, version: 1, axisLength: 999,
  tracks: [
    { character: '香菱', element: 'nope', energy: 'x', events: [
      { t: 999, type: 'skill', count: 99, element: 'zzz' },
      { t: 2, type: 'dance', count: 1, element: 'pyro' },
      { t: -3, type: 'na', count: -2, element: 'pyro' },
    ] },
  ],
  switches: [{ t: 4.5, toTrack: 1 }, { t: 4.6, toTrack: 1 }, { t: 8, toTrack: 1 }],
}, { roster });
ok(dirty.ok, '可修正的问题不阻断');
eq(dirty.internal.axisLength, 60, '轴长夹到上限 60');
eq(dirty.internal.tracks[0].char.element, 'pyro', '元素回落到图鉴');
eq(dirty.internal.tracks[0].char.energy, 80, '能量回落到图鉴');
eq(dirty.internal.tracks[0].events, [{ t: 0, type: 'na', count: 0, element: 'pyro' }, { t: 60, type: 'skill', count: 20, element: 'pyro' }], '时间/数量夹取 + 未知类型丢弃 + 按时间排序');
eq(dirty.internal.switches.length, 0, '首尾间隔不足 / 与当前轨相同的切人都被忽略');
ok(dirty.warnings.length >= 7, `警告条数 ${dirty.warnings.length} ≥ 7`);

console.log('[6] 跨轨切人 + 未知角色');
const cross = parseConfig({
  format: CONFIG_FORMAT, version: 1, axisLength: 18,
  tracks: [
    { character: '雷电将军', element: 'electro', energy: 90, events: [] },
    { character: '未知角色', element: 'dendro', energy: 60, events: [{ t: 3, type: 'na', count: 1, element: 'dendro' }] },
    { character: '香菱', element: 'pyro', energy: 80, events: [] },
  ],
  switches: [{ t: 4, toTrack: 3 }],
}, { roster });
ok(cross.ok, '未知角色按文件内元素/能量保留');
eq(cross.internal.switches, [{ t: 4, to: 2 }], '可跨轨跳（T1→T3）');

console.log('[8] 无元素能量的角色（玛薇卡 / 丝柯克）');
const roster2 = new Map([...roster, ['玛薇卡', { element: 'pyro', energy: null }]]);
const noCfg = buildConfig({ axisLength: 18, tracks: [{ char: { name: '玛薇卡', element: 'pyro', energy: null }, events: [] }], switches: [] });
eq(noCfg.tracks[0].energy, null, '导出保留 null（不写成 0 / 80）');
eq(parseConfig(noCfg, { roster: roster2 }).internal.tracks[0].char.energy, null, '往返后仍为 null');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '玛薇卡', element: 'pyro', energy: 0, events: [] }] }, { roster: roster2 }).internal.tracks[0].char.energy, null, '文件写 0 也按无能量处理');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '玛薇卡', element: 'pyro', events: [] }] }, { roster: roster2 }).internal.tracks[0].char.energy, null, '缺省 energy 跟随图鉴「无」');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '玛薇卡', element: 'pyro', energy: 'x', events: [] }] }, { roster: roster2 }).internal.tracks[0].char.energy, null, '非法能量回落图鉴「无」');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '图鉴外的人', element: 'pyro', events: [] }] }, { roster: roster2 }).internal.tracks[0].char.energy, 80, '图鉴外角色缺能量仍兜底 80');

console.log('[7] 摘要 + 文件名');const sum = summarizeConfig(cfg);
eq([sum.tracks, sum.filled, sum.events, sum.orbs, sum.orbCount, sum.switches], [3, 2, 3, 2, 5, 2], '摘要计数');
const fn = configFileName(cfg, new Date(2026, 9, 24, 22, 40));
ok(/^ellen-charge-雷电将军-香菱-20261024-2240\.json$/.test(fn), '文件名 ' + fn);
ok(/^ellen-charge-empty-/.test(configFileName({ tracks: [] })), '无角色时文件名兜底');

console.log('[9] 产球预设展开');
ok(!!presetOf('沃雅妮莎'), '沃雅妮莎 有预设');
ok(presetOf('路人甲') === null, '无预设返回 null');
const wv = expandPreset(presetOf('沃雅妮莎'), 2, 18);
eq(wv.map((e) => e.t), [5, 8, 11, 14, 17], '召唤物先冷却：首次产球在 +3s');
eq(wv.map((e) => e.count), [1, 1, 1, 1, 1], '每次 1 球，共 5 次（持续 16s 内）');
eq(wv.every((e) => e.type === 'skill'), true, '类型都是战技');
eq(expandPreset(presetOf('沃雅妮莎'), 4, 18).map((e) => e.t), [7, 10, 13, 16], '改首个 E=4 后重排（首次 +3s）');
eq(expandPreset(presetOf('沃雅妮莎'), 30, 18), [], '首个 E 超出轴长时为空');
const withTimes = expandPreset({ steps: [{ at: 0, count: 1, every: 2, times: 3 }] }, 1, 18);
eq(withTimes.map((e) => e.t), [1, 3, 5], 'times 限制重复次数');
eq(expandPreset({ steps: [{ at: 0, count: 1 }, { at: 0, count: 2 }] }, 0, 18).length, 1, '同一时刻去重');

console.log('[10] 预设数据自检');
const rosterNames = new Set();
for (const el of elementIds) for (const c of characters[el] || []) rosterNames.add(c.name);
const presetNames = Object.keys(E_PRESETS);
eq(presetNames.filter((n) => !rosterNames.has(n)), [], `预设键名都能在图鉴里找到（共 ${presetNames.length} 条）`);
const bad = [];
for (const [n, p] of Object.entries(E_PRESETS)) {
  const hasSteps = Array.isArray(p.steps) && p.steps.length;
  const hasSummons = Array.isArray(p.summons) && p.summons.length;
  if (!hasSteps && !hasSummons) { bad.push(n + ': 既无 steps 也无 summons'); continue; }
  for (const st of p.steps || []) {
    if (!Number.isFinite(Number(st.at)) || Number(st.at) < 0) bad.push(n + ': at 非法');
    if (!Number.isFinite(parseCount(st.count)) || parseCount(st.count) < 0) bad.push(n + ': count 非法');
    if (st.every != null && !(Number(st.every) > 0)) bad.push(n + ': every 非法');
    if (st.times != null && !(Number(st.times) > 0)) bad.push(n + ': times 非法');
  }
  for (const sm of p.summons || []) {
    if (!Number.isFinite(Number(sm.at)) || Number(sm.at) < 0) bad.push(n + ': summons.at 非法');
    if (!(Number(sm.every) > 0)) bad.push(n + ': summons.every 非法');
    if (!Number.isFinite(parseCount(sm.count)) || parseCount(sm.count) < 0) bad.push(n + ': summons.count 非法');
  }
  if (p.cd != null && !(Number(p.cd) > 0)) bad.push(n + ': cd 非法');
  if (p.duration != null && !(Number(p.duration) > 0)) bad.push(n + ': duration 非法');
  if (!expandPreset(p, 0, 60).length) bad.push(n + ': 60s 内无动作点');
}
eq(bad, [], '所有预设结构与展开结果合法');

console.log('[11] 产球数按精确期望保存（分数写法）');
const fracState = { axisLength: 18, tracks: [{ char: { name: '香菱', element: 'pyro', energy: 80 }, events: [{ t: 3, type: 'skill', count: 2 / 3, element: 'pyro' }] }], switches: [] };
const fracCfg = buildConfig(fracState);
eq(fracCfg.tracks[0].events[0].count, '2/3', '导出写成 "2/3" 而不是 0.67');
ok(Math.abs(parseConfig(fracCfg, { roster }).internal.tracks[0].events[0].count - 2 / 3) < 1e-9, '导入还原成精确值');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '香菱', element: 'pyro', energy: 80, events: [{ t: 1, type: 'skill', count: '9/20', element: 'pyro' }] }] }, { roster }).internal.tracks[0].events[0].count, 0.45, '支持 "9/20" 写法');
eq(parseConfig({ format: CONFIG_FORMAT, version: 1, axisLength: 18, tracks: [{ character: '香菱', element: 'pyro', energy: 80, events: [{ t: 1, type: 'skill', count: 2.25, element: 'pyro' }] }] }, { roster }).internal.tracks[0].events[0].count, 2.25, '有限小数原样保留');
eq(formatCount(2 / 3), '2/3', '2/3 显示为分数');
eq(formatCount(1 / 3), '1/3', '1/3 显示为分数');
eq([formatCount(0.45), formatCount(2.25), formatCount(3.5), formatCount(5)], ['0.45', '2.25', '3.5', '5'], '有限小数/整数仍用小数');
eq(encodeCount(4 / 3), '4/3', '4/3 编码为分数');
eq(summarizeConfig(fracCfg).orbCount, 2 / 3, '摘要合计保留精确值');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
