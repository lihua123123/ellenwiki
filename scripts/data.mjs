/**
 * data.mjs — 数据源同步的唯一入口（`npm run data`）。
 *
 * 思路：一个数据源只需要回答三个问题 ——
 *   ① 你有哪些条目？（scan：源有、本地没有的 = 新增）
 *   ② 某一条目的完整数据是什么？（check：按名称精确复查，本地 ↔ 数据源逐字段对比，可覆盖）
 *   ③ 你能补全本地给不出的字段吗？（fill：只填本地空字段，不改已有值）
 * 三个数据源（gachabase / lunaris / genshin-db）共用同一条代码路径，见 sources/index.mjs。
 *
 * 用法：
 *   npm run data                                          交互式：选数据源 → 选动作
 *   npm run data -- gachabase scan                        扫描新增（只读，可加 --kind=角色|武器|圣遗物）
 *   npm run data -- gachabase add [--refresh] [--dry]     导入新增（--refresh = 重抓本地 beta 条目）
 *   npm run data -- lunaris check 胡桃 [--yes]            精确复查单条（--yes = 非交互直接覆盖）
 *   npm run data -- lunaris fill [名称] [--kind=weapon]   用源补全本地空字段
 *   npm run data -- --list                                列出数据源
 *
 *   npm run esdata  =  npm run data -- --beta             体验服口径（只列含体验服数据的源，add 默认 --refresh）
 *
 * 数据源写法：gachabase | lunaris | genshin-db（或序号 1 / 2 / 3）。
 */
import {
  SOURCES, getSource, scan, addNew, check, applyCheck, fill, postprocess,
  KINDS, KIND_LABEL, parseKinds, entryLabel,
} from './sources/index.mjs';
import { formatDiff, diffSummary } from './lib/json-diff.mjs';
import { ask, canPrompt, closePrompt } from './lib/prompt.mjs';
import { listLocal, writeLocal, findLocal, fileOf, relOf } from './lib/local-store.mjs';
import { appendPlaceholder } from './lib/attachment-md.mjs';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const hasFlag = (n) => argv.includes(`--${n}`);
const optOf = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : '';
};
const positional = argv.filter((a) => !a.startsWith('--'));
const BETA_ONLY = hasFlag('beta');
const DRY = hasFlag('dry');
const YES = hasFlag('yes');
const REFRESH = hasFlag('refresh') || BETA_ONLY;
const KIND_ARG = optOf('kind');
const kindsOf = (fallback) => (KIND_ARG ? parseKinds(KIND_ARG) : fallback);

/* ---------------- 展示 ---------------- */
const sourceList = () => (BETA_ONLY ? SOURCES.filter((s) => s.beta) : SOURCES);

function printSources() {
  console.log(`\n数据源（* = 含体验服 / 未实装数据）：`);
  sourceList().forEach((s, i) => console.log(`  ${i + 1}) ${s.label.padEnd(12)}${s.beta ? '*' : ' '} ${s.note}`));
}

function printUsage() {
  printSources();
  console.log(`
动作：
  scan            扫描新增（源有、本地没有；只读）
  add             导入新增（--refresh 连本地 beta 条目一起重抓、--dry 只看不写）
  check <名称>    精确复查单条：本地 ↔ 数据源逐字段对比，可覆盖（--yes 直接覆盖）
  fill [名称]     用源补全本地空字段（目前只有 lunaris 提供）

例：
  npm run data -- gachabase scan
  npm run data -- lunaris check 胡桃
  npm run data -- gachabase add --kind=weapon --dry
  npm run esdata                                   # 体验服口径（= --beta）
`);
}

/* ---------------- scan：源有、本地没有 ---------------- */
async function doScan(source, kinds) {
  const report = await scan(source, kinds);
  console.log(`\n▶ ${source.label} 扫描新增${source.beta ? '（含体验服）' : '（正式服）'}`);
  for (const [kind, r] of Object.entries(report)) {
    if (r.error) {
      console.log(`  ${KIND_LABEL[kind]}：✗ 清单抓取失败 — ${r.error}`);
      continue;
    }
    console.log(`  ${KIND_LABEL[kind]}：源 ${r.total} 条 · 本地 ${listLocal(kind).length} 条 → 新增 ${r.fresh.length} 条`);
    for (const e of r.fresh.slice(0, 40)) console.log(`     + ${entryLabel(e)}`);
    if (r.fresh.length > 40) console.log(`     … 其余 ${r.fresh.length - 40} 条省略`);
  }
  const total = Object.values(report).reduce((n, r) => n + r.fresh.length, 0);
  console.log(total ? `\n共 ${total} 条新增；导入用：npm run data -- ${source.id} add` : '\n本地已是最新。');
  return report;
}

/* ---------------- add：导入新增 ---------------- */
async function doAdd(source, kinds, { refresh = REFRESH } = {}) {
  console.log(`\n▶ ${source.label} 导入新增${refresh ? '（含重抓本地 beta 条目）' : ''}${DRY ? ' · dry' : ''}`);
  const { added, failed } = await addNew(source, kinds, { dry: DRY, refresh });
  for (const a of added) {
    console.log(`   ${a.refreshed ? '⟳' : '+'} [${KIND_LABEL[a.kind]}] ${a.name}${a.kept.length ? `（保留本地：${a.kept.join('、')}）` : ''}`);
  }
  for (const f of failed) console.log(`   ✗ [${KIND_LABEL[f.kind]}] ${f.name}：${f.error}`);
  console.log(added.length ? `\n✅ 新增/更新 ${added.length} 条` : '\n✅ 没有新增内容');
  if (!added.length) return { added, failed };
  if (DRY) console.log('（--dry：未写文件，未重建索引）');
  else postprocess();
  return { added, failed };
}

async function askConfirm(q) {
  if (!canPrompt()) return false;
  const raw = (await ask(`${q} [y/N] `, '')).toLowerCase();
  return raw === 'y' || raw === 'yes';
}

/* ---------------- check：按名称精确复查 ---------------- */
/** 本地没有该条目时：在数据源里按名称找一条，确认后写入 */
async function addByName(source, name, kinds) {
  for (const kind of kinds) {
    const entry = await source.resolve(kind, { name });
    if (!entry) continue;
    const res = await source.fetch(kind, entry, { dry: DRY });
    const data = res?.data ?? res;
    if (!data?.name) continue;
    console.log(`  · 本地没有「${name}」，数据源匹配到 ${KIND_LABEL[kind]}「${data.name}」`);
    if (DRY) return void console.log('  （--dry：未写入）');
    if (!(YES || await askConfirm(`新增写入 content/**/${data.name}.json？`))) return;
    writeLocal(kind, data.name, data);
    if (res?.attach) appendPlaceholder(data.name, res.attach, { dry: DRY });
    console.log(`  ✅ 已新增 [${KIND_LABEL[kind]}] ${data.name}`);
    postprocess();
    return;
  }
  console.log(`  ✗ 数据源里没有找到「${name}」。`);
}

async function doCheck(source, name, kinds) {
  if (!name) {
    console.error('用法：npm run data -- <数据源> check <角色 / 武器 / 圣遗物名称>');
    process.exit(1);
  }
  const hits = findLocal(name).filter((h) => kinds.includes(h.kind));
  if (!hits.length) {
    console.log(`\n▶ ${source.label} 精确复查「${name}」`);
    await addByName(source, name, kinds);
    return;
  }
  const hit = hits[0];
  console.log(`\n▶ ${source.label} 精确复查 [${KIND_LABEL[hit.kind]}] ${hit.name}`);
  console.log(`  本地：${relOf(fileOf(hit.kind, hit.name))}`);
  const r = await check(source, hit.kind, hit.name);
  if (!r.found) {
    console.log(`  ✗ ${r.reason}`);
    return;
  }
  console.log(`  差异：${diffSummary(r.changes)}`);
  console.log(formatDiff(r.changes));
  if (r.kept.length) console.log(`  ⤶ 数据源给不出、覆盖后保留本地值：${r.kept.join('、')}`);
  if (r.changes.some((c) => c.kind === 'length' || c.kind === 'items')) {
    console.log(`  ⤵ 列表/数值差异一律以数据源为准；若这些内容原本来自体验服补全（角色状态说明词条、「异邦的××」天赋、武器逐级数值），`);
    console.log(`     覆盖后可用 \`npm run data -- lunaris fill ${hit.name}\` 重新补回。`);
  }
  if (!r.changes.length) {
    console.log('\n✅ 本地与数据源一致，无需覆盖。');
    return;
  }
  console.log(`\n  数据源说明：${source.note}`);  if (source.beta && r.local && !r.local.beta) {
    console.log('  ⚠️ 本地这条是**已实装**内容，而该数据源含体验服口径：覆盖会写入 `beta` 标记（条目排到图鉴最前），');
    console.log('     并可能用测试服文本替换已实装内容。已实装内容建议改用正式服：npm run data -- genshin-db check ' + hit.name);
  }  if (DRY) return void console.log('（--dry：未写入）');
  if (!(YES || await askConfirm('用数据源覆盖本地？'))) return void console.log('已跳过，未改动本地文件。');
  applyCheck(hit.kind, hit.name, r.merged);
  console.log(`  ✅ 已覆盖 ${relOf(fileOf(hit.kind, hit.name))}`);
  if (r.attach) appendPlaceholder(hit.name, r.attach, { dry: DRY });
  postprocess();
}

/* ---------------- fill：补全本地空字段 ---------------- */
async function doFill(source, { name = '', kinds }) {
  console.log(`\n▶ ${source.label} 补全${name ? `「${name}」` : ''}${DRY ? ' · dry' : ''}`);
  const res = await fill(source, kinds, { name, dry: DRY });
  if (res.unsupported) {
    console.log(`  ⚠️ ${source.label} 不提供补全动作（补全由 lunaris 提供：npm run data -- lunaris fill）`);
    return;
  }
  for (const d of res.done) console.log(`   + [${KIND_LABEL[d.kind]}] ${d.name}：${d.notes.join('、') || '已更新'}`);
  for (const f of res.failed) console.log(`   ✗ [${KIND_LABEL[f.kind]}] ${f.name}：${f.error}`);
  console.log(res.done.length ? `\n✅ 补全 ${res.done.length} 条` : '\n✅ 没有需要补全的字段');
  if (res.done.length && !DRY) postprocess();
}

/* ---------------- 交互式 ---------------- */
async function interactive() {
  printSources();
  const pick = await ask('请选择数据源（序号，0 退出）：', '0');
  const source = sourceList()[Number(pick) - 1];
  if (!source) return void console.log('已取消。');

  console.log(`
▶ 动作（数据源：${source.label}）
  1) 扫描新增 —— 列出「数据源有、本地没有」的条目（只读）
  2) 导入新增 —— 抓取并写入这些条目${source.beta ? '（含重抓本地 beta 条目）' : ''}
  3) 精确复查 —— 输入名称，对比本地与数据源，可覆盖
  4) 补全字段 —— 用数据源填补本地空字段${source.enrich ? '' : '（本数据源不支持）'}
  0) 退出`);
  const action = await ask('请选择动作：', '0');
  const kinds = kindsOf(KINDS);

  if (action === '1') return void await doScan(source, kinds);
  if (action === '2') return void await doAdd(source, kinds);
  if (action === '3') return void await doCheck(source, await ask('名称（角色 / 武器 / 圣遗物，支持部分匹配）：', ''), kinds);
  if (action === '4') return void await doFill(source, { name: await ask('名称（可留空 = 全部）：', ''), kinds });
  console.log('已取消。');
}

/* ---------------- 入口 ---------------- */
if (hasFlag('list')) {
  printSources();
} else if (!positional.length) {
  if (canPrompt()) await interactive();
  else {
    printUsage();
    closePrompt();
    process.exit(1);
  }
} else {
  const source = getSource(positional[0]);
  if (!source) {
    console.error(`未知数据源：${positional[0]}（可用：${SOURCES.map((s) => s.id).join(' / ')}，或序号 1~${SOURCES.length}）`);
    process.exit(1);
  }
  const [, actionArg, nameArg] = positional;
  const action = (actionArg || 'scan').toLowerCase();
  const kinds = kindsOf(source.kinds);
  if (action === 'scan') await doScan(source, kinds);
  else if (action === 'add') await doAdd(source, kinds);
  else if (action === 'check') await doCheck(source, nameArg || '', kinds);
  else if (action === 'fill') await doFill(source, { name: nameArg || '', kinds });
  else {
    console.error(`未知动作：${action}（可用：scan / add / check / fill）`);
    closePrompt();
    process.exit(1);
  }
}
closePrompt();
