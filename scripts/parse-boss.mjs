/**
 * parse-boss.mjs
 *
 * 解析 content/boss/幽境boss.md（每个 `## 版本号` 为一个版本块），
 * 生成 src/data/bosses.json，并把 content/boss/images/ 下的图片同步到 public/images/
 * 供页面直接引用。
 *
 * 维护方式：修改 content/boss/ 下的 md 或图片后，运行 `npm run data` 即可。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MD_PATH = join(ROOT, 'content', 'boss', '幽境boss.md');
const IMG_DIR = join(ROOT, 'content', 'boss', 'images');
const PUB_IMG_DIR = join(ROOT, 'public', 'images');
const OUT_FILE = join(ROOT, 'src', 'data', 'bosses.json');

function parseMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  const versions = [];
  let version = '';
  let bosses = [];
  let current = null;

  for (const line of lines) {
    // 版本标题（兼容 `## 幽境危战 5.7` 与 `## 5.7`）
    const titleMatch = line.match(/^##\s*(?:幽境危战\s*)?([\d.]+)/);
    if (titleMatch) {
      if (version && bosses.length) versions.push({ version, bosses });
      version = titleMatch[1].trim();
      bosses = [];
      current = null;
      continue;
    }

    // 图片行 ![短名](url 或 images/xxx.webp)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      current = {
        shortName: imgMatch[1].trim(),
        imgUrl: imgMatch[2].trim(),
        imgLocal: '',
        imgMissing: false,
        fullName: '',
        hp: '',
        skills: [],
      };
      bosses.push(current);
      continue;
    }

    if (!current) continue;

    // 表格行：Boss 全名 或 血量
    const tableMatch = line.match(/^\|\s*([^|]+?)\s*\|/);
    if (tableMatch && line.trim().startsWith('|')) {
      const cell = tableMatch[1].trim();
      if (!current.fullName && cell !== ':' && !/^N5/i.test(cell)) {
        current.fullName = cell;
        continue;
      }
      if (/^N5/i.test(cell)) {
        current.hp = cell;
        continue;
      }
    }

    // 空行：技能组之间的分隔标记
    if (line.trim() === '') {
      if (current.skills.length > 0 && current.skills[current.skills.length - 1] !== '__SEP__') {
        current.skills.push('__SEP__');
      }
      continue;
    }

    // 技能描述（引用块，含嵌套引用）
    const quoteMatch = line.match(/^\s*>\s*(.*)$/);
    if (quoteMatch) {
      let content = quoteMatch[1].trim();
      if (content !== '') {
        content = content.replace(/^>\s*/, '').trim();
        current.skills.push(content.replace(/^-\s*/, ''));
      }
    }
  }

  if (version && bosses.length) versions.push({ version, bosses });
  return versions;
}

// ---------- 主流程 ----------
if (!existsSync(MD_PATH)) {
  console.error(`❌ 未找到 ${MD_PATH}`);
  process.exit(1);
}
mkdirSync(dirname(OUT_FILE), { recursive: true });
mkdirSync(PUB_IMG_DIR, { recursive: true });

const allVersions = parseMarkdown(readFileSync(MD_PATH, 'utf-8'));

// 同步图片：content/boss/images/ -> public/images/
let copied = 0;
for (const f of readdirSync(IMG_DIR)) {
  const src = join(IMG_DIR, f);
  const dest = join(PUB_IMG_DIR, f);
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
    copied++;
  }
}

// 校验每个 boss 的本地图片是否存在
for (const v of allVersions) {
  for (const b of v.bosses) {
    const fname = basename(b.imgUrl);
    b.imgLocal = fname;
    if (!existsSync(join(IMG_DIR, fname))) {
      b.imgMissing = true;
      console.warn(`  ⚠️ 图片缺失: ${fname}`);
    }
  }
}

allVersions.sort((a, b) => parseFloat(a.version) - parseFloat(b.version));
writeFileSync(OUT_FILE, JSON.stringify(allVersions, null, 2), 'utf-8');

console.log(`✅ Boss 数据已生成: ${OUT_FILE}`);
allVersions.forEach((v) => console.log(`   ${v.version}: ${v.bosses.length} 个 Boss`));
console.log(`✅ 图片同步至 public/images/（新增 ${copied} 张）`);
