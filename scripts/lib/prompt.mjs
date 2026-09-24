/**
 * prompt.mjs — 交互式命令行问答（`npm run data` 的菜单用）。
 *
 * 注意：非 TTY（CI / 工具终端）下这些函数会返回默认值而不是挂起等待输入 ——
 * 数据源脚本必须支持「参数直通」，让非交互环境也用同一条代码路径。
 */
import { createInterface } from 'node:readline';

let rl = null;
const iface = () => {
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl;
};

export const canPrompt = () => !!process.stdin.isTTY;

export function closePrompt() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/** 单向提问：非 TTY 时直接返回 fallback */
export async function ask(question, fallback = '') {
  if (!canPrompt()) return fallback;
  return String(await new Promise((resolve) => iface().question(question, resolve))).trim();
}

/** 序号菜单：返回选中的键（非 TTY 返回 fallback） */
export async function choose(question, options, fallback = '') {
  if (!canPrompt()) return fallback;
  const raw = await ask(question, fallback);
  if (!raw) return fallback;
  const hit = options.find((o) => o.key === raw);
  return hit ? hit.key : raw;
}

/** 是 / 否（默认否；非 TTY 返回 fallback） */
export async function confirm(question, fallback = false) {
  if (!canPrompt()) return fallback;
  const raw = (await ask(`${question} [y/N] `, '')).toLowerCase();
  return raw === 'y' || raw === 'yes';
}
