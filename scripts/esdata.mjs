/**
 * esdata.mjs — 兼容旧命令：体验服口径（等价于 `npm run data -- --beta`）。
 * 只面向未实装 / 测试服内容：只列含体验服数据的数据源，且导入时默认重抓本地 beta 条目
 * （测试服数值会随 revision 调整）。
 */
process.argv = [...process.argv.slice(0, 2), ...process.argv.slice(2), '--beta'];
await import('./data.mjs');
