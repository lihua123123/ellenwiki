# 艾莲的数据库

以「角色」为核心的原神 Wiki 式单页应用，整合角色图鉴、伤害计算公式与幽境 Boss 图鉴三大模块，统一深色卡片化 UI。纯静态站点，无后端。

## 模块与路由

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 角色图鉴 | `#/characters` | 127 名角色头像墙（7 列，5 星金光 / 4 星紫光），元素、武器图标多选筛选（不选为全部），支持名称搜索 |
| 角色详情 | `#/characters/:name` | 战斗天赋（描述 + 等级步进器，支持滚轮）+ 突破/固有天赋 + 命之座标签页；附着与产球表自动归入对应技能位置 |
| 数据工具 | `#/characters/tools` | 圣遗物词条分布、普攻产球概率、角色充能计算器 |
| 伤害公式 | `#/formulas/genshin` `#/formulas/sr` `#/formulas/zzz` | 三游戏伤害公式，KaTeX 渲染 |
| 幽境 Boss | `#/boss` | 版本珠链切换，卡片翻面查看机制 / 介绍 / 背景 |

仅有深色主题。窄屏（≤900px）下侧边导航自动转为顶部横条。

## 角色详情页说明

- 资料来源为 `content/characters/<角色名>.json`（仿 Snap.Hutao 的 Avatar/SkillDepot 模型：skills / passives / constellations）。
- 等级数值按 `label + values 数组`存储，页面用步进器（− / ＋ / 鼠标滚轮）切换 1~max 级。
- 描述文本约定：`\n\n` 分段；「标题+正文」段转为悬停术语（下划线 + 自定义气泡）；结尾无机制词的段落自动识别为**角色逸闻**，以附录色斜体显示。
- 尚无资料的角色（如沃雅妮莎、薇斯纳）显示「等待补充」占位框架，已有的附着/产球表仍按技能归位；数据源更新后运行 `import-snap.mjs` 即可补齐。

## 目录结构

```
content/                ← 唯一数据源（只改这里，然后重新生成）
  formulas/             伤害公式 md（genshin / sr / zzz）
  boss/                 幽境boss.md + images/（Boss 图片，webp）
  attachment/           元素附着及产球.md（角色附着/产球总表）
  characters/           每角色一份本地资料 JSON + images/（角色头像，<角色名>.png）
  meta/                 colors.json（元素配色）+ characters-meta.json（角色武器/能量）
scripts/
  parse-boss.mjs        content/boss → src/data/bosses.json + public/images/
  parse-attachment.mjs  content/attachment → src/data/characters.js（附着/产球数据）
  generate-profiles.mjs genshin-db → content/characters/<名>.json（角色资料生成）
  import-snap.mjs       Snap.Metadata（github）→ content/characters/<名>.json（新角色补齐）
  fetch-avatars2.mjs    genshin-db + enka CDN → content/characters/images/（缺失头像补齐）
src/
  main.js               模块注册表 + hash 路由 + 侧边导航
  core/                 统一渲染器（markdown.js / richtext.js / colors.js / tooltip.js）
  pages/                characters.js（图鉴+详情+工具）/ formulas.js / boss.js
  data/                 生成产物（characters.js / bosses.json），勿手改
  styles/               base.css（设计系统）+ characters.css / markdown.css / boss.css / formulas.css
```

## 常用命令

```bash
npm run dev     # 解析数据 + 启动开发服务器
npm run build   # 解析数据 + 构建到 dist/
npm run data    # 只重新解析数据（改了 content/ 下的 md 后执行）
npm run deploy  # 构建 + 部署到 Cloudflare Workers（wrangler deploy）
```

## 部署

站点为纯静态产物，通过 Cloudflare Workers 静态资源（`assets`）托管，配置见 `wrangler.jsonc`：

- `assets.directory: ./dist` —— 直接读取 Vite 构建产物
- `assets.not_found_handling: single-page-application` —— 未知路径回落到 `index.html`，配合 hash 路由

Cloudflare 构建环境（Workers Builds）会自动执行 `npm clean-install` → `npm run build` → `npx wrangler deploy`。
本地手动部署需先 `npx wrangler login` 授权。

## 维护方式

- **改附着/产球数据**：只改 `content/attachment/元素附着及产球.md`，然后 `npm run data`（dev/build 自动执行）。时间/次数格式统一写作 `N hits / X s`（如 `3 hits / 2.5 s`）。
- **加角色资料**：放入 `content/characters/<角色名>.json`（结构参照现有文件），头像放 `content/characters/images/<角色名>.png`；或用 `import-snap.mjs` / `generate-profiles.mjs` 从数据源生成。
- **加 Boss 图片**：放入 `content/boss/images/`，文件名与 md 中 `images/xxx.webp` 一致。
- **配色**：统一改 `content/meta/colors.json`。
- **新角色数据缺失时**：genshin-db 收录后用 `generate-profiles.mjs`；仅 Snap.Metadata 收录时在 `import-snap.mjs` 的 `TARGETS` 中登记 `{ name, id, snap }` 后运行。

## 外部数据源

- [genshin-db](https://github.com/theBowja/genshin-db) — 角色资料与头像文件名
- [Snap.Metadata](https://github.com/SnapHutaoRemasteringProject/Snap.Metadata) — 新角色中文元数据（比 genshin-db 更新）
- [enka.network](https://enka.network) — 角色头像 CDN
