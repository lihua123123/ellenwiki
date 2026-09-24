/**
 * sync-gachabase.mjs — 兼容旧命令：等价于 `npm run data -- gachabase add`
 * （旧参数 --force 映射为 --refresh：连本地 beta 条目一起重抓）。
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib/local-store.mjs';

const args = process.argv.slice(2).map((a) => (a === '--force' ? '--refresh' : a));
const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'data.mjs'), 'gachabase', 'add', ...args], {
  stdio: 'inherit',
  cwd: ROOT,
});
process.exit(res.status ?? 1);
