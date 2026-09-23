/**
 * esdata.mjs — 交互式「体验服」数据同步入口（`npm run esdata`）。
 *
 * 与 `npm run data` 的区别：只面向**未实装 / 测试服**内容，并会重抓之前同步过的 beta 条目
 * （测试服数值会随 revision 调整），列出可提供测试服数据的数据源，键入数字回车即开始：
 *   1) gachabase  beta 修订（`sync-gachabase.mjs --force`）：新角色 / 武器 / 圣遗物 + 附着表占位
 *   2) lunaris    最新数据版本（`sync-lunaris.mjs --force`）：最新新增的武器 / 圣遗物 + 旅行者天赋
 *
 * 同步后同样跑公共尾部（解析 → 重建索引 → 补版本 / 加强文本 / 旅行者天赋）。
 *
 * 非交互用法：`npm run esdata -- 1`、或 `DATA_SOURCE=2 npm run esdata`；
 * 非 TTY 且没给编号时默认按 1) gachabase 执行。
 *
 * 用法：npm run esdata        （交互）
 *       npm run esdata -- 2   （直接选 2）
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 提供测试服 / 未实装内容的数据源（genshin-db 只有正式服，不在此列） */
const SOURCES = {
  1: {
    name: 'gachabase',
    note: 'beta 修订 · 重抓未实装角色 / 武器 / 圣遗物（只补本地缺口，beta 数值随 revision 变）',
    steps: [['sync-gachabase.mjs', '--force']],
  },
  2: {
    name: 'lunaris',
    note: '最新数据版本 · 重抓最新新增的武器 / 圣遗物 + 旅行者固有天赋',
    steps: [['sync-lunaris.mjs', '--force']],
  },
};

/** 公共尾部：与数据源无关的解析 / 生成 / 补全步骤 */
const TAIL = [
  ['parse-boss.mjs'],
  ['parse-attachment.mjs'],
  ['generate-weapons.mjs'],
  ['generate-artifacts.mjs'],
  ['sync-character-versions.mjs'],
  ['sync-buffs.mjs'],
  ['sync-lunaris.mjs'],
];

const run = (args) => {
  const [script, ...rest] = args;
  console.log(`\n$ node scripts/${script}${rest.length ? ' ' + rest.join(' ') : ''}`);
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...rest], { stdio: 'inherit', cwd: ROOT });
  if (res.status !== 0) {
    console.error(`✗ scripts/${script} 退出码 ${res.status}，已中断。`);
    process.exit(res.status ?? 1);
  }
};

const printMenu = () => {
  console.log('\n体验服 / 未实装内容 · 请选择数据源（键入数字后回车）：');
  for (const [k, v] of Object.entries(SOURCES)) console.log(`  ${k}) ${v.name.padEnd(12)}— ${v.note}`);
  console.log('  （0 或 q 退出）');
};

const pick = async () => {
  const fromArg = process.argv.slice(2).find((a) => /^([0-2]|q)$/i.test(a));
  if (fromArg) return fromArg.toLowerCase();
  if (process.env.DATA_SOURCE && SOURCES[process.env.DATA_SOURCE]) return process.env.DATA_SOURCE;
  if (!process.stdin.isTTY) {
    console.log('（非交互环境，默认按 1) gachabase 执行；可用 `npm run esdata -- 1|2` 或 DATA_SOURCE=1|2 指定）');
    return '1';
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('请输入 1 / 2：', resolve));
  rl.close();
  return String(answer).trim();
};

printMenu();
const choice = await pick();
if (choice === '0' || choice === 'q') {
  console.log('已取消。');
  process.exit(0);
}
const source = SOURCES[choice];
if (!source) {
  console.error(`无效选项：${choice}（可选 1 / 2）`);
  process.exit(1);
}

console.log(`\n▶ 体验服数据源：${choice}) ${source.name} — ${source.note}`);
for (const step of source.steps) run(step);
for (const step of TAIL) run(step);
console.log(`\n✅ 体验服数据同步完成（数据源：${source.name}）。`);
