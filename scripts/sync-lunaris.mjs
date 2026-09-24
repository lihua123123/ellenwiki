/**
 * sync-lunaris.mjs — 兼容旧命令：等价于 `npm run data -- lunaris add` + `npm run data -- lunaris fill`
 *   add  = 补本地还没有的新武器 / 圣遗物（角色由 fill 处理）
 *   fill = 补全本地空字段：角色基础属性 / 缺失固有天赋 / 状态说明词条 / 逸闻，武器逐级数值
 *
 * 旧参数映射：--force → --refresh、--kind=char|weapon|artifact 原样透传、
 * --ver=X.Y.Z → 环境变量 LUNARIS_VERSION（也可直接 `$env:LUNARIS_VERSION='7.1.0'`）。
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib/local-store.mjs';

const args = [];
for (const a of process.argv.slice(2)) {
  if (a === '--force') args.push('--refresh');
  else if (a.startsWith('--ver=')) process.env.LUNARIS_VERSION = a.slice(6);
  else args.push(a);
}

const run = (action) => {
  const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'data.mjs'), 'lunaris', action, ...args], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

/* 网络 / 接口变动不阻断整体流程：失败时只告警 */
try {
  run('add');
  run('fill');
} catch (err) {
  console.log(`⚠️ lunaris 同步失败（不影响本地已有数据）：${err.message}`);
}
