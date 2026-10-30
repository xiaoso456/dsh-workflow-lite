# AGENTS.md

给在本仓库里干活的代理（和人）看的说明。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm run build` | 构建 `lib/`（改了前端或主机代码，测试实例要重启才看得到） |
| `pnpm run typecheck` / `lint` / `pnpm test` | 类型检查 / biome / vitest |
| `pnpm run hero` | 重做 README 封面图 |
| `pnpm run timeline` | 重做 README 版本线 |
| `pnpm run release-card [版本] [zh\|en]` | 出版本更新卡片 |

出图的几条命令都要一个带 DevTools 端口的 Chrome：`node tests/lib/cdp-chrome-launch.mjs 9222`；除 `hero` 外都不用起 dsh。

## 发布与推送

```sh
# 1. 先构建再验证：打包守卫读 lib/，没构建就整块跳过
pnpm run build && pnpm run typecheck && pnpm run lint && pnpm test
# 2. CHANGELOG：Unreleased 落成 ## [<ver>] - <日期>，随本版提交；不更新不发版
# 3. 版本自增（同时提交并打 tag workflow-lite-v<ver>）
pnpm version minor
# 4. 推送 + 发 npm
git push && git push --tags && npm publish
# 5. GitHub Release（手动；notes 用 CHANGELOG 本节）
gh release create workflow-lite-v<ver> --title "v<ver>" --notes-file <notes 文件>
```

- **版本号按严格 SemVer，看公共 API 不看改动大小**：公共 API 是工具接口、工作流 JSON / state.yaml 格式、RPC 目标、peer 区间。新增能力 → minor；修 bug、改措辞、重构 → patch；删改上述接口或让旧版读不了新文件 → major。只改界面呈现按实际做了什么归类，加了能力就是 minor。
- 不兼容变更在 CHANGELOG 里明说：哪一侧不兼容、会丢什么、哪些不受影响。
- `.npmrc` 把 `@xiaoso` 指到 npmjs 官方源（镜像站发不了）；`publishConfig.access: public` 不能删，否则 scoped 包按 restricted 发。
- 插件版本与 dsh 不锁步：peer（与 `engines.dsh` 同串）是 `>=0.2.0-0 <0.2.1-0 || >=0.2.1-0 <0.3.0-0`，只在换支持版本线时改。peer 对不上时宿主**静默跳过**（症状是工具消失、补丁不生效），查 `<profile>/cordis.yml` 有没有自己的行。
- `THIRD_PARTY_NOTICES.md` 由 `scripts/notices.mjs` 生成，别手改；改过依赖 build 一次，变了就一起提交（`notices:check` 和 `tests/package.spec.ts` 会查）。

## CHANGELOG 写法

每节原样贴进 GitHub Release，写给用户看。

- 小节用 Added / Changed / Fixed，需要时加 Other（不兼容、迁移、依赖、开发者接口）；Release 里对应「新增功能 / 体验优化 / 问题修复 / 其他变更」。
- 一条一句，句末带句号，最多用分号接一个分句；不分子条目、不加粗标题。写不完说明在讲实现。
- 写用户能感知的结果，不写组件名、CSS、RPC、源码路径；界面上的名字、命令、设置项照写。
- 新增用「新增 / 支持」，优化用「优化 / 改善」，修复写「修复〈什么情况下〉〈出了什么问题〉的问题」；不写「以前……现在……」。
- 实验性、已知限制写进同一句；不兼容变更在同一句里写清谁受影响、要做什么。
- 同一处的小改合成一条；重构、测试不写；这一版新加又在这一版修掉的问题不写进「问题修复」。
- 一节开头可以留一两句概述，和一句「升级要不要做事」。

例：差「右栏、版本对话框内容一多是整栏连标题一起滚。现在标题钉在上面，只有表在框里滚」；好「实例、版本较多时只有列表在框内滚动，标题和保存栏保持不动。」

## DSH 版本

- 兼容区间写成三段版本号的区间（预览版也要能装），放在每个 `@deepseek-ai/dsh-*` 的 `peerDependencies`；DSH 查 peer 带 `includePrerelease`，不能用 `^`。
- `devDependencies` 的 `@deepseek-ai/dsh-*`、`@deepseek-ai/cordis` 写死精确版本，配合 lockfile。
- 换版本线时四处一起改：peer 区间、dev 版本、两版 README 的 DSH 徽标与适配说明；`tests/package.spec.ts` 查一致。

## 编译口径（DSH / 通用）

同一张图编译成两种口径：插件里执行用 DSH 口径，导出成 skill 用通用口径（给了 `PlanOptions.skill` 就是通用）。

- 跟执行环境有关的话（执行方式、复用执行者、设定目标、加载 skill、运行状态）只写在 `src/shared/dialect.ts`，每句两套：DSH 口径可点名工具和插件动作，通用口径不点名任何工具。`compile.ts` 里不写工具名。
- 运行状态：DSH 口径由插件建实例、模型经 `state` 改；通用口径由模型自己建、改 `.workflow-lite/runs/{instance}/state.yaml`，计划里给出初始内容。
- 加设置或改措辞两套一起写；`tests/shared/dialect.spec.ts` 用通用口径扫 `DSH_ONLY_TERMS`，新的工具名、插件说法要补进表。

## 配色主题

- 亮暗各四套（晴白、瑞士、雾蓝、林间 / 石板、墨黑、深海、暖夜），色值全在 `src/client/model/themes.ts`；默认晴白 + 石板。非默认几套照成熟方案配（Nord、Everforest、Geist、Tokyo Night、Gruvbox），一套换全套：线色、强调色、步骤图标色、状态色。
- 视图根写 `--wl-l-*`、`--wl-d-*` 两组内联变量，`shell.module.css` 用 `light-dark()` 拼成 `--wl-*`；CSS 里不写死色值。
- 「瑞士」还带一套「形」：亮色下视图根写 `data-look="swiss"`，`--wl-round` 归零、去阴影、换 Helvetica 系字体。所以新写圆角一律 `calc(Npx * var(--wl-round, 1))`（圆点 50% 不乘）；新加成组的盒子或卡片，在模块末尾补一条 `:global([data-look="swiss"]) .x`（列表只留上下线、输入框只留底线、分段反白、分组标题压黑线）。
- 选择存浏览器（`workflow-lite.theme`），在工作流中心「设置 → 外观」里换，即点即生效。
- 改色要过 `tests/client/themes.spec.ts`：文字和语义色在面板上 4.5:1，线色在画布上 3:1，七种线两两 OKLab ΔE ≥ 8（默认两套 ≥ 13）。

## 浏览器验收（CDP）

`tests/cdp-*.mjs` 在真浏览器里走一遍，结论以磁盘 / RPC 为准。要一个装了本插件的 dsh 网页实例（默认 3190，取它打印的 `?token=`）和 DevTools Chrome：

```bash
DSH_WEB_TOKEN=<token> DSH_BASE=http://127.0.0.1:3190 node --experimental-strip-types tests/cdp-ui.mjs
```

`DSH_BASE` 每次现读（截图管线 import 之后才知道端口），`DSH_AUTH_COOKIE` 可跳过换 cookie。

| 脚本 | 覆盖 |
|---|---|
| `cdp-ui.mjs` | 画布编辑、资源、工作流切换 / 改名 / 删除 |
| `cdp-runs.mjs` | 实例与运行状态 |
| `cdp-inputs.mjs` | 执行前提问 |
| `cdp-versions.mjs` | 版本、工作流中心「工作流」页 |
| `cdp-config.mjs` | 「设置」页（含配色主题） |
| `cdp-pack.mjs` | 导出、导入、导出成 Skill（装到本机用一次性名字，验完删掉） |

## 插件图标与词标

- 两张 448 见方的图**别互相替换**（`tests/package.spec.ts` 钉着）：
  - `assets/icon.webp` 是插件图标（`package.json` 的 `icon`）。先裁到主体再缩：裁框 950 见方、左上角 `(115, 0)`，脸占四成、黑猫发卡完整；整幅缩进去缩略图上认不出人。
  - `assets/icon-full.webp` 是 README 头图，整幅不裁。
- 两张都：LANCZOS 缩到 448、圆角 104（8 倍超采样画）、WebP 无损（`lossless=True, quality=100, method=6`）。
- 宿主只收清单目录下的相对路径，SVG / PNG / JPEG / WebP，≤ 256 KiB，越界静默回退默认图。
- `icon-source.png`、`icon-art.png` 只留仓库做参照，不发布。
- `assets/wordmark.png`：Jua 字体逐词纯色（蓝 `#3e7ce4`、绿 `#60ba7e`、金 `#cd9e70`），1147×130；重做时 Pillow 按 4 倍画、缩到 1/4、墨迹外留 6% 边距，字体用时从 Google Fonts 取。
- README 两版开头是「图标 140 + 词标 360」居中，没有 H1；改文案两版同步。

## README 版本线

`assets/versions.{zh,en}.png`，挑重要变化一条一站，内容在 `tests/readme/versions.json`，排版在 `versions.html`。

- 每站写 `version`（可加 `label`、跨版本写 `to`）、标题、两行短话、可选 `tag`（英文用 `Beta`）；未发写 `"next"`，未定版本的规划写 `"planned"`。
- 脚本对照 CHANGELOG：json 里的版本不存在、或有新小版本没写进 json 都报错。
- 发版时把 `"next"` 改成版本号、重跑、一起提交。
- 6 站左右（多了合并早期几站）；标题 ≤ 7 个汉字 / 15 个英文字符，短话每行 ≤ 9 个汉字 / 22 个英文字符。

## 版本更新卡片

发群聊用的一张图：头像 + 词标、插件是什么、本版标题 + 4 条两列亮点、带版本号的安装命令。560 宽（出图 1120），整张深色直角不留透明边（聊天软件会把透明处铺成白底）。

- 内容在 `tests/readme/release.json`（`intro` 写一次，`versions` 按版本写 `headline` + `items`），字数上限见其 `_说明`；排版在 `release.html`。图标名取 `src/client/ui/Icon.tsx`，色调 blue / green / gold / teal。
- 出到 `tests/runs/release/v<版本>.<lang>.png`，不进库；版本号要在 CHANGELOG 里，日期从那里读。
- 发版时从 CHANGELOG 挑 4 条用户最能感知的，各写一个标题加一行短话，句末不加句号；出图后看一眼，超长会被省略号截掉。

## README 封面图

`assets/hero.{zh,en}.png`（2 倍像素），同一页 HTML 按语言排版后截图，图里的界面都是真实截图。

| 文件 | 作用 |
|---|---|
| `tests/support/shots-env.mjs` | 自备环境：假模型、截图专用 profile、随机端口实例、cookie、固定标题的夹具会话；`startShotsEnv()` 一把起完 |
| `tests/readme-shots.mjs` | 起环境、建示例工作流和实例，按封面里的大小拍素材到 `tests/runs/hero/<lang>/`，拍完拆掉；加 `en` 只拍一种 |
| `tests/readme/hero.html` | 封面排版，`?lang=zh` / `?lang=en`，文案在页尾 `TEXT` |
| `tests/readme-hero.mjs` | 按 1040 宽渲染并截图；`pnpm run hero:render` 只出图不重拍 |

管线的坑：

- **自己一个家**：`tests/runs/shots-home` 当 `DSH_HOME`，跑前清空、跑完删。会话库这些按 `DSH_HOME` 算、不按 profile 隔离，共用用户的家，夹具会永久留在他侧栏里。
- **夹具是认领来的**：会话按固定 id 复用、跟着原 cwd 走，host 又不能删会话；找到就用它的 cwd 当工作区（`adoptedWorkspace`），**收尾不许删这个目录**。
- **进会话靠搜索**：分组展开状态按 origin 存，换端口全折叠，会话行不在 DOM 里，`enterSession` 走搜索框。
- **关实例要等真的关掉**：`stop()` 等 `close`，等不到就抛；不等的话实例留在后台，下一跑撞 `session/writer-held`。
- **等假模型真的收到请求**才算夹具发完，别拿 `blank` 变 false 当信号。

改封面时：

- 计划节选摘自 `tests/runs/hero/zh/plan.txt`（英文版是译文），编译器措辞变了要同步；中英文案一起改，用平实陈述句，不用「不是……而是……」。
- 素材按封面里的大小拍，`hero.html` 按「原图宽 ÷ 2」摆，不在封面里缩放；窄面板单独裁。
- 封面 1040 宽（GitHub 约显示 880），示例工作流只留四步；改页宽要同步 `readme-shots.mjs` 的 `GRAPH_WIDTH`。
- 工作流的图是主角，右栏的时间线和看板按原大拍（`MIN_SCALE` 1，再小在 GitHub 上就糊了）；第三段两列齐平不留空。
- 出图后两张都看一眼：没有错位、截断，没拍进本机路径或私人工作区名。

## 文档站

`site/` 是面向使用者的文档站（Starlight），部署到 GitHub Pages（`.github/workflows/docs.yml`，推到 main 且改了站点相关文件时触发）。仓库设置里要把 Pages 的来源选成 GitHub Actions。

- **独立安装单元**：`site/` 有自己的 `pnpm-workspace.yaml`、lockfile 和 `node_modules`。根目录的 `pnpm install`、lint、tsc、vitest、tsdown 都不碰它，它也不 import `src/`。在 `site/` 里 `pnpm install` / `pnpm dev` / `pnpm build`。
- **Astro 版本钉在 7.3.x**：7.4 起要求 Node ≥ 22.23.4，换版本前先看本机和 CI 的 Node。
- **`pnpm run sync`（dev 和 build 前自动跑）** 生成两样东西，都在 `site/.gitignore` 里，别手改：品牌图（从根 `assets/` 复制）、「更新日志」页（由 `CHANGELOG.md` 生成）。
- **`pnpm run check:settings`（build 前自动跑）**：设置页（`settings/plugin.md`）必须写到 `PLUGIN_CONFIG_KEYS` 里的每一项，用界面上的中文名对照。新增设置项时，在 `site/scripts/check-settings.mjs` 的 `LABEL_KEY` 补一行、在设置页补说明，否则构建失败。
- **侧栏分组**在 `astro.config.mjs` 的 `sidebar` 里逐页列出，不跟目录走：快速开始、典型场景、画布操作（常用，页面要短）、画布展示（里程碑功能，每种内容各一页）、进阶（少用的，查阅）。新增页面要在这里加一行，改了侧栏要重启 dev。分组默认收起，当前页所在的组自动展开。功能越是里程碑式的（版本说明里反复出现的），越要单独成组、每个变体各有截图。
- **界面截图**在 `site/src/assets/shots/`（进库，webp，按 2 倍像素）：`pnpm run docs:shots [名字 ...]` 自备环境重拍（要一个带 DevTools 端口的 Chrome，同 `hero`；界面改了先 `pnpm run build`；嵌套的步骤要整套跑，别按名字筛）。脚本在 `tests/docs-shots.mjs`，示例工作流写在脚本里。正文用 `![一句说明](../../../assets/shots/名字.webp)` 引用：图居中，`alt` 就是图下的说明文字，所以要写成有信息的一句话（`src/components/MarkdownContent.astro` 负责包成 figure）；整页和对话框按一半尺寸显示，单张卡片按四分之三，点击放大。**截图在正文栏（约 800 像素）里要看得清字**：太宽的整张画布缩进去就糊了，要裁到相关的一段（如 `loopBox`），或把几张卡片拼成总览（`display-collage`）。新页面能配图就配图，让读者先看到效果。
- **顶栏的主题、语言下拉**是自绘的（`src/components/Dropdown.astro`，popover）；侧栏展开收起、页面切换、截图放大都有过渡，只动 opacity / transform（侧栏高度例外，靠 `::details-content`），都要照顾 `prefers-reduced-motion`。页面用视图过渡（`Head.astro` 里的 `ClientRouter`）切换，写页面脚本时监听 `astro:page-load`，不要只在首次加载时绑一次。
- **英文页**在 `src/content/docs/en/`，与中文页同路径；缺哪页就回退显示中文（更新日志只有中文）。改了中文页要同步英文页。界面名称用 `src/client/i18n.ts` 里 `en` 的原文（先按中文名在 `zh` 里找键，再取同键的 `en`），别自己意译；站内链接带 `/dsh-workflow-lite/en/` 前缀，锚点用英文标题的 slug；图片相对路径比中文页多一级（`../../../../assets/shots/`）。`description` 里有冒号要加引号，否则 frontmatter 解析失败。首页文字在 `Home.astro` 的 `text.zh` / `text.en`。英文页引用 `site/src/assets/shots/en/` 的英文界面截图（`DOCS_LANG=en pnpm run docs:shots` 重拍，与中文同名，示例工作流名不能含空白）；首页的两张界面图由 `sync-assets` 从 `hero.en.png` 裁出。界面或示例内容改了，两种语言各拍一遍。
- **代码块自带的文字**（复制按钮、终端窗口）在 Windows 下总是中文，`MarkdownContent.astro` 在英文页里替换成英文；改动 Starlight 或 Expressive Code 版本后，核对 `dist/en` 里还有没有中文残留。

写作规则（读者是插件使用者，写「怎么用、各项怎么配、能做到什么」）：

- **少写字，让读者看图**：页首一句话说明这是什么，紧跟一张截图；操作写成编号步骤，一步一行；配置项用表格；注意事项不超过几条，只写会踩的坑。界面上看得出来的不用文字重复，同一件事只在一页写全、其他页放链接。每页的篇幅以一屏半到两屏为限。
- 页面按「概述 → 使用 → 设置 → 注意」的顺序组织，没有内容的部分不写标题；配置项用表格，写明位置、可选值、默认值、效果。
- 用书面语：陈述句，不用「你」，不写口语词；操作写「点击「执行」」，界面名称原样放进「」。
- 页面里每个词，用户在界面或日常使用中都能看到。不写 peer、补丁、口径、RPC、组件名、内部文件格式、工具参数。DSH 版本只写「支持 0.2.x」。
- 配置项的名称、选项、默认值以界面文案（`src/client/i18n.ts`）和源码默认值为准；没核实过的行为不写。
- 站内链接带 `/dsh-workflow-lite/` 前缀。
