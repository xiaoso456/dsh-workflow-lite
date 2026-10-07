# AGENTS.md

给在本仓库里干活的代理（和人）看的说明。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm run build` | 构建 `lib/`（改了前端或主机代码后，测试实例要重启才看得到） |
| `pnpm run typecheck` | 类型检查 |
| `pnpm run lint` | 代码检查（biome） |
| `pnpm test` | 单元测试（vitest） |
| `pnpm run hero` | 重做 README 封面图（中英两张，见下文） |

## DSH 版本

- 兼容范围写成一条三段版本号的区间（预览版也要能装），放在每个 `@deepseek-ai/dsh-*` 的 `peerDependencies` 里；DSH 检查 peer 时带 `includePrerelease`，所以不能用 `^`。
- 编译用的 `devDependencies`（`@deepseek-ai/dsh-*`、`@deepseek-ai/cordis`）写死精确版本，配合 `pnpm-lock.yaml` 防依赖漂移。
- README 两版各带一个同区间的 DSH 徽标和一句适配说明。
- 换支持的版本线时四处一起改：peer 区间、dev 精确版本、两版 README 的徽标与说明；`tests/package.spec.ts` 检查它们一致。

## 配色主题

- 亮色、暗色各四套（米色、晴白、雾蓝、林间 / 石板、墨黑、深海、暖夜），色值全在 `src/client/model/themes.ts`；默认米色 + 石板。
- 视图根节点把选中的两套写成 `--wl-l-*`、`--wl-d-*` 两组内联变量，`shell.module.css` 用 `light-dark()` 跟着宿主的 `color-scheme` 拼成 `--wl-*`；CSS 里不再写死色值。
- 选择记在浏览器（`workflow-lite.theme`），在工作流中心「设置」页的「外观」里换，点了就生效，不走插件设置的保存。
- 一套主题是一整套颜色：线色（光带、图例、线上牌子跟着它）、强调色、步骤图标色、状态色一起换；非默认的几套照着成熟配色方案配（雾蓝 Nord、林间 Everforest、墨黑 Geist、深海 Tokyo Night、暖夜 Gruvbox），主干线用强调色。
- 改色或加主题要过 `tests/client/themes.spec.ts`：文字、语义色、线色、步骤色在面板上过 4.5:1，线色在画布上过 3:1，七种线两两 OKLab ΔE ≥ 8（默认两套 ≥ 13）。

## 浏览器验收（CDP）

`tests/cdp-*.mjs` 在真浏览器里走一遍功能，结论以磁盘 / RPC 为准。需要：

1. 一个装了本插件的 DSH 网页实例（默认 `http://127.0.0.1:3190`），从它打印的 URL 里取 `?token=`；
2. 一个带 DevTools 端口的 Chrome：`node tests/lib/cdp-chrome-launch.mjs 9222`。

```bash
DSH_WEB_TOKEN=<token> DSH_WEB_URL=http://127.0.0.1:3190 node --experimental-strip-types tests/cdp-ui.mjs
```

| 脚本 | 覆盖 |
|---|---|
| `cdp-ui.mjs` | 画布编辑、资源、工作流切换 / 改名 / 删除 |
| `cdp-runs.mjs` | 实例与运行状态 |
| `cdp-inputs.mjs` | 执行前提问 |
| `cdp-versions.mjs` | 版本、工作流中心「工作流」页 |
| `cdp-config.mjs` | 工作流中心「设置」页（含外观：配色主题） |

## 插件图标与词标

- `assets/icon.webp`：448×448、圆角半径 104、8 倍超采样，WebP 无损 219.7 KiB；`package.json` 顶层 `icon` 和 README 两版开头的 `<img>` 都指向它。
- 宿主只收**清单目录下的相对路径**的图标，格式 SVG / PNG / JPEG / WebP，上限 256 KiB；越界界面静默回退默认图。`tests/package.spec.ts` 的「插件图标」四块盯着：路径合法且在包内、不超过 256 KiB、本体与扩展名对得上、`files` 收得下。
- `assets/icon-source.png`（最初的源图）、`assets/icon-art.png`（重绘成赛璐璐平涂，1024 见方）只留在仓库里做参照，不随包发布。
- 图标重做：把 `icon-art.png` 整幅 LANCZOS 缩到 448（不裁），套半径 104 的圆角遮罩，存 WebP 无损（`lossless=True, quality=100, method=6`）。
- `assets/wordmark.png`：「dsh workflow lite」艺术字，Jua 400 Regular 逐词纯色，1147×130——蓝 `#3e7ce4`（项目色）、绿 `#60ba7e`（人物眼睛）、金 `#cd9e70`（金发压深）。README 里按 `width="360"` 摆，图标 140。
- 词标重做：Pillow 把三个词按 4 倍尺寸画到同一基线上，整幅 LANCZOS 缩到 1/4，裁到墨迹外留 6% 边距；字体不进仓库，用时从 Google Fonts 取 `ofl/jua/Jua-Regular.ttf`。
- README 两版开头都是「图标 + 词标」居中的一段 HTML，没有 H1；改文案两版同步。

## README 封面图

README 有中英两版：`README.md`（中文，默认）与 `README.en.md`（英文），开头互相链接。各用一张封面图：`assets/hero.zh.png`、`assets/hero.en.png`（2 倍像素），由同一页 HTML 按语言排版后截图得到，图里的界面都是真实截图（英文版用英文界面和英文示例）。

| 文件 | 作用 |
|---|---|
| `tests/readme-shots.mjs` | 按语言切换浏览器语言，在测试实例里建示例工作流和一个实例，按封面里的大小拍素材到 `tests/runs/hero/<lang>/`（`canvas.png` 编辑页、`run-graph.png` 点亮的图、`run-position.png` / `run-timeline.png` 右栏两小块、`run-dashboard.png` 查看框里打开的 HTML 看板、`plan.txt` 编译出的计划），拍完自动清理；`node … tests/readme-shots.mjs en` 只拍一种 |
| `tests/readme/hero.html` | 封面排版：标题、三段流程（设计流程 → 生成计划提示词 → 跟踪执行进度）、软工作流说明、功能标签；`?lang=zh` / `?lang=en` 切换，文案都在页尾的 `TEXT` 里 |
| `tests/readme-hero.mjs` | 在 Chrome 里另开一个标签页按 1040 宽渲染 `hero.html`，截成 `assets/hero.<lang>.png`；`node tests/readme-hero.mjs en` 只出一种 |

重做步骤：

```bash
# 界面有变化：重拍素材并出图（需要上面「浏览器验收」的两样前置）
DSH_WEB_TOKEN=<token> DSH_WEB_URL=http://127.0.0.1:3190 pnpm run hero

# 只改了 hero.html 的文案或排版：直接出图（素材已在 tests/runs/hero/）
pnpm run hero:render
```

改封面时注意：

- 计划节选是从 `tests/runs/hero/zh/plan.txt` 里摘的原文（计划只有中文，英文版是对应的译文，图里标了 translated），编译器的措辞变了要同步改；
- 两种语言的文案改一处就要改另一处；
- 文案用平实的陈述句，不用「不是……而是……」这类对比句式，也不用过于口语的说法；
- 清晰：素材拍的时候就按封面里的大小换算像素比，`hero.html` 一律按「原图宽 ÷ 2」摆，一个像素对一个像素，不在封面里缩放（缩放就糊）；右栏这类窄面板单独裁出来，别整块界面缩小塞进封面；
- 字要大：封面 1040 宽，GitHub 上大约显示成 880 宽；示例工作流只留四步，图越窄字越大。改页宽、页边要同步改 `readme-shots.mjs` 的 `GRAPH_WIDTH`；
- 层次：工作流的图是主角；右栏小块和看板按图相对原大的比例拍（不小于 `MIN_SCALE` 0.85），字号和图上的字接近，别比图还抢眼；
- 不留空：第三段下半截左列两小块叠起来，右边看板的高度按左列算好再拍，两边齐平；
- 出图后打开 `assets/hero.zh.png`、`assets/hero.en.png` 看一眼，确认没有错位、截断，也没有拍进本机路径或私人工作区名。
