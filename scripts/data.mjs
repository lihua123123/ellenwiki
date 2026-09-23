/**
 * data.mjs — 交互式数据同步入口（`npm run data`）。
 *
 * 运行后列出三个数据源，键入数字回车即开始同步对应来源，随后统一重新解析/生成：
 *   1) genshin-db  正式服，数据随 npm 包发布；角色 / 武器 / 圣遗物**全量重刷**（会覆盖手工改的文案）
 *   2) gachabase   最新（含测试服未实装）；角色 / 武器 / 圣遗物**只补本地缺口**
 *   3) lunaris     第三方图鉴（CHS）；武器 / 圣遗物只补最新新增、旅行者固有天赋
 *
 * 公共尾部（所有来源都跑）：解析 Boss / 附着产球 → 重建武器与圣遗物索引 →
 * 补角色实装版本 → 补角色「加强」文本 → 补旅行者固有天赋。
 *
 * 非交互用法（CI / 脚本）：`npm run data -- 2`、或 `DATA_SOURCE=3 npm run data`、
 * 环境变量 `DATA_SOURCE`；非 TTY 且没给编号时默认按 2) gachabase 执行（保持旧行为）。
 *
 * 用法：npm run data          （交互）
 *       npm run data -- 2     （直接选 2）
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 每个数据源要跑的步骤 */
const SOURCES = {
  1: {
    name: 'genshin-db',
    note: '正式服 · 角色 / 武器 / 圣遗物全量重刷（会覆盖手工补写的文案）',
    steps: [
      ['generate-profiles.mjs'],
      ['generate-weapons.mjs', '--force'],
      ['generate-artifacts.mjs', '--force'],
    ],
  },
  2: {
    name: 'gachabase',
    note: '最新（含测试服未实装）· 只补本地没有的条目',
    steps: [['sync-gachabase.mjs']],
  },
  3: {
    name: 'lunaris',
    note: '第三方图鉴（CHS）· 武器 / 圣遗物只补最新新增 + 旅行者固有天赋',
    steps: [['sync-lunaris.mjs']],
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
  console.log('\n请选择要同步的数据源（键入数字后回车）：');
  for (const [k, v] of Object.entries(SOURCES)) console.log(`  ${k}) ${v.name.padEnd(12)}— ${v.note}`);
  console.log('  （0 或 q 退出）');
};

const pick = async () => {
  const fromArg = process.argv.slice(2).find((a) => /^([0-3]|q)$/i.test(a));
  if (fromArg) return fromArg.toLowerCase();
  if (process.env.DATA_SOURCE && SOURCES[process.env.DATA_SOURCE]) return process.env.DATA_SOURCE;
  if (!process.stdin.isTTY) {
    console.log('（非交互环境，默认按 2) gachabase 执行；可用 `npm run data -- 1|2|3` 或 DATA_SOURCE=1|2|3 指定）');
    return '2';
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question('请输入 1 / 2 / 3：', resolve));
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
  console.error(`无效选项：${choice}（可选 1 / 2 / 3）`);
  process.exit(1);
}

console.log(`\n▶ 数据源：${choice}) ${source.name} — ${source.note}`);
for (const step of source.steps) run(step);
for (const step of TAIL) run(step);
console.log(`\n✅ 数据同步完成（数据源：${source.name}）。`);
