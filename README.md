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

## 页面与数据约定

- 数据源：`content/characters|weapons|artifacts/<名称>.json`（genshin-db 生成，新内容由 gachabase / lunaris 补齐），改完跑 `npm run data`。角色等级数值按 `label + values 数组`存，页面用步进器（− / ＋ / 滚轮）切换。
- 描述文本：`\n\n` 分段；「标题+正文」段转悬停术语（虚线下划线 + 气泡）；结尾无机制词的段落判为**角色逸闻**（附录色斜体，纯展示、不做悬停）。
- **天赋等级表**：行标签只写名称（如 `基础持续时间`），单位跟着值走（`15.0秒`）—— 不再把单位塞进标签（genshin-db 的 `标签|值模板` 里模板自带单位，取「|」前部分做标签即可）。
- **状态说明（悬停词条）**：存在条目的 `states`（`{ name, text }`）里，正文里出现该名字即自动包成虚线下划线 + 气泡；由 `generate-profiles.mjs` 从正文的「标题+正文」段解析，再由 `sync-lunaris.mjs` 按 lunaris 正文里的 `{LINK#N<id>}` 标记补词条（**只看 LINK 标记**，同名但未被链接的词不挂说明，如元素爆发里的「领唱」是领唱者而非叠层）。
- **加强文本（金色 `.rt-buff`）**：gachabase 有 `buffed_description`（genshin-db 没有），`sync-buffs.mjs` 与基础描述做逐词 diff 后，**只把新增片段**包进 `buffs.description` 的 `<buff>…</buff>`（重叠文段保持正文色）。当前 14 名角色：七七 / 可莉 / 温迪 / 阿贝多 / 莫娜 / 砂糖 / 雷泽 / 菲谢尔 / 八重神子 / 北斗 / 迪奥娜 / 赛诺 / 莱欧斯利 / 梦见月瑞希。
- **技能引用（淡紫 `.rt-skill`）**：天赋里提到技能时（`元素战技柔板·幻灵夜舞`、`突破天赋「落羽的裁择」`、`普通攻击·如水`）标出，与金色区分；武器 / 圣遗物不标。
- **数值高亮（主题蓝 `.rt-num`）**：武器精炼、圣遗物套装、技能文本里的百分比 / 带单位数值。武器与圣遗物正文里的 `魔导·秘仪` / `月兆·满辉` / `辉映·星烁` 属于正文本身，**不上色**。
- **武器等级模拟**：滑块 1~max + 「已突破」勾选（仅 20 / 40 / 50 / 60 / 70 / 80 可切），数据来自 `curve.attack[lv-1]`（已突破）/ `curve.preAttack[cap]`（未突破）；1~2★ 上限 70 级。武器详情顺序：基本信息 → 武器技能（精炼）→ 突破材料 → 武器故事。
- **角色属性**：生命值 / 攻击力 / 防御力 / 突破属性四格 + 同一套等级滑块（1~90，突破节点同上），数据存 `stats`（`hp/attack/defense/specialized` 逐级 + `preHp/preAttack/preDefense/preSpecialized` 突破节点未突破值）；`specialized` 只存突破带来的增量（`percent` 标明是否百分比），界面显示「暴击伤害 38.4%」而不是含基础值的 88.4%。突破节点在轨道上按比例分布，点节点可直接跳级。
- **排序**：三个图鉴都按实装版本（`version`）倒序，同版本再按星级 / 名称；测试服条目带 `"beta": true` 排最前。
- **充能计算器**（`#/characters/tools`）：4 行独立计算，分母 = 前台(同色 ×3 + 无色 ×2 + 异色 ×1) + 后台系数 ×(同色 ×3 + 无色 ×2 + 异色 ×1)，结果 = 爆发能量 ÷ 分母；后台系数按队伍人数取 4 人 60% / 3 人 70% / 2 人 80%。按**元素微粒**折算，晶球（基础值 3）请把个数除以 3 再填。
- **UI 约束**：卡片不加悬停遮罩、不加左侧彩色描边；圣遗物部位不用颜色区分；主题色只由星级决定。

## 目录结构

```
content/          唯一数据源：formulas / boss / attachment / characters / weapons / artifacts / meta
scripts/          数据脚本 + lib/（描述解析 profile-text.mjs、角色属性 char-stats.mjs、lunaris 接口 lunaris.mjs、压行 compact-json.mjs）
  data.mjs / esdata.mjs              交互式同步入口（npm run data / esdata）
  parse-boss / parse-attachment      md → src/data
  generate-profiles / -weapons / -artifacts   genshin-db → content/（角色 / 武器 / 圣遗物）
  sync-gachabase / sync-buffs / sync-lunaris / sync-character-versions   外部数据源补齐
  import-snap / fetch-avatars2       Snap.Metadata 补角色 / enka CDN 补头像
src/              main.js（路由 + 侧边导航）· core/（渲染器 + level-sim.js 等级滑块组件）· pages/ · data/（生成产物，勿手改）· styles/
```

## 常用命令

```bash
npm run dev     # 解析数据 + 启动开发服务器（不联网）
npm run build   # 解析数据 + 构建到 dist/（不联网）
npm run data    # 交互式：键入数字选数据源（1 genshin-db / 2 gachabase / 3 lunaris）后同步 + 重新解析
npm run esdata  # 交互式：体验服（未实装）内容，1 gachabase / 2 lunaris，会重抓 beta 条目
npm run deploy  # 构建 + 部署到 Cloudflare Workers（wrangler deploy）
```

选中数据源后统一跑公共尾部（解析 Boss / 附着产球 → 重建武器与圣遗物索引 → 补实装版本 → 补「加强」文本 → lunaris 补旅行者天赋与新内容 + 武器数值 + 状态说明词条）：

| 选项 | 数据源 | 行为 |
| --- | --- | --- |
| 1 | genshin-db | 正式服（npm 包）：角色 / 武器 / 圣遗物**全量重刷**，会覆盖手工文案 |
| 2 | gachabase | 最新（含测试服）：**只补本地缺口** |
| 3 | lunaris | 第三方（CHS）：最新新增的武器 / 圣遗物 + 旅行者天赋 + 武器逐级数值 + 角色状态说明词条 |

> gachabase 的测试服武器只有技能文本（`baseAtk: null`、无逐级曲线），公共尾部里的 lunaris 会按 `beta` 且缺数值自动重抓补全（保留突破材料表与武器故事）。

`npm run esdata` 面向体验服：1) gachabase（`--force` 重抓 beta 修订）；2) lunaris（抓最新数据版本）。

非交互：`npm run data -- 2`、`npm run esdata -- 1`、`DATA_SOURCE=2`（非 TTY 默认 data→2、esdata→1）；旧的非交互全量管道 = `npm run data:all`。

常用单项命令（都只做一件事，可反复跑）：

| 命令 | 作用 |
| --- | --- |
| `npm run data:sync` | gachabase 只补缺口（`--dry` 只看、`--force` 重抓测试服条目） |
| `npm run data:buffs` | 从 gachabase 重算角色「加强」文本（`--dry` 输出对照明细） |
| `npm run data:lunaris` | lunaris 补旅行者天赋 / 最新新增武器圣遗物 / 补全缺数值武器 / 补角色状态说明（`--kind=char\|weapon\|artifact`、`--ver=`、`--force`、`--dry`） |
| `npm run data:profiles` / `data:equip:force` | genshin-db 全量重刷角色 / 武器与圣遗物（⚠️ 覆盖手工文案） |
| `npm run data:equip:icons` | 顺带把武器 / 圣遗物图标下到 `content/*/images/`（离线可用） |
| `node scripts/sync-character-versions.mjs` | 只补 / 更新角色实装版本 |

## 数据源

- [genshin-db](https://github.com/theBowja/genshin-db)（npm 包）— 角色 / 武器 / 圣遗物高精度数据（**仅正式服**，含逐级曲线与等级数值表，角色基础属性来自 `info.stats(level, ascension)`）。
- [gachabase](https://gi.gachabase.net) — 最新（含测试服未实装）角色 / 武器 / 圣遗物；角色「加强」文本 `buffed_description` 只有它提供。
- [lunaris.moe](https://lunaris.moe) — 第三方图鉴（**有 CHS 中文**）：旅行者固有天赋、最新新增的武器 / 圣遗物（含武器逐级数值）、角色状态说明词条（`hyperlinks` → `states`）、genshin-db 没有的角色基础属性（`info.attributes`）。清单里混有历史遗留（如未实装的旧套装），脚本只取「当前版本有、上一个 `X.Y.0` 快照没有」的条目；**缺**武器故事、圣遗物部位描述与故事（页面按空值兜底）。
- [Snap.Metadata](https://github.com/SnapHutaoRemasteringProject/Snap.Metadata) — 新角色中文元数据（比 genshin-db 新）。
- [enka.network](https://enka.network) — 头像 / 武器 / 圣遗物图标 CDN。

新内容一律**只写本地没有的条目**（不覆盖 genshin-db 的高精度数据），带 `"beta": true` 与 `version` 参与排序；实装后跑 `npm run data:equip:force`（武器 / 圣遗物）或 `npm run data:profiles`（角色）即被正式服数据覆盖补全。

## 正式服全量刷新（新版本上线后）

```bash
npm install genshin-db@latest            # ① 升级数据包（数据跟着包走）
npm run data -- 1                        # ② 全量重刷角色 / 武器 / 圣遗物 + 全部解析（= 下面两行）
npm run data:equip:force && npm run data:profiles
npm run data:equip:icons                 # 可选：图标下到 content/*/images/
node scripts/fetch-avatars2.mjs          # 可选：从 enka CDN 补缺失头像
```

> ⚠️ `generate-profiles.mjs` 与 `--force` 都是**无条件全量覆盖**，会吃掉手工补写的文案；重刷后记得补跑 `npm run data:buffs`（`buffs` 字段来自 gachabase，重建角色 JSON 时不会带上）。

## 维护方式

- **改文案 / 数据**：直接编辑 `content/**` 下的 JSON 或 md，然后 `npm run data`（`dev` / `build` 也会自动跑解析）。附着/产球只改 `content/attachment/元素附着及产球.md`（时间格式 `N hits / X s`）；配色改 `content/meta/colors.json`。
- **武器获取方式**：改 `content/meta/weapons-meta.json` 的 `sources`，再跑 `node scripts/generate-weapons.mjs --force`。
- **改加强文本**：`npm run data:buffs` 重新生成；手改某条 `buffs.description` 时只在 `<buff>…</buff>` 里包新增片段（重跑会覆盖手改）。
- **补新内容**：`npm run data -- 2`（gachabase）或 `-- 3`（lunaris）；新角色依次试 gachabase → `generate-profiles.mjs` → `import-snap.mjs`（需在脚本 `TARGETS` 里登记）。
- **旅行者**：固有天赋「异邦的××」用 `npm run data:lunaris -- --kind=char` 补；冰旅行者实装版本 7.0 写在 `sync-character-versions.mjs` 的 `VERSION_OVERRIDE`。
- **武器数值缺失**：测试服武器（gachabase）没有 lv1 数值与逐级曲线，跑一次 `npm run data:lunaris -- --kind=weapon` 补全（脚本识别 `beta` 且缺 `baseAtk`/`curve` 的条目并保留其突破材料与故事）。
- **状态说明（悬浮词条）**：天赋正文里的「领唱」「重唱」这类词条在页面上悬停显示说明，数据存 `states`；由 `npm run data:lunaris -- --kind=char` 按 lunaris 正文的 `{LINK#N<id>}` 标记写入（只处理真正被链接的词条，同名未链接的不挂；可反复跑，会收回之前误挂的）。
- **角色属性（生命值 / 攻击力 / 防御力 / 突破属性）**：`npm run data:profiles` 会给有 genshin-db 数据的角色写 `stats`；genshin-db 没有的角色（旅行者、未实装的沃雅妮莎 / 薇斯纳）由 `npm run data:lunaris -- --kind=char` 用 `info.attributes` 补（两套口径已交叉校验，突破节点差 ≤2 点）。
- **角色逸闻**：lunaris 正文里的 `<i>…</i>` 斜体段，`npm run data:lunaris -- --kind=char` 会在本地缺逸闻时补上（genshin-db 的新角色正文常常没这段；已存在的不覆盖）。
- **加 Boss 图片**：放 `content/boss/images/`，文件名与 md 里的 `images/xxx.webp` 一致。
- **新增条目不必改页面代码**：列表页只读 `src/data/*-index.json`，详情页按名称懒加载 `content/*/<名称>.json`；图标默认走 enka CDN，跑过 `npm run data:equip:icons` 后自动优先用本地图标。

## 部署

纯静态产物，由 Cloudflare Workers 静态资源托管（`wrangler.jsonc`：`assets.directory=./dist`、`not_found_handling=single-page-application` 回落 `index.html` 配合 hash 路由）。Workers Builds 自动执行 `npm clean-install` → `npm run build` → `npx wrangler deploy`；本地手动部署先 `npx wrangler login`。
