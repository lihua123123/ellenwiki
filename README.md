# 艾莲的数据库

以「角色」为核心的原神 Wiki 式单页应用，整合角色图鉴、武器图鉴、圣遗物图鉴、伤害计算公式与幽境 Boss 图鉴五大模块，统一深色卡片化 UI。纯静态站点，无后端。

## 模块与路由

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 角色图鉴 | `#/characters` | 127 名角色头像墙（7 列，5 星金光 / 4 星紫光），**按实装版本倒序**，元素、武器图标多选筛选（不选为全部），支持名称搜索 |
| 角色详情 | `#/characters/:name` | 战斗天赋（描述 + 等级步进器，支持滚轮）+ 突破/固有天赋 + 命之座标签页；附着与产球表自动归入对应技能位置 |
| 数据工具 | `#/characters/tools` | 圣遗物词条分布、普攻产球概率、**4 人角色充能计算器**（队伍人数可减到 1，后台吸收效率按 4/3/2 人取 60%/70%/80%） |
| 武器图鉴 | `#/weapons` | 253 把武器图标墙（与角色图鉴同构），**按实装版本倒序**，武器类型 / 稀有度多选筛选 + 名称搜索 |
| 武器详情 | `#/weapons/:name` | 等级滑块 + 突破勾选的属性模拟、武器技能精炼 R1~R5 切换、突破材料、武器故事 |
| 圣遗物图鉴 | `#/artifacts` | 63 套圣遗物长卡片（每行两个，左图标 + 右套装效果），**按实装版本倒序**，稀有度筛选 + 名称搜索 |
| 圣遗物详情 | `#/artifacts/:name` | 1/2/4 件套效果 + 五个部位的介绍与故事（可折叠，部位资料每行两个） |
| 伤害公式 | `#/formulas/genshin` `#/formulas/sr` `#/formulas/zzz` | 三游戏伤害公式，KaTeX 渲染 |
| 幽境 Boss | `#/boss` | 版本珠链切换，卡片翻面查看机制 / 介绍 / 背景 |

仅有深色主题。窄屏（≤900px）下侧边导航自动转为顶部横条。

## 角色详情页说明

- 资料来源为 `content/characters/<角色名>.json`（仿 Snap.Hutao 的 Avatar/SkillDepot 模型：skills / passives / constellations）。
- 等级数值按 `label + values 数组`存储，页面用步进器（− / ＋ / 鼠标滚轮）切换 1~max 级。
- 描述文本约定：`\n\n` 分段；「标题+正文」段转为悬停术语（下划线 + 自定义气泡）；结尾无机制词的段落自动识别为**角色逸闻**，以附录色斜体显示。
- 尚无资料的角色显示「等待补充」占位框架，已有的附着/产球表仍按技能归位；数据源更新后运行 `import-snap.mjs` 或 `npm run data:sync` 即可补齐。

## 角色充能计算器

工具页的充能计算器支持 **4 名角色**（队伍人数 = 显示的行数，可用 −/＋ 减到 1 人，最少 1 人），每行独立计算所需的元素充能效率。

- 分母 = 前台（同色 ×3 + 无色 ×2 + 异色 ×1）+ 后台系数 ×（同色 ×3 + 无色 ×2 + 异色 ×1），结果 = 元素爆发能量 / 分母。
- 系数来自公式页「元素充能计算」的吸收效率表：**前台** 同色 300% / 无色 200% / 异色 100%；**后台**（4 人配队）60% / 120% / 180%，（3 人配队）70% / 140% / 210%，（2 人配队）80% / 160% / 240%。因此后台系数随队伍人数变化：4 人 60%、3 人 70%、2 人 80%（单人无后台队友，沿用 60%）。
- 输入角色名会自动填入元素爆发能量（数据来自 `src/data/characters.js`）。
- 由圣遗物 / 武器 / 天赋 / 命座产生的**固定回能**不受元素充能效率与吸收效率影响，不计入本表。

> 本表按**元素微粒**（基础回能值 1）折算；若面对的是怪物掉落的元素晶球（基础回能值 3），把球的个数除以 3 再填入即可。

## 武器 / 圣遗物详情页说明

- 资料来源为 `content/weapons/<名称>.json`（253 把）与 `content/artifacts/<名称>.json`（63 套），由 genshin-db 生成、新内容由 `sync-gachabase.mjs` 补齐，可手动微调文案。
- **武器列表与角色图鉴同构**：图标墙（7 列，窄屏递减），卡片无底板、星级渐变描边，主题色只由星级决定（5★ 金 / 4★ 紫 / 3★ 蓝 / 2★ 绿 / 1★ 灰）。悬停只有上浮 + 星级光晕，**不显示额外属性**。
- **圣遗物列表为长卡片**：每行两个，左侧星级描边图标、右侧名称 + 星级 + 2/4 件套效果全文（数值同样高亮）。件套标签与正文用 flex 排版，正文换行后自动与标签右侧对齐。两个列表都不使用悬停遮罩，卡片也不用左侧彩色描边。
- 圣遗物详情的「部位资料」**不再用颜色区分部位**：生之花 / 死之羽 / 时之沙 / 空之杯 / 理之冠 的标签统一为 `--text-secondary`，图标底框统一为中性描边（原按部位上色的 `SLOT_COLOR` 已移除）。
- **武器等级模拟**：滑块 1~max，配合「已突破」勾选。勾选仅在突破节点（20 / 40 / 50 / 60 / 70 / 80）可用 —— 同一等级下未突破与已突破的基础攻击力不同（如苍耀 20 级：133.3 / 164.4）。非节点等级会自动锁定为「已突破」。
- 数据侧由 `curve` 字段支撑：`attack[lv-1]` / `specialized[lv-1]`（已突破值）与 `preAttack[cap]` / `preSpecialized[cap]`（未突破值）。1~2★ 武器上限为 70 级。
- 武器详情顺序：基本信息 → 武器技能（精炼）→ 突破材料 → 武器故事；圣遗物套装效果按数据实际存在的 1/2/4 件套渲染。
- 武器精炼效果与圣遗物套装效果中的百分比 / 带单位数值用 `highlightNumbers()`（`src/core/richtext.js`）包成 `.rt-num`，以主题蓝高亮。
- **获取方式标签**：数据写在 `content/meta/weapons-meta.json`（可编辑），由生成脚本合并进 `source` 字段；未列出的按星级回退（5★→限定抽取、3★→常驻抽取、2★/1★→开地图），4★ 默认留空不显示（因为锻造 / 活动 / 纪行 / 商店 混杂，需逐把确认，详见该文件的 `_todo`）。
- **不使用左侧彩色强调描边**：卡片与内容块统一为等宽 `1px var(--border-color)` 边框。已移除的包括 `.artifact-card` / `.artifact-hero` / `.set-effect` / `.piece-card` / `.weapon-hero` / `.char-hero` / `.katex-wrap`（公式框）与 Boss 页的 `.block-title` / `.block-text`。仍保留的是「非卡片」的竖向色条：章节标题 `.talent-section > h2`、引用块 `blockquote`、公式页目录的选中指示。

## 目录结构

```
content/                ← 唯一数据源（只改这里，然后重新生成）
  formulas/             伤害公式 md（genshin / sr / zzz）
  boss/                 幽境boss.md + images/（Boss 图片，webp）
  attachment/           元素附着及产球.md（角色附着/产球总表）
  characters/           每角色一份本地资料 JSON + images/（角色头像，<角色名>.png）
  weapons/              每把武器一份 JSON + images/（可选本地图标，<官方图标名>.png）
  artifacts/            每套圣遗物一份 JSON + images/（可选本地图标）
  meta/                 colors.json（元素配色）+ characters-meta.json（角色武器/能量）+ weapons-meta.json（武器获取方式）
scripts/
  parse-boss.mjs        content/boss → src/data/bosses.json + public/images/
  parse-attachment.mjs  content/attachment → src/data/characters.js（附着/产球数据）
  generate-profiles.mjs genshin-db → content/characters/<名>.json（角色资料生成）
  import-snap.mjs       Snap.Metadata（github）→ content/characters/<名>.json（新角色补齐）
  fetch-avatars2.mjs    genshin-db + enka CDN → content/characters/images/（缺失头像补齐）
  generate-weapons.mjs  genshin-db → content/weapons/*.json + src/data/weapons-index.json
  generate-artifacts.mjs genshin-db → content/artifacts/*.json + src/data/artifacts-index.json
  sync-character-versions.mjs  genshin-db → 给 content/characters/*.json 补 version（实装版本）字段
  sync-gachabase.mjs    gachabase → 抓取最新（含测试服未实装）角色 / 武器 / 圣遗物，只补本地没有的条目
src/
  main.js               模块注册表 + hash 路由 + 侧边导航
  core/                 统一渲染器（markdown.js / richtext.js / colors.js / tooltip.js）
  pages/                characters.js / weapons.js / artifacts.js / formulas.js / boss.js
  data/                 生成产物（characters.js / bosses.json / *-index.json），勿手改
  styles/               base.css（设计系统）+ characters.css / weapons.css / artifacts.css / markdown.css / boss.css / formulas.css
```

## 常用命令

```bash
npm run dev     # 解析数据 + 启动开发服务器（不联网）
npm run build   # 解析数据 + 构建到 dist/（不联网）
npm run data    # 拉取最新数据（含测试服）+ 重新解析全部数据
npm run deploy  # 构建 + 部署到 Cloudflare Workers（wrangler deploy）
```

> `dev` / `build` / `deploy` 都不联网，保证断网或数据源抽风时仍能起服务、构建；只有 `npm run data` 会去 gachabase 抓最新内容。

武器 / 圣遗物的补充命令（均会重新汇总 `src/data/*-index.json`）：

```bash
npm run data:equip:force   # 从 genshin-db 全量重刷武器与圣遗物 JSON
npm run data:equip:icons   # 额外把图标下载到 content/*/images/（离线可用）
npm run data:sync          # 只从 gachabase 同步最新（含测试服）内容，不打索引
node scripts/sync-character-versions.mjs   # 只补/更新角色实装版本（已含在 npm run data 中）
```

新增命令说明：

- `npm run data:sync` —— 从 [gachabase](https://gi.gachabase.net) 拓最新图鉴数据，**只补本地没有的条目**（已实装内容仍以 genshin-db 生成的高精度数据为准），新条目带 `"beta": true`。
- `node scripts/sync-gachabase.mjs --dry` 只看抓取结果不写文件；`--force` 连之前同步过的测试服条目一起重抓（测试服数值会被后续 revision 调整）。
- 新条目的 `version` 取 gachabase 当前 beta 修订号的下一版（如 `7.0.54` → `7.1`），因此会排在三个图鉴的最前面；需要手写时用 `$env:BETA_VERSION='7.2'; npm run data:sync` 覆盖。

### 排序（实装顺序）

三个图鉴都按 **实装版本倒序** 排列（越新越靠前，不区分星级），同版本再按星级、名称：

- 武器 / 圣遗物：版本写在 `content/*/*.json` 的 `version`（genshin-db 提供，247/247、63/63 全覆盖），由生成脚本写进索引并排序。
- 角色：`content/characters/*.json` 的 `version` 由 `sync-character-versions.mjs` 补全（125 个来自 genshin-db）。
  测试服条目（`"beta": true`）的 `version` 由 `sync-gachabase.mjs` 写入（当前为下一版，如 `7.1`，因此排在最前）。
  脚本只在版本变化时写文件，不会动其他字段，因此手工补的文案不会被覆盖。

## 部署

站点为纯静态产物，通过 Cloudflare Workers 静态资源（`assets`）托管，配置见 `wrangler.jsonc`：

- `assets.directory: ./dist` —— 直接读取 Vite 构建产物
- `assets.not_found_handling: single-page-application` —— 未知路径回落到 `index.html`，配合 hash 路由

Cloudflare 构建环境（Workers Builds）会自动执行 `npm clean-install` → `npm run build` → `npx wrangler deploy`。
本地手动部署需先 `npx wrangler login` 授权。

## 维护方式

- **改附着/产球数据**：只改 `content/attachment/元素附着及产球.md`，然后 `npm run data`（dev/build 自动执行）。时间/次数格式统一写作 `N hits / X s`（如 `3 hits / 2.5 s`）。
- **加角色资料**：放入 `content/characters/<角色名>.json`（结构参照现有文件），头像放 `content/characters/images/<角色名>.png`；或用 `import-snap.mjs` / `generate-profiles.mjs` 从数据源生成。
- **加武器 / 圣遗物资料**：改 `content/weapons/<名称>.json` 或 `content/artifacts/<名称>.json` 后跑 `npm run data`；也可直接编辑单份 JSON 微调文案。
  - 数据来自 genshin-db：`node scripts/generate-weapons.mjs` / `node scripts/generate-artifacts.mjs`（增量，已存在的条目跳过；`--force` 全量重刷；`--icons` 顺带下图标）。
  - 列表页只读 `src/data/weapons-index.json` / `artifacts-index.json`（体积小，随主包加载）；详情页按需懒加载对应的 `content/*/<名称>.json`，因此新增条目**不需要**改动页面代码。
  - 图标默认引用官方 CDN（enka.network），未下载时站点体积不变；若要完全离线，跑 `npm run data:equip:icons`，页面会自动优先使用本地图标。
  - **改武器获取方式**：只改 `content/meta/weapons-meta.json` 的 `sources`，然后跑 `node scripts/generate-weapons.mjs --force`（脚本会打印还有多少把未标注）。
- **加 Boss 图片**：放入 `content/boss/images/`，文件名与 md 中 `images/xxx.webp` 一致。
- **配色**：统一改 `content/meta/colors.json`。
- **新角色数据缺失时**：先跑 `npm run data:sync`（从 gachabase 抓最新角色/武器/圣遗物）；genshin-db 收录后用 `generate-profiles.mjs`；仅 Snap.Metadata 收录时在 `import-snap.mjs` 的 `TARGETS` 中登记 `{ name, id, snap }` 后运行。
- **同步测试服新内容**：跑 `npm run data`（已包含 `sync-gachabase.mjs`），或单独 `npm run data:sync`。测试服武器暂无 lv1 数值与逐级曲线（页面属性位显示 `—`），实装后跑 `npm run data:equip:force` 即可被 genshin-db 数据覆盖补全。

## 外部数据源

- [genshin-db](https://github.com/theBowja/genshin-db) — 角色资料与头像文件名、武器与圣遗物资料
- [gachabase](https://gi.gachabase.net) — 最新（含测试服未实装）的角色 / 武器 / 圣遗物，由 `sync-gachabase.mjs` 拓取（只补本地缺口）
- [Snap.Metadata](https://github.com/SnapHutaoRemasteringProject/Snap.Metadata) — 新角色中文元数据（比 genshin-db 更新）
- [enka.network](https://enka.network) — 角色头像、武器与圣遗物图标 CDN
