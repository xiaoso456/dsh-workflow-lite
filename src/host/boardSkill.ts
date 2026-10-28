/**
 * dsh-workflow-lite — 按需 skill `workflow-board`：怎么写一张在画布上展示的看板（HTML）。
 *
 * 只给看板用：资源卡开了画布展示、展示的是 HTML、开着「让模型适配展示」时，编译器在写它的步骤的任务描述里
 * 点名这个 skill（见 shared/dialect.ts 的 `dshDisplayLine`）；图片、Markdown、文本卡不读。
 * 任务描述里有这张卡的尺寸和几条硬要求，这里放做法和一份能直接改的模板：同一个文件在画布卡片、
 * 插件的查看框、浏览器里都要好看，颜色跟着画布主题走（约定见 shared/board.ts）。
 *
 * 模板里的后备值是默认两套主题（晴白、石板）的实值，`tests/host/boardSkill.spec.ts` 对着
 * client/model/boardTheme.ts 查，改主题色时一起改。
 *
 * @module @xiaoso/dsh-workflow-lite/host/boardSkill
 */

import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.skills` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-skill'
import {
  BOARD_ATTR,
  BOARD_SKILL,
  BOARD_THEME_EVENT,
  BOARD_TOKENS,
  type BoardToken,
  boardVar,
} from '../shared/board.ts'

const FONT = `system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** 浏览器里单独打开时的后备值：亮色 = 晴白，暗色 = 石板。 */
export const BOARD_FALLBACK: Record<'light' | 'dark', Record<BoardToken, string>> = {
  light: {
    bg: '#ffffff',
    surface: '#f1f3f6',
    line: 'rgb(22 32 52 / 16%)',
    text: '#131820',
    muted: '#444c5a',
    subtle: '#5e6676',
    accent: '#1f6feb',
    'on-accent': '#ffffff',
    ok: '#167a54',
    warn: '#94590a',
    bad: '#c0392f',
    c1: '#2f6fde',
    c2: '#16875a',
    c3: '#a86400',
    c4: '#c84a2b',
    c5: '#0f7f8a',
    c6: '#6b5bd2',
    radius: '10px',
    font: FONT,
    mono: MONO,
  },
  dark: {
    bg: '#181c23',
    surface: '#222730',
    line: 'rgb(226 234 248 / 16%)',
    text: '#e9edf3',
    muted: '#b6bdc9',
    subtle: '#9098a6',
    accent: '#4d94ff',
    'on-accent': '#05132b',
    ok: '#56d08e',
    warn: '#f0b955',
    bad: '#ff7a70',
    c1: '#74aaff',
    c2: '#56d08e',
    c3: '#f0b955',
    c4: '#ff8e70',
    c5: '#55d2dd',
    c6: '#a99cf5',
    radius: '10px',
    font: FONT,
    mono: MONO,
  },
}

/** 一套后备值写成 CSS 声明（缩进 `pad`）。暗色只写颜色，圆角、字体两套一样。 */
function fallbackCss(mode: 'light' | 'dark', pad: string): string {
  return Object.entries(BOARD_FALLBACK[mode])
    .filter(([token]) => mode === 'light' || !['radius', 'font', 'mono'].includes(token))
    .map(([token, value]) => `${pad}${boardVar(token as BoardToken)}: ${value};`)
    .join('\n')
}

const DESCRIPTION =
  '写一张在 workflow-lite 画布上展示的看板（HTML）：卡片版 + 完整版两套版式、跟着画布主题变色的 --board-* 变量、图表怎么画，附一份能直接改的模板。'

const WHEN_TO_USE =
  '任务描述的「画布展示」里说这个文件是一张看板、让你加载 workflow-board 时。只写看板 HTML 时用；图片、报告、普通网页不用读。'

const TOKEN_TABLE = BOARD_TOKENS.map(([token, use]) => `| \`${boardVar(token)}\` | ${use} |`).join(
  '\n',
)

/** 模板的样式：后备值、两版切换、卡片版的三档、组件。组件按 em 排，跟着所在那一版的字号走。 */
const STYLE = `<style>
  /* 后备值：在浏览器里单独打开时用；在插件里由插件写在 <html> 上的同名变量覆盖。 */
  :root {
    color-scheme: light dark;
${fallbackCss('light', '    ')}
  }
  @media (prefers-color-scheme: dark) {
    :root {
${fallbackCss('dark', '      ')}
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--board-bg); color: var(--board-text); font-family: var(--board-font); line-height: 1.4; }
  .num { font-variant-numeric: tabular-nums; }

  /* 色调：文字变色，组件（条、环、点、线）取 --tone。 */
  .ok { color: var(--board-ok); --tone: var(--board-ok); }
  .warn { color: var(--board-warn); --tone: var(--board-warn); }
  .bad { color: var(--board-bad); --tone: var(--board-bad); }
  .c2 { --tone: var(--board-c2); } .c3 { --tone: var(--board-c3); } .c4 { --tone: var(--board-c4); }
  .c5 { --tone: var(--board-c5); } .c6 { --tone: var(--board-c6); }
  .badge { display: inline-block; padding: .15em .7em; border-radius: 999px; font-weight: 700; white-space: nowrap;
           color: var(--board-ok); background: color-mix(in srgb, var(--board-ok) 14%, transparent); }
  .badge.warn { color: var(--board-warn); background: color-mix(in srgb, var(--board-warn) 14%, transparent); }
  .badge.bad { color: var(--board-bad); background: color-mix(in srgb, var(--board-bad) 14%, transparent); }
  .badge.info { color: var(--board-accent); background: color-mix(in srgb, var(--board-accent) 14%, transparent); }

  /* 两版：画布卡片里只显示卡片版，其余（查看框、浏览器）只显示完整版。 */
  .card-view { display: none; }
  [${BOARD_ATTR}="card"] .card-view { display: grid; }
  [${BOARD_ATTR}="card"] .full-view { display: none; }
  [${BOARD_ATTR}="card"], [${BOARD_ATTR}="card"] body { height: 100%; overflow: hidden; }

  /* ── 卡片版：正好一屏。字号跟着卡片大小走，组件都按 em 排。 ── */
  .card-view { height: 100vh; padding: .85em 1em; gap: .6em; grid-template-rows: auto minmax(0, 1fr);
               font-size: clamp(13px, min(7.2vh, 4.6vw), 20px); }
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: .6em; min-width: 0; }
  .card-head h1 { margin: 0; font-size: 1.05em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-head .badge { font-size: .85em; }
  .card-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .9em; min-height: 0; }
  .main, .side { display: grid; gap: .55em; min-width: 0; min-height: 0; align-content: center; }
  /* 主数字按主栏的宽度定字号（cqi），长的数（¥128 万、99.95%）也不挤进旁边那栏。 */
  .main { container-type: inline-size; }
  /* 接近方形、竖长：上下排。 */
  @media (max-aspect-ratio: 5/4) {
    .card-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-content: start; }
  }
  /* 小卡（矮或很窄）：只留标题和主组件。写成 .card-view 下的两级选择器，压过组件自己的 display。 */
  @media (max-width: 199.98px), (max-height: 159.98px) {
    .card-body { grid-template-columns: minmax(0, 1fr); }
    .card-view .side, .card-view .hide-s { display: none; }
  }
  /* 大卡才有的：.only-l。 */
  @media (max-width: 419.98px), (max-height: 259.98px) { .card-view .only-l { display: none; } }

  /* ── 组件（两版都能用） ── */
  .label, .hero span, .kpi span { color: var(--board-muted); font-size: .9em; }
  .hero { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
  .hero b { font-size: min(2.8em, 24cqi); line-height: 1.05; font-weight: 800; white-space: nowrap; }
  .hero small { font-size: .9em; font-weight: 700; }
  /* 指标块按自己的宽度定值的字号（cqi）：并排时窄，五个字符以内也放得下。 */
  .kpi { container-type: inline-size; background: var(--board-surface); border-radius: var(--board-radius); padding: .4em .6em; min-width: 0; }
  .kpi span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kpi b { display: block; font-size: min(1.35em, 30cqi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: .55em; }

  /* 进度环：pathLength=100，stroke-dasharray 的第一个数就是百分比。 */
  .ring { position: relative; display: grid; place-items: center; width: min(100%, 6.4em); aspect-ratio: 1; margin: 0 auto; text-align: center; }
  .ring svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 3.2; }
  .ring .track { stroke: var(--board-surface); }
  .ring .arc { stroke: var(--tone, var(--board-c1)); stroke-linecap: round; }
  .ring b { display: block; font-size: 1.5em; line-height: 1.1; }
  .ring span { color: var(--board-muted); font-size: .9em; }

  /* 进度条：一项一条，--v 是百分比。 */
  .meter { display: grid; gap: .3em; }
  .meter > div { display: flex; justify-content: space-between; gap: .5em; }
  .meter > div span { color: var(--board-muted); font-size: .9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meter > i { display: block; height: .55em; border-radius: 999px; background: var(--board-surface); overflow: hidden; }
  .meter > i::after { content: ""; display: block; width: var(--v); height: 100%; border-radius: inherit; background: var(--tone, var(--board-c1)); }

  /* 对比条：几项比大小、看构成，--v 是相对最大那项的长度。 */
  .bars { display: grid; gap: .4em; }
  .bar { display: grid; grid-template-columns: minmax(2.5em, max-content) minmax(0, 1fr) max-content; align-items: center; gap: .5em; color: var(--board-text); }
  .bar span { color: var(--board-muted); font-size: .9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar i { display: block; height: .6em; width: max(var(--v), 3px); border-radius: 999px; background: var(--tone, var(--board-c1)); }
  .bar b { font-size: .95em; }

  /* 状态格：最近 N 次 / N 天，一格一个结果。 */
  .dots { display: grid; grid-template-columns: repeat(auto-fill, minmax(.8em, 1fr)); gap: .25em; align-content: center; }
  .dots i { aspect-ratio: 1; border-radius: calc(var(--board-radius) * .3); background: var(--tone, var(--board-ok)); }
  .dots i.none { --tone: var(--board-surface); }

  /* 阶段：走到哪一步。 */
  .steps { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 0; padding: 0; list-style: none; }
  .steps li { position: relative; display: grid; justify-items: center; gap: .3em; color: var(--board-muted); font-size: .9em; }
  .steps li span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .steps li::before { content: ""; position: relative; z-index: 1; width: .9em; height: .9em; border-radius: 50%; border: 2px solid var(--board-line); background: var(--board-bg); }
  .steps li::after { content: ""; position: absolute; top: .45em; left: 50%; width: 100%; height: 2px; background: var(--board-line); transform: translateY(-50%); }
  .steps li:last-child::after { display: none; }
  .steps li.done::before { border-color: var(--board-ok); background: var(--board-ok); }
  .steps li.done::after { background: var(--board-ok); }
  .steps li.now { color: var(--board-text); font-weight: 700; }
  .steps li.now::before { border-color: var(--board-accent); background: color-mix(in srgb, var(--board-accent) 30%, var(--board-bg)); }

  /* 短列表：要处理的几件事，最多三条。 */
  .list { display: grid; gap: .35em; margin: 0; padding: 0; list-style: none; }
  .list li { display: grid; grid-template-columns: .55em minmax(0, 1fr) max-content; align-items: center; gap: .5em; color: var(--board-text); font-size: .95em; }
  .list li::before { content: ""; width: .55em; height: .55em; border-radius: 50%; background: var(--tone, var(--board-subtle)); }
  .list li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list li b { color: var(--tone, var(--board-muted)); font-size: .9em; }

  /* 迷你走势：preserveAspectRatio="none" 铺满格子，线不随拉伸变粗。 */
  .spark { display: block; width: 100%; height: 2.6em; }
  .spark .area { fill: color-mix(in srgb, var(--tone, var(--board-c1)) 16%, transparent); }
  .spark .line, .trend .line { fill: none; stroke: var(--tone, var(--board-c1)); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .spark .goal, .trend .goal { stroke: var(--board-ok); stroke-width: 1.5; stroke-dasharray: 6 5; vector-effect: non-scaling-stroke; }
  .trend { display: block; width: 100%; height: auto; }
  .trend .dot { fill: var(--board-c1); }
  .trend .dot.ok { fill: var(--board-ok); }
  .trend .dot.bad { fill: var(--board-bad); }
  .trend text { fill: var(--board-muted); font-size: 13px; }
  .trend .value { fill: var(--board-text); font-weight: 700; }

  /* ── 完整版：自适应宽度，窄时单列。 ── */
  .full-view { max-width: 1120px; margin: 0 auto; padding: 24px clamp(16px, 4vw, 40px) 40px; font-size: 15px; }
  .full-view header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 18px; }
  .full-view h1 { margin: 0; font-size: clamp(20px, 2.6vw, 28px); }
  .full-view .sub { color: var(--board-muted); font-size: 14px; margin-top: 2px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .kpis .kpi { padding: 12px 16px; }
  .kpis .kpi b { font-size: 26px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
  section { border: 1px solid var(--board-line); border-radius: var(--board-radius); padding: 16px 18px; }
  section > * + * { margin-top: 12px; }
  h2 { margin: 0 0 10px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--board-line); }
  th { color: var(--board-muted); font-weight: 600; }
  td.num, th.num { text-align: right; }
</style>`

const TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>迭代 23 进度</title>
${STYLE}
</head>
<body>
  <!-- 卡片版：标题 + 状态，主组件（进度环），旁边两项指标；大卡多一条截止进度。 -->
  <section class="card-view" aria-label="看板摘要">
    <div class="card-head"><h1>迭代 23</h1><span class="badge warn">⚠ 有阻塞</span></div>
    <div class="card-body">
      <div class="main">
        <div class="ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="72 100"/></svg><div><b class="num">72%</b><span>已完成</span></div></div>
      </div>
      <div class="side">
        <div class="kpi"><span>剩余任务</span><b class="num">9</b></div>
        <div class="kpi"><span>阻塞</span><b class="num bad">2</b></div>
        <div class="meter only-l"><div><span>距截止</span><b class="num">3 天</b></div><i style="--v: 79%"></i></div>
      </div>
    </div>
  </section>

  <!-- 完整版：全部指标、阶段、走势、明细。 -->
  <main class="full-view">
    <header>
      <div><h1>迭代 23 进度</h1><div class="sub">10-20 ~ 10-31 · 最后更新 10-28 16:40</div></div>
      <span class="badge warn">⚠ 2 个阻塞</span>
    </header>
    <div class="kpis">
      <div class="kpi"><span>完成度</span><b class="num">72%</b></div>
      <div class="kpi"><span>剩余任务</span><b class="num">9</b></div>
      <div class="kpi"><span>阻塞</span><b class="num bad">2</b></div>
      <div class="kpi"><span>距截止</span><b class="num">3 天</b></div>
    </div>
    <div class="grid">
      <section><h2>阶段</h2>
        <ol class="steps"><li class="done"><span>设计</span></li><li class="done"><span>开发</span></li><li class="now"><span>联调</span></li><li><span>测试</span></li><li><span>发布</span></li></ol>
        <div class="meter"><div><span>时间已过</span><b class="num">79%</b></div><i style="--v: 79%"></i></div>
      </section>
      <section><h2>剩余任务（个）</h2>
        <svg class="trend" viewBox="0 0 400 180" role="img" aria-label="剩余任务走势">
          <line class="goal" x1="30" x2="360" y1="20" y2="150"/>
          <polyline class="line" points="30,20 96,38 162,62 228,92 294,104"/>
          <circle class="dot" cx="30" cy="20" r="4"/><circle class="dot" cx="96" cy="38" r="4"/><circle class="dot" cx="162" cy="62" r="4"/>
          <circle class="dot" cx="228" cy="92" r="4"/><circle class="dot bad" cx="294" cy="104" r="4"/>
          <text class="value" x="294" y="94" text-anchor="middle">9</text>
          <text x="30" y="172" text-anchor="middle">10-20</text><text x="162" y="172" text-anchor="middle">10-24</text>
          <text x="294" y="172" text-anchor="middle">10-28</text><text x="360" y="172" text-anchor="middle">10-31</text>
        </svg>
      </section>
      <section><h2>阻塞</h2>
        <ul class="list">
          <li class="bad"><span>支付回调在预发环境超时</span><b>2 天</b></li>
          <li class="bad"><span>设计稿缺退款页</span><b>1 天</b></li>
        </ul>
      </section>
      <section><h2>按人</h2>
        <div class="bars">
          <div class="bar"><span>王悦</span><i style="--v: 100%"></i><b class="num">11</b></div>
          <div class="bar"><span>陈立</span><i style="--v: 82%"></i><b class="num">9</b></div>
          <div class="bar"><span>赵一</span><i style="--v: 55%"></i><b class="num">6</b></div>
        </div>
      </section>
    </div>
  </main>
</body>
</html>`

/** 卡片里能用的组件：用途 + 一段能直接贴的 HTML（样式都在模板里）。 */
const COMPONENTS: readonly [string, string, string][] = [
  [
    '主数字 `.hero`',
    '一个数对目标、对上次：错误率、销售额、NPS、通过率。',
    '<div class="hero"><span>P99 延迟</span><b class="num">168 ms</b><small class="ok">↓ 86%，目标 200</small></div>',
  ],
  [
    '指标块 `.kpi`',
    '次要指标，一块一个；并排放进 `.row`。',
    '<div class="row"><div class="kpi"><span>吞吐</span><b class="num">2.4k</b></div><div class="kpi"><span>错误率</span><b class="num">0.04%</b></div></div>',
  ],
  [
    '进度环 `.ring`',
    '完成了多少：迭代完成度、覆盖率、预算用掉多少。`stroke-dasharray` 的第一个数就是百分比。',
    '<div class="ring ok"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="86 100"/></svg><div><b class="num">86%</b><span>覆盖率</span></div></div>',
  ],
  [
    '进度条 `.meter`',
    '一项对目标的进度；几条叠起来比较各项完成度。',
    '<div class="meter warn"><div><span>本月目标</span><b class="num">64%</b></div><i style="--v: 64%"></i></div>',
  ],
  [
    '对比条 `.bars`',
    '几项比大小、看构成：各地区、各严重级别、各渠道。`--v` 按最大那项算，最多五条。',
    '<div class="bars"><div class="bar bad"><span>严重</span><i style="--v: 40%"></i><b class="num">2</b></div><div class="bar warn"><span>高</span><i style="--v: 100%"></i><b class="num">5</b></div></div>',
  ],
  [
    '状态格 `.dots`',
    '一串结果：最近 30 次构建、30 天可用性、每日打卡。一格一个，`.ok` / `.warn` / `.bad` / `.none`。',
    '<div class="dots"><i></i><i></i><i class="bad"></i><i></i><i class="warn"></i><i class="none"></i></div>',
  ],
  [
    '阶段 `.steps`',
    '走到哪一步：发布流程、项目里程碑、审批。`.done` 做完、`.now` 当前。',
    '<ol class="steps"><li class="done"><span>设计</span></li><li class="now"><span>开发</span></li><li><span>测试</span></li><li><span>发布</span></li></ol>',
  ],
  [
    '短列表 `.list`',
    '要处理的事：阻塞、待审、告警，最多三条，右边一个短值。',
    '<ul class="list"><li class="bad"><span>支付回调超时</span><b>2 天</b></li><li class="warn"><span>缺退款页设计</span><b>1 天</b></li></ul>',
  ],
  [
    '迷你走势 `.spark`',
    '主数字的走势，放在它下面或旁边；`.goal` 是目标线。放在 `.main` 里时加 `.hide-s`，小卡放不下。',
    '<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="M0 30 L50 18 L100 6 L100 40 L0 40 Z"/><polyline class="line" points="0,30 50,18 100,6"/></svg>',
  ],
]

const COMPONENT_TABLE = COMPONENTS.map(
  ([name, use, html]) => `**${name}**：${use}\n\n\`\`\`html\n${html}\n\`\`\``,
).join('\n\n')

const CONTENT = `# 画布看板（workflow-lite）

看板是一个**自包含的 HTML 文件**，显示在画布的资源卡里；用户也会点开它（插件的查看框），或者在浏览器里单独打开。同一个文件要在三处都好看：

| 在哪 | 多大 | \`<html>\` 上 | 显示 |
|---|---|---|---|
| 画布卡片 | 小（任务描述里给了视口大小），**不能滚动** | \`${BOARD_ATTR}="card"\` | 卡片版 |
| 插件的查看框 | 大 | \`${BOARD_ATTR}="full"\` | 完整版 |
| 浏览器单独打开 | 任意宽 | 没有这个属性 | 完整版 |

看板不只是性能数据：迭代进度、代码审查、测试结果、安全扫描、销售、调研、运营、学习进度……都是同一套写法，按内容选组件。

## 先想清楚：这张卡回答什么问题

卡片是给人在画布上扫一眼的，**一张卡只回答一个问题**，先写下这句话，再挑组件：

| 问题 | 主组件 |
|---|---|
| 一个数到没到目标、比上次好还是差 | 主数字 \`.hero\`（旁边配迷你走势） |
| 完成了多少 | 进度环 \`.ring\` 或进度条 \`.meter\` |
| 谁多谁少、由什么构成 | 对比条 \`.bars\` |
| 最近一串结果怎么样 | 状态格 \`.dots\` |
| 走到哪一步了 | 阶段 \`.steps\` |
| 有哪些要处理 | 短列表 \`.list\` |

## 两版：卡片版 + 完整版

页面里写两段：\`.card-view\`（卡片版）和 \`.full-view\`（完整版），用 \`[${BOARD_ATTR}="card"]\` 切换（模板的样式照抄）。

**卡片版**结构固定：

\`\`\`html
<section class="card-view">
  <div class="card-head"><h1>短标题</h1><span class="badge">✓ 结论</span></div>
  <div class="card-body">
    <div class="main"><!-- 主组件，一个 --></div>
    <div class="side"><!-- 次要的，一两样；大卡才有的加 class="only-l" --></div>
  </div>
</section>
\`\`\`

- **正好铺满一屏**：不滚动、不截断、不留大块空白。字号跟着卡片大小走（\`.card-view\` 的 \`font-size\` 用视口单位，组件都按 em 排），用户拖大拖小卡片时一起缩放；字号下限不小于任务描述给的最小字号。
- **按卡片大小自动取舍**（模板里已经写好）：
  - 小卡（高 < 160 或宽 < 200）：只显示标题、徽标和 \`.main\`，\`.side\` 和 \`.hide-s\` 隐藏；
  - 中卡：\`.main\` + \`.side\`；
  - 大卡（宽 ≥ 420 且高 ≥ 260）：再显示 \`.only-l\`；
  - 接近方形或竖长：上下排。
- 所以**最要紧的放 \`.main\`**，次要的放 \`.side\`，锦上添花的标 \`.only-l\`；\`.main\` 里除了主组件的东西（主数字下面的迷你图）加 \`.hide-s\`。
- 标题短（十个字以内），徽标写结论（「✓ 已达标」「⚠ 观察中」「✗ 3 个阻塞」），不只靠颜色。
- 值写短：并排的指标块里一个值不超过 5 个字符（"8.2 分" 而不是 "8m12s"，"¥128 万" 而不是 "¥1,283,400"），放不下的单独占一行。
- 不放表格、段落、图例、超过三条的列表。

**完整版**放全部内容：指标、图表、明细，宽度自适应（窄时单列、宽时多列），可以滚动。组件在完整版里也能用（字号按完整版的 15px 排）。

两版说的是同一组数据，数字要一致。

## 组件

样式都在模板里，按下面的写法贴进去；色调加在组件上：\`.ok\` / \`.warn\` / \`.bad\`，系列色 \`.c2\` ~ \`.c6\`（不加是 \`--board-c1\`）。

${COMPONENT_TABLE}

## 主题：只用 \`--board-*\` 变量

插件把画布当前的主题写成下面这组 CSS 变量，设在 \`<html>\` 的内联样式上（比页面自己的 \`:root\` 优先），并设好 \`color-scheme\`；用户换主题时就地更新，不重载页面。

| 变量 | 用途 |
|---|---|
${TOKEN_TABLE}

- **颜色、圆角、字体全部从变量取**，不要写死别的颜色；要淡底就混出来：\`color-mix(in srgb, var(--board-accent) 14%, transparent)\`。
- 页面底色用 \`--board-bg\`（和卡片的展示区同色，看板和卡片融成一块），分区、指标块用 \`--board-surface\` 或一圈 \`--board-line\`。
- **在 \`:root\` 里写一份后备值**，亮暗两套用 \`prefers-color-scheme\` 切（模板里有现成的两套，照抄）：浏览器里单独打开时用它们。
- 圆角一律写 \`var(--board-radius)\`（有的主题是直角）；胶囊、圆点用 999px / 50%。

## 图表

- **首选内联 SVG**，颜色写在 CSS 里（SVG 的 \`fill=\` / \`stroke=\` 属性里不能用 \`var()\`，要写进 \`class\` 或 \`style\`），主题变了自动跟着变。
- 要交互的复杂图可以从 CDN 引入图表库（ECharts、Chart.js）：颜色用 \`getComputedStyle(document.documentElement).getPropertyValue('--board-c1')\` 读，并监听 \`window\` 上的 \`${BOARD_THEME_EVENT}\` 事件重画（插件换完主题会派发它）。只放在完整版里。
- 不要把 PNG 图贴进看板：图片不会跟着主题变色。

## 硬要求

- **一个自包含的文件**：样式、脚本、数据都写进页面；卡片里读不到相对路径的文件，图用内联 SVG 或 data URI。
- 图表库、字体可以从 CDN 引入。
- 不要读写 localStorage、cookie（卡片里会报错）。
- 不要把宽高写死成卡片的像素尺寸。

## 自检

写完对照：这张卡回答的那个问题，扫一眼能看出答案吗？卡片版在小、中、大三档下都正好一屏、没有截断？完整版在窄窗口（400 px）和宽窗口（1400 px）下都不挤、不空？页面里还有没有写死的颜色（\`#\`、\`rgb(\` 只该出现在 \`:root\` 的后备值里）？

## 模板

一张完整的看板（迭代进度）：换成你的问题、组件和数据；样式、两版切换、后备值照抄。

\`\`\`html
${TEMPLATE}
\`\`\`
`

export function registerBoardSkill(ctx: Context): () => void {
  return ctx.skills.register({
    name: BOARD_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: CONTENT,
  })
}

/** 测试与演示用：skill 正文、模板、模板的样式。 */
export const BOARD_SKILL_CONTENT = CONTENT
export const BOARD_TEMPLATE = TEMPLATE
export const BOARD_STYLE = STYLE
