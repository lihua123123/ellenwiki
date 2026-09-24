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
| 我的角色 | `#/my-characters` | **输入 UID** 直读展示柜角色（武器 + 圣遗物副词条），或**导入 GOODScanner 的 `GOODv3.json`** 拿到全部角色；按「词条数」降序列出当前角色的副词条；免登录、数据只存 `sessionStorage`，关闭标签页即清除 |

仅有深色主题。窄屏（≤900px）下侧边导航自动转为顶部横条。

## 快速开始

```bash
npm install
npm run dev      # 解析 md → src/data，然后启动开发服务器（不联网）
npm run build    # 解析 md → src/data，构建到 dist/
npm run deploy   # 构建 + 部署到 Cloudflare Workers
```

## 数据源与更新方式

### 三个数据源

| 数据源 | 口径 | 角色 | 武器 | 圣遗物 | 说明 |
| --- | --- | :-: | :-: | :-: | --- |
| [genshin-db](https://github.com/theBowja/genshin-db) | **正式服** | ✅ 全量（含 1~90 级属性表） | ✅ 全量（含逐级曲线） | ✅ 全量 | npm 包，本项目最权威的来源；只有正式服 |
| [gachabase](https://gi.gachabase.net) | 最新（**含体验服**） | ✅（含「加强」文本） | ⚠️ 只有技能文本，无 lv1 数值与曲线 | ✅ | 唯一能拿到 beta 完整图鉴的来源 |
| [lunaris.moe](https://lunaris.moe) | 最新（**含体验服**） | ⚠️ 只能补全 | ✅（含逐级数值） | ✅ | 第三方，有 CHS 中文；没有武器故事与圣遗物部位描述 |

> 三个源都由 `scripts/sources/` 下的适配器实现同一套接口，所以「更新方式」只有一条代码路径。

### 四个动作

每个数据源都支持这四个动作，命令一律是 `npm run data -- <数据源> <动作> [名称]`：

| 动作 | 作用 | 会写文件吗 |
| --- | --- | :-: |
| `scan` | **扫描新增**：列出「数据源有、本地没有」的角色 / 武器 / 圣遗物 | 否（只读） |
| `add` | **导入新增**：把 scan 到的条目抓回来写入 `content/**` | 是 |
| `check <名称>` | **精确复查单条**：把本地 JSON 与数据源逐字段对比（`0.0`→`1.0` 式差异清单），确认后覆盖 | 询问后才写 |
| `fill [名称]` | **补全空字段**：用数据源填补本地缺失内容（不改已有值） | 是 |

**覆盖规则**：整条以数据源为准；数据源给不出的字段（缺失 / `null` / 空串 / 空数组）保留本地值，并在复查报告里以 `⤶ 数据源给不出、覆盖后保留本地值：…` 列出。例如用 genshin-db 覆盖测试服武器时，local 的突破材料与武器故事会留下。

两条保护规则：

1. **版本号不倒退**：体验服源的 `version` 是「下一版」推算值（gachabase 取 beta 修订号 +1），当本地条目已经是实装内容时**保留本地版本号**，避免把 7.0 的角色排到 7.2 最前面。
2. **已实装内容别用体验服源覆盖**：用含体验服的源复查已实装条目时会打印警告 —— 覆盖会写入 `beta` 标记（条目跳到图鉴最前）并可能用测试服文本替换正式内容，这类内容应当用 `genshin-db`。

报告里还有 `~ 数组 3 项 → 2 项`、`~ 文本不同（本地 128 字 → 源 164 字，首个差异在第 118 字）` 这类提示：**列表与数值一律以数据源为准**，被替换掉的内容如果是别的源补全的，覆盖后可用 `fill` 补回。

### 典型流程

```bash
# ① 新版本前瞻：看有哪些新内容
npm run data -- gachabase scan

# ② 导入（新角色会自动下载头像、在 content/attachment/元素附着及产球.md 追加占位小节）
npm run data -- gachabase add

# ③ 测试服武器没有数值 → 用 lunaris 补逐级曲线（保留突破材料与故事）
npm run data -- lunaris fill --kind=weapon

# ④ 对某个条目有疑问：精确复查 → 看差异 → 覆盖
npm run data -- lunaris check 米提亚
npm run data -- gachabase check 米提亚 --yes     # --yes 跳过确认（脚本用）

# ⑤ 实装之后：用正式服数据整体覆盖（见「正式服全量刷新」）
npm run refresh
npm install genshin-db@latest
```

交互式用法（不带参数）：`npm run data` 会依次让你**选数据源 → 选动作**，并在 `check` / `fill` 时询问名称。

```bash
npm run data        # 交互：1 gachabase / 2 lunaris / 3 genshin-db → 1 扫描 / 2 导入 / 3 复查 / 4 补全
npm run esdata      # 体验服口径（= npm run data -- --beta，只列含体验服数据的源）
npm run data -- --list        # 只列出数据源
```

通用参数：

| 参数 | 说明 |
| --- | --- |
| `--kind=角色\|武器\|圣遗物` | 只处理某一类（也接受 `char` / `weapon` / `artifact` / `all`） |
| `--dry` | 只看会做什么，不写任何文件 |
| `--refresh` | `add` 时连本地已有的 `beta` 条目一起重抓（测试服数值会随 revision 变） |
| `--yes` | `check` 时跳过「是否覆盖」确认（非交互脚本用） |
| `--beta` | 体验服口径：只列 beta 源，且 `add` 默认带 `--refresh` |

`npm run esdata` 就是 `npm run data -- --beta` 的别名。旧命令仍是薄封装，行为等价：`node scripts/sync-gachabase.mjs` = `data -- gachabase add`，`node scripts/sync-lunaris.mjs` = `data -- lunaris add` + `data -- lunaris fill`。

## 命令一览

| 命令 | 目的 |
| --- | --- |
| `npm run dev` | 解析 md 后启动开发服务器（不联网） |
| `npm run api` | 本地跑 Enka 转发 Worker（`wrangler dev`，端口 8787；vite 已把 `/api` 代理过去） |
| `npm run build` | 解析 md 后构建到 `dist/`（不联网） |
| `npm run deploy` | `build` + `wrangler deploy`（Cloudflare Workers） |
| `npm run data` | **数据源同步入口**：交互式选源 → 扫描新增 / 导入新增 / 精确复查 / 补全 |
| `npm run esdata` | 同上，但只面向**体验服 / 未实装**内容（= `data -- --beta`） |
| `npm run parse` | 只解析本地 md：幽境 Boss + 附着产球 → `src/data/` |
| `npm run index` | 由 `content/{weapons,artifacts}/*.json` 重建列表索引 + 游戏内 ID 对照表（已存在条目不动） |
| `npm run refresh` | ⚠️ **正式服全量重刷**：角色 + 武器 + 圣遗物（genshin-db `--force`）→ 解析 → 版本 → 加强文本 |
| `npm run refresh:characters` | 只用 genshin-db 重刷全部角色资料（⚠️ 覆盖手工文案、清掉 `buffs`） |
| `npm run refresh:equip` | 只用 genshin-db 重刷全部武器与圣遗物（⚠️ 覆盖手工文案） |
| `npm run buffs` | 重算角色「加强」文本（数据来自 gachabase；`--dry` 可先看对照） |
| `npm run versions` | 只补 / 更新角色 `version`（实装版本，决定图鉴排序） |
| `npm run icons` | 把武器 / 圣遗物图标下载到 `content/*/images/`（离线可用） |
| `npm run avatars` | 从 enka CDN 补缺失的角色头像 |
| `npm run game-ids` | 生成 `src/data/game-ids.json`（avatarId / 武器图标名 / 圣遗物 setId → 站内条目），供「我的角色」还原名字 |
| `npm run snap` | 用 Snap.Metadata 补新角色中文元数据（需先在脚本 `TARGETS` 里登记） |

> 旧的 `data:sync` / `data:lunaris` / `data:buffs` / `data:profiles` / `data:equip:force` / `data:equip:icons` / `data:all`
> 已按用途改名：`data`(同步入口) / `buffs` / `refresh:characters` / `refresh:equip` / `icons` / `refresh`。

## 页面与数据约定

- 数据源：`content/characters|weapons|artifacts/<名称>.json`（genshin-db 生成，新内容由 gachabase / lunaris 补齐），改完跑 `npm run data` 或 `npm run index`。角色等级数值按 `label + values 数组`存，页面用步进器（− / ＋ / 滚轮）切换。
- 描述文本：`\n\n` 分段；「标题+正文」段转悬停术语（虚线下划线 + 气泡）；结尾无机制词的段落判为**角色逸闻**（附录色斜体，纯展示、不做悬停）。
- **天赋等级表**：行标签只写名称（如 `基础持续时间`），单位跟着值走（`15.0秒`）—— 不再把单位塞进标签。
- **状态说明（悬停词条）**：存在条目的 `states`（`{ name, text }`）里，正文里出现该名字即自动包成虚线下划线 + 气泡；由 genshin-db 的正文解析，再由 lunaris 的 `fill` 按正文里的 `{LINK#N<id>}` 标记补词条（**只看 LINK 标记**，同名但未被链接的词不挂说明）。
- **加强文本（金色 `.rt-buff`）**：gachabase 有 `buffed_description`（genshin-db 没有），`npm run buffs` 与基础描述做逐词 diff 后，**只把新增片段**包进 `buffs.description` 的 `<buff>…</buff>`（重叠文段保持正文色）。当前 14 名角色：七七 / 可莉 / 温迪 / 阿贝多 / 莫娜 / 砂糖 / 雷泽 / 菲谢尔 / 八重神子 / 北斗 / 迪奥娜 / 赛诺 / 莱欧斯利 / 梦见月瑞希。
- **技能引用（淡紫 `.rt-skill`）**：天赋里提到技能时（`元素战技柔板·幻灵夜舞`）标出，与金色区分；武器 / 圣遗物不标。
- **数值高亮（主题蓝 `.rt-num`）**：武器精炼、圣遗物套装、技能文本里的百分比 / 带单位数值。武器与圣遗物正文里的 `魔导·秘仪` / `月兆·满辉` / `辉映·星烁` 属于正文本身，**不上色**。
- **武器等级模拟**：滑块 1~max + 「已突破」勾选（仅 20 / 40 / 50 / 60 / 70 / 80 可切），数据来自 `curve.attack[lv-1]`（已突破）/ `curve.preAttack[cap]`（未突破）；1~2★ 上限 70 级。
- **角色属性**：生命值 / 攻击力 / 防御力 / 突破属性四格 + 同一套等级滑块（1~90，突破节点同上），数据存 `stats`；`specialized` 只存突破带来的增量。
- **排序**：三个图鉴都按实装版本（`version`）倒序，同版本再按星级 / 名称；测试服条目带 `"beta": true` 排最前。
- **UI 约束**：卡片不加悬停遮罩、不加左侧彩色描边；圣遗物部位不用颜色区分；主题色只由星级决定。

## 目录结构

```
content/          唯一数据源：formulas / boss / attachment / characters / weapons / artifacts / meta
worker/           Cloudflare Worker：静态资源 + Enka 只读转发（/api/enka，无状态）
scripts/
  data.mjs / esdata.mjs        数据源同步入口（npm run data / esdata）
  sources/                     数据源适配器：genshin-db.mjs / gachabase.mjs / lunaris.mjs + index.mjs（注册表与 scan/add/check/fill）
  lib/                         共用底座：local-store（content 读写与覆盖规则）、json-diff（复查差异）、
                               gdb（genshin-db 字段映射）、lunaris（接口客户端）、profile-text、char-stats、compact-json、prompt、attachment-md
  parse-boss / parse-attachment      md → src/data
  generate-profiles / -weapons / -artifacts   genshin-db → content/（角色 / 武器 / 圣遗物 + 索引重建）
  generate-game-ids                          游戏内 ID（avatarId / 武器图标名 / setId）→ 站内条目，供「我的角色」还原名字
  sync-buffs / sync-character-versions        角色「加强」文本 / 实装版本
  sync-gachabase / sync-lunaris               旧命令的薄封装（转发到 data.mjs）
  fetch-avatars2 / import-snap                补头像 / 补新角色元数据
src/              main.js（路由 + 侧边导航）· core/（渲染器 + level-sim.js 等级滑块组件）· pages/ · data/（生成产物，勿手改）· styles/
```

## 正式服全量刷新（新版本上线后）

```bash
npm install genshin-db@latest     # ① 升级数据包（数据跟着包走）
npm run refresh                   # ② 全量重刷三类图鉴 + 解析 + 版本 + 加强文本
npm run icons                     # 可选：图标下到 content/*/images/
npm run avatars                   # 可选：补缺失头像
```

> ⚠️ `refresh` / `refresh:characters` / `refresh:equip` 都是**无条件全量覆盖**，会吃掉手工补写的文案
> （`generate-profiles.mjs` 还会清掉 `buffs` 字段 —— `refresh` 已在最后一步重新生成它）。
> 只想更新某一条时不要用 `refresh`，改用按名称精确复查：`npm run data -- genshin-db check 胡桃`。

## 维护方式

- **改文案 / 数据**：直接编辑 `content/**` 下的 JSON 或 md，然后 `npm run parse` + `npm run index`（`dev` / `build` 也会自动跑解析）。附着 / 产球只改 `content/attachment/元素附着及产球.md`（时间格式 `N hits / X s`）；配色改 `content/meta/colors.json`。
- **武器获取方式**：改 `content/meta/weapons-meta.json` 的 `sources`，再跑 `npm run refresh:equip`（或 `node scripts/generate-weapons.mjs --force`）。
- **补新内容**：`npm run data -- gachabase scan` 看有什么 → `npm run data -- gachabase add` 导入 → `npm run data -- lunaris fill` 补数值。按名称复查用 `npm run data -- <源> check <名称>`。
- **改加强文本**：`npm run buffs` 重新生成；手改某条 `buffs.description` 时只在 `<buff>…</buff>` 里包新增片段（重跑会覆盖手改）。
- **旅行者**：固有天赋「异邦的××」由 `npm run data -- lunaris fill` 补；冰旅行者实装版本 7.0 写在 `scripts/lib/gdb.mjs` 的 `CHAR_VERSION_OVERRIDE`。
- **状态说明（悬浮词条）**：数据存 `states`，由 `npm run data -- lunaris fill` 按 lunaris 正文的 `{LINK#N<id>}` 标记写入（可反复跑，会收回之前误挂的）。
- **角色属性**：genshin-db 覆盖到的角色由 `refresh:characters` 写 `stats`；genshin-db 没有的（旅行者、未实装的沃雅妮莎 / 薇斯纳）由 `lunaris fill` 用 `info.attributes` 补。
- **角色逸闻**：lunaris 正文里的 `<i>…</i>` 斜体段，`lunaris fill` 会在本地缺逸闻时补上（已存在的不覆盖）。
- **加 Boss 图片**：放 `content/boss/images/`，文件名与 md 里的 `images/xxx.png` 一致（统一用 **PNG**，400×400、透明背景）。
- **新增条目不必改页面代码**：列表页只读 `src/data/*-index.json`，详情页按名称懒加载 `content/*/<名称>.json`；图标默认走 enka CDN，跑过 `npm run icons` 后自动优先用本地图标。
- genshin-db 里尚未定名的占位条目（如 `武器-法器`、效果名 `7.2UP武器`）会被自动跳过，不会生成空卡片。

## 部署

纯静态产物，由 Cloudflare Workers 静态资源托管（`wrangler.jsonc`：`assets.directory=./dist`、`not_found_handling=single-page-application` 回落 `index.html` 配合 hash 路由）。Workers Builds 自动执行 `npm clean-install` → `npm run build` → `npx wrangler deploy`；本地手动部署先 `npx wrangler login`。

> 「我的角色」页需要 `worker/index.js`（`/api/enka` Enka 转发）一起部署，`wrangler.jsonc` 里已配 `main`；它只做无状态转发（不落库、不记日志、不缓存）。

## 我的角色（UID 直读 / GOOD 导入）

两条数据来源，都只在本页计算：

**方式一：输入 UID（免登录）**

- 数据来源：[Enka.Network](https://enka.network) 的公开接口 `GET /api/uid/<uid>`，只读游戏内「角色展示柜」里勾了「显示角色详情」的角色（含武器与圣遗物主副词条）。国服（天空岛 / 世界树）与国际服都可用。
- **为什么要 Worker**：Enka 不给浏览器发 CORS 头（实测响应里没有 `access-control-allow-origin`），静态页面无法直连。`worker/index.js` 的 `/api/enka` 只透传「`/api/uid/<9~10 位数字>`」这一个路径，不接收也不保存任何账号信息，也没有 Cookie。
- 展示柜怎么开：游戏内「派蒙菜单 → 资料 → 编辑资料 → 角色展示柜」放上角色，并打开「显示角色详情」。Enka 对同一 UID 约 60 秒才能取一次（太快会返回 429）。

**方式二：导入 GOODScanner 导出的 `GOODv3.json`（能拿到全部角色）**

- 用 [GOODScanner](https://github.com/Anyrainel/GOODScanner)（yas 的加强分支）扫描或抓包，选「全部」，导出标准 [GOOD v3](https://frzyc.github.io/genshin-optimizer/#/doc) JSON；在本页把文件拖进虚线框（或点击选择）即可。
- 这是网页唯一能拿到**账号下全部角色与全部圣遗物**的途径 —— 米游社战绩接口与 Enka 都只能看到展示柜（且米游社接口对本账号返回 `5003` 账号风控，服务端标记无法绕过）。
- GOOD v3 只给 `mainStatKey`（没有主词条数值）→ 导入后卡片里主词条只显示属性名；副词条统计完全不受影响。
- 英文键（`HuTao` / `CrimsonWitchOfFlames` / `critRate_`）靠 `src/data/game-ids.json` 还原成中文名，该表由 `npm run game-ids` 生成（已并入 `npm run index`）。`location` 为空的圣遗物归到「未装备」下（排在最后）。

**共同的展示与口径**

- **页面结构**：状态卡（UID 输入 / GOOD 拖拽）→ 角色条（只占一行，可拖动/滚轮横向查看；点角色切换）→ 角色面板（属性 / 武器 / 圣遗物，主词条 + 每行一条副词条）→ 词条数排序表（**只统计当前角色**）。
- **统计口径**：词条数 = 副词条数值 ÷ 该属性的平均词条值（取「工具」页「圣遗物词条分布」表格里保留一位小数的平均值），按词条数从大到小排列。
- **隐私**：UID 与角色数据只写本页的 `sessionStorage`（关闭标签页即清除），不上传任何服务器。
