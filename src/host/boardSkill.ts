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
    bg: '#fafbfd',
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
    c2: '#0f7f8a',
    c3: '#6b5bd2',
    c4: '#c2367a',
    c5: '#5f7a12',
    c6: '#5c6475',
    radius: '10px',
    font: FONT,
    mono: MONO,
  },
  dark: {
    bg: '#1b2029',
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
    c2: '#55d2dd',
    c3: '#a99cf5',
    c4: '#f58cbd',
    c5: '#b4d65a',
    c6: '#a3aab8',
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
  '写一张在 workflow-lite 画布上展示的看板（HTML）：先定这张卡回答的问题再挑组件，卡片版 + 完整版两套版式，跟着画布主题变色的 --board-* 变量，附一份样式、脚本能照抄的模板。'

const WHEN_TO_USE =
  '任务描述的「画布展示」里说这个文件是一张看板、让你加载 workflow-board 时。只写看板 HTML 时用；图片、报告、普通网页不用读。'

const TOKEN_TABLE = BOARD_TOKENS.map(([token, use]) => `| \`${boardVar(token)}\` | ${use} |`).join(
  '\n',
)

/**
 * 卡片版的字号（画布像素）：和画布上的步骤卡片一套——标题 = 步骤卡片的标题（`--wl-fs-body`），
 * 正文、标签 = 步骤卡片的说明（`--wl-fs-meta`），指标值大一档。画布的字号是定值，不随主题变，所以写死在模板里，
 * 不注入；`tests/host/boardSkill.spec.ts` 对着 `shell.module.css` 查，改画布字号时一起改。
 */
export const BOARD_CARD_FONT = { title: 13, body: 12, value: 15 } as const

const em = (px: number): string => `${Number((px / BOARD_CARD_FONT.body).toFixed(4))}em`

/**
 * 模板的样式：后备值、两版切换、卡片版的版式、组件、完整版的网格。组件按 em 排，跟着所在那一版的字号走；
 * 完整版的元素样式都限在 `.full-view` 下，漏不到卡片版。
 */
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
  /* 派生量：标签字号（不小于 12px）、条的轨道、胶囊圆角（直角主题下是直角）。 */
  :root { --fs-label: max(.85em, 12px); --track: color-mix(in srgb, var(--board-text) 9%, transparent); --pill: calc(var(--board-radius) * 99); }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: var(--board-bg); color: var(--board-text); font-family: var(--board-font); line-height: 1.4; -webkit-font-smoothing: antialiased; }
  .num { font-variant-numeric: tabular-nums; }
  .u { margin-left: .12em; font-size: max(.62em, 11px); font-weight: 600; letter-spacing: 0; color: var(--board-muted); }

  /* 色调：文字变色，组件（条、环、格、线）取 --tone。状态色只表示好坏，系列色只分类别。 */
  .ok { color: var(--board-ok); --tone: var(--board-ok); }
  .warn { color: var(--board-warn); --tone: var(--board-warn); }
  .bad { color: var(--board-bad); --tone: var(--board-bad); }
  .c1 { --tone: var(--board-c1); } .c2 { --tone: var(--board-c2); } .c3 { --tone: var(--board-c3); }
  .c4 { --tone: var(--board-c4); } .c5 { --tone: var(--board-c5); } .c6 { --tone: var(--board-c6); }
  .mute { --tone: color-mix(in srgb, var(--board-text) 22%, var(--board-surface)); }
  .badge, .delta, .tag { display: inline-flex; align-items: center; gap: .25em; border-radius: var(--pill); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .badge { padding: .15em .65em; color: var(--tone, var(--board-ok)); background: color-mix(in srgb, var(--tone, var(--board-ok)) 14%, transparent); }
  .delta, .tag { padding: .05em .5em; font-size: var(--fs-label); color: var(--tone, var(--board-muted)); background: color-mix(in srgb, var(--tone, var(--board-muted)) 13%, transparent); }
  .badge.info, .tag.info { --tone: var(--board-accent); }

  /* 两版：画布卡片里只显示卡片版，其余（查看框、浏览器）只显示完整版。 */
  .card-view { display: none; }
  [${BOARD_ATTR}="card"] .card-view { display: grid; }
  [${BOARD_ATTR}="card"] .full-view { display: none; }
  [${BOARD_ATTR}="card"], [${BOARD_ATTR}="card"] body { height: 100%; overflow: hidden; }

  /* ── 卡片版：正好一屏。字号和画布上的步骤卡片一套（标题 ${BOARD_CARD_FONT.title}、正文 ${BOARD_CARD_FONT.body}、指标值 ${BOARD_CARD_FONT.value}），
     只有主数字随卡片变大；卡片大了多放内容。从上往下排，不垂直居中（居中会在上下各空一截）。
     放不下时末尾的脚本按 data-drop 收起次要项，再缩主数字。卡片按缩放显示时，任务描述会让你在 .card-view 上写 --k，把字乘回来。 ── */
  .card-view { height: 100vh; padding: ${em(10)} ${em(12)} ${em(12)}; gap: ${em(10)}; grid-template-rows: auto minmax(0, 1fr); line-height: 1.35;
               font-size: calc(${BOARD_CARD_FONT.body}px * var(--k, 1)); }
  /* 卡片自己有标题行，这里的标题是「看的是哪一期」，压成一行淡字，结论放在右边的徽标里。 */
  .card-head { display: flex; align-items: center; justify-content: space-between; gap: .6em; min-width: 0; min-height: 1.6em; }
  .card-head h1 { margin: 0; font-size: 1em; font-weight: 600; color: var(--board-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-head .badge { flex: none; padding: .1em .55em; font-weight: 650; }
  .card-view .hero > b { font-size: clamp(${em(22)}, 15cqi, ${em(32)}); }
  .card-view .kpi > b { font-size: ${em(BOARD_CARD_FONT.value)}; }
  .card-view .row { gap: ${em(16)}; }
  /* 默认单栏，主上次下；横着的卡左右两栏（主栏是进度环时按环宽）。 */
  .card-body { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto; align-content: start; gap: ${em(12)} ${em(18)}; min-height: 0; }
  @media (min-aspect-ratio: 5/4) and (min-width: 200px) and (min-height: 160px) {
    .card-body { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
    /* 主栏是进度环：主栏就是环那么宽（主栏是尺寸容器，按内容取宽会量成 0，所以直接写环的直径）。 */
    .card-body:has(> .main > .ring) { grid-template-columns: min(calc(100vh - ${em(54)}), 7.5em) minmax(0, 1fr); }
  }
  .main { display: flex; flex-direction: column; gap: ${em(8)}; min-width: 0; min-height: 0; container-type: inline-size; }
  .side { display: grid; align-content: start; gap: ${em(10)}; min-width: 0; min-height: 0; }
  /* 主栏里的迷你走势吃掉剩下的高度。 */
  .main > .spark { flex: 1 1 0; height: auto; min-height: 1.8em; max-height: 5em; }
  /* 环的直径 = 主体的高（卡高减去标题行和内距），再大也不超过 --ring。 */
  .card-view .ring { --ring: 7.5em; width: min(calc(100vh - ${em(54)}), var(--ring)); }
  /* 竖长：主、次上下排开，环居中。 */
  @media (max-aspect-ratio: 5/4) {
    .card-body { gap: ${em(14)}; }
    .card-view .ring { --ring: 8em; margin-inline: auto; }
  }
  /* 小卡（矮或很窄）：只留标题和主组件，排得紧一些；进度条改成一行（标签 | 条 | 值）。 */
  @media (max-width: 199.98px), (max-height: 159.98px) {
    .card-view { padding: ${em(8)} ${em(12)} ${em(10)}; gap: ${em(6)}; line-height: 1.2; }
    .card-view .ring { --ring: 5em; margin-inline: 0; }
    .card-body { grid-template-rows: minmax(0, 1fr); }
    .card-view .side, .card-view .hide-s { display: none; }
    .card-view .bars { row-gap: .25em; }
    .card-view .main:has(> .meter) { display: grid; grid-template-columns: minmax(0, max-content) minmax(2em, 1fr) max-content; gap: .45em .5em; align-content: start; }
    .card-view .main:has(> .meter) > * { grid-column: 1 / -1; }
    .card-view .main > .meter { grid-template-columns: subgrid; align-items: center; }
    .card-view .main > .meter > div { display: contents; }
    .card-view .main > .meter > div > span { grid-column: 1; grid-row: 1; }
    .card-view .main > .meter > div > b { grid-column: 3; grid-row: 1; }
    .card-view .main > .meter > i, .card-view .main > .meter > .ci { grid-column: 2; grid-row: 1; }
  }
  /* 大卡才有的：.only-l。 */
  @media (max-width: 419.98px), (max-height: 259.98px) { .card-view .only-l { display: none; } }
  @media (min-width: 420px) and (min-height: 260px) { .main > .spark { max-height: 6.5em; } }

  /* ── 组件（两版都能用） ── */
  .label, .hero > span, .kpi > span, .ring span, .meter > div > span, .bar > span { color: var(--board-muted); font-size: var(--fs-label); }

  /* 主数字：字号按主栏宽度定（cqi），卡越大数越大；还放不下时末尾的脚本再缩。 */
  .hero { display: flex; flex-direction: column; gap: .15em; min-width: 0; }
  .hero > b { font-size: min(3em, 30cqi); line-height: 1; font-weight: 750; letter-spacing: -.02em; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .hero > small { font-size: var(--fs-label); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hero > small:not([class]), .kpi > small:not([class]) { color: var(--board-muted); }

  /* 指标块：上面标签、下面值，不垫底色（完整版的指标带里左边加一道细线）。值放不下时末尾的脚本把它缩到放得下。 */
  .kpi { container-type: inline-size; display: grid; gap: .1em; min-width: 0; }
  .kpi > span, .kpi > small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kpi > b { display: block; font-size: 1.4em; line-height: 1.2; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .kpi > small { font-size: var(--fs-label); font-weight: 600; }
  .row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: .6em; }

  /* 进度环：pathLength=100，stroke-dasharray 的第一个数就是百分比。 */
  /* 环的大小跟着卡片高度走（去掉标题行和内距），再大也不超过 --ring（卡片里按卡片形状定，完整版 9em）。 */
  .ring { position: relative; flex: none; display: grid; place-items: center; width: min(100%, calc(100vh - 5em), var(--ring, 9em)); container-type: inline-size; aspect-ratio: 1; margin: 0 auto; text-align: center; }
  .ring svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring circle { fill: none; stroke-width: 3.4; }
  .ring .track { stroke: var(--track); }
  .ring .arc { stroke: var(--tone, var(--board-c1)); stroke-linecap: round; }
  .ring b { display: block; font-size: min(1.55em, 26cqi); line-height: 1.05; font-weight: 750; letter-spacing: -.02em; }
  .ring span { font-size: min(var(--fs-label), 14cqi); }
  .card-view .ring b { font-size: min(${em(16)}, 24cqi); }

  /* 指标行：几个次要的数，一行一个（标签在左、值在右），行间一道淡线。卡片的 .side 里首选它。 */
  .stats { display: grid; margin: -.45em 0; min-width: 0; }
  .stats > div { display: flex; justify-content: space-between; align-items: baseline; gap: .6em; min-width: 0; padding: .45em 0; }
  .stats > div + div { border-top: 1px solid color-mix(in srgb, var(--board-line) 55%, transparent); }
  .stats dt { min-width: 0; overflow: hidden; color: var(--board-muted); font-size: var(--fs-label); text-overflow: ellipsis; white-space: nowrap; }
  .stats dd { flex: none; margin: 0; font-size: ${em(BOARD_CARD_FONT.title)}; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .full-view .stats dd { font-size: 1em; }

  /* 进度条、对比条的条：--v 实际、--f 预测（淡色）、--goal 目标刻度，都是同一把尺子上的百分比。 */
  .meter > i, .bar > i { position: relative; display: block; height: .55em; border-radius: var(--pill); background: var(--track); }
  .meter > i::before, .bar > i::before { content: ""; position: absolute; inset: 0 auto 0 0; width: min(max(var(--v, 0%), 3px), 100%); border-radius: inherit; background: var(--tone, var(--board-c1)); }
  .meter > i[style*="--f"], .bar > i[style*="--f"] { background: linear-gradient(color-mix(in srgb, var(--tone, var(--board-c1)) 32%, transparent) 0 0) no-repeat 0 0 / var(--f) 100%, var(--track); }
  /* 刻度上下各伸出 .25em，条也上下各让出 .25em，不撑出容器（放不放得下按容器量）。 */
  .meter > i[style*="--goal"], .bar > i[style*="--goal"] { margin-block: .25em; }
  .meter > i[style*="--goal"]::after, .bar > i[style*="--goal"]::after { content: ""; position: absolute; top: -.25em; bottom: -.25em; left: var(--goal); width: 2px; margin-left: -1px; background: var(--board-text); }

  /* 进度条：一项一条，上面一行标签和值。 */
  .meter { display: grid; gap: .3em; min-width: 0; }
  .meter > div { display: flex; justify-content: space-between; align-items: baseline; gap: .5em; min-width: 0; }
  .meter > div > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meter > div > b { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* 对比条：几条共用一套列，标签、条、值上下对齐。漏斗多一列「比上一步」。 */
  .bars { display: grid; grid-template-columns: minmax(0, max-content) minmax(2em, 1fr) max-content; align-items: center; gap: .4em .6em; min-width: 0; }
  .bars.funnel { grid-template-columns: minmax(0, max-content) minmax(2em, 1fr) max-content max-content; }
  .bar { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; min-width: 0; }
  .bar > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar > b { font-weight: 700; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bar > em { font-style: normal; color: var(--board-subtle); font-size: var(--fs-label); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* 构成条：一条按份额切开，--n 是份额（按比例分，不用凑 100）。 */
  .stack { display: flex; gap: 2px; height: .75em; border-radius: var(--pill); overflow: hidden; }
  .stack > i { flex: var(--n, 1) 1 0; min-width: 3px; background: var(--tone, var(--board-c1)); }
  .legend { display: flex; flex-wrap: wrap; gap: .2em .9em; font-size: var(--fs-label); }
  .legend > span { display: inline-flex; align-items: center; gap: .35em; white-space: nowrap; color: var(--board-muted); }
  .legend > span::before { content: ""; width: .65em; height: .65em; border-radius: calc(var(--board-radius) * .2); background: var(--tone, var(--board-c1)); }
  .legend b { color: var(--board-text); font-weight: 700; font-variant-numeric: tabular-nums; }

  /* 区间：放在 .meter 里代替条。--lo / --hi 区间，--at 估计值，--zero 零线，都是轴上的百分比。 */
  .ci { position: relative; display: block; height: 1.1em; }
  .ci::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: var(--board-line); }
  .ci::after { content: ""; position: absolute; top: 0; bottom: 0; left: var(--zero, 50%); width: 1px; background: var(--board-muted); }
  .ci > i { position: absolute; top: 50%; left: var(--lo); right: calc(100% - var(--hi)); height: .5em; transform: translateY(-50%); border-radius: var(--pill); background: color-mix(in srgb, var(--tone, var(--board-c1)) 38%, transparent); }
  .ci > b { position: absolute; top: 50%; left: var(--at); width: .75em; height: .75em; transform: translate(-50%, -50%); border-radius: 50%; background: var(--tone, var(--board-c1)); box-shadow: 0 0 0 2px var(--board-bg); }

  /* 状态格：一格一个结果。不加类是正常（淡），只把异常标 .warn / .bad；--cols 定每行几格。 */
  .dots { display: grid; grid-template-columns: repeat(var(--cols, 10), minmax(0, 1fr)); gap: .22em; width: min(100%, calc(var(--cols, 10) * 1.6em)); }
  .dots > i { aspect-ratio: 1; border-radius: calc(var(--board-radius) * .25); background: var(--tone, color-mix(in srgb, var(--board-ok) 40%, var(--board-surface))); }
  .dots > i.none { background: var(--track); }
  .axis { display: flex; justify-content: space-between; gap: .5em; color: var(--board-subtle); font-size: var(--fs-label); font-variant-numeric: tabular-nums; }

  /* 阶段：走到哪一步。 */
  .steps { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 0; padding: 0; list-style: none; }
  .steps li { position: relative; display: grid; justify-items: center; gap: .3em; color: var(--board-muted); font-size: var(--fs-label); }
  .steps li span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .steps li::before { content: ""; position: relative; z-index: 1; width: .9em; height: .9em; border-radius: 50%; border: 2px solid var(--board-line); background: var(--board-bg); }
  .steps li::after { content: ""; position: absolute; top: .45em; left: 50%; width: 100%; height: 2px; background: var(--board-line); transform: translateY(-50%); }
  .steps li:last-child::after { display: none; }
  .steps li.done::before { border-color: var(--board-ok); background: var(--board-ok); }
  .steps li.done::after { background: var(--board-ok); }
  .steps li.now { color: var(--board-text); font-weight: 700; }
  .steps li.now::before { border-color: var(--board-accent); background: color-mix(in srgb, var(--board-accent) 30%, var(--board-bg)); }

  /* 短列表：要处理的几件事。卡片里一行一条，完整版里长句换行。 */
  .list { display: grid; gap: .35em; margin: 0; padding: 0; list-style: none; min-width: 0; }
  .list > li { display: grid; grid-template-columns: .5em minmax(0, 1fr) max-content; align-items: center; gap: .5em; }
  .list > li::before { content: ""; width: .5em; height: .5em; border-radius: 50%; background: var(--tone, var(--board-subtle)); }
  .list > li > span { color: var(--board-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list > li > b { color: var(--tone, var(--board-muted)); font-size: var(--fs-label); font-weight: 700; white-space: nowrap; }
  .full-view .list > li > span { white-space: normal; }

  /* 迷你走势（data-values）、走势图（.chart）：末尾的脚本按数据画；线不随拉伸变粗，图上的字按像素排。 */
  .spark { display: block; width: 100%; height: 2.6em; overflow: visible; }
  .spark .area, .chart .area { fill: color-mix(in srgb, var(--tone, var(--board-c1)) 12%, transparent); }
  .chart .area { fill: color-mix(in srgb, var(--tone, var(--board-c1)) 8%, transparent); }
  .spark .line, .chart .line { fill: none; stroke: var(--tone, var(--board-c1)); stroke-width: 2.25; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .spark .goal, .chart .goal { stroke: var(--board-muted); stroke-width: 1.25; stroke-dasharray: 5 4; vector-effect: non-scaling-stroke; }
  .chart { display: block; margin: 0; height: 200px; }
  .chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .chart text { fill: var(--board-subtle); font-size: 12px; font-variant-numeric: tabular-nums; }
  .chart .rule { stroke: var(--board-line); }
  .chart .rule.zero { stroke: var(--board-muted); }
  .chart .goal-text { fill: var(--board-muted); }
  .chart .end { fill: var(--board-text); font-size: 13px; font-weight: 700; }
  .chart .compare { fill: none; stroke: var(--board-subtle); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .chart .dot { fill: var(--tone, var(--board-c1)); stroke: var(--board-bg); stroke-width: 2; }
  .chart .col { fill: color-mix(in srgb, var(--tone, var(--board-c1)) 45%, transparent); }
  .chart .col.last { fill: var(--tone, var(--board-c1)); }

  /* ── 完整版：12 列网格，分区用 .w4 / .w6（默认）/ .w8 / .w12，每行加起来 12；窄时单列。 ── */
  .full-view { container-type: inline-size; max-width: 1120px; margin: 0 auto; padding: 28px clamp(16px, 4vw, 40px) 48px; font-size: 15px; line-height: 1.5; }
  .full-view > header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 16px; margin-bottom: 20px; }
  .full-view h1 { margin: 0; font-size: clamp(22px, 2.6vw, 28px); line-height: 1.25; font-weight: 750; letter-spacing: -.01em; }
  .full-view .sub { margin-top: 4px; color: var(--board-muted); font-size: 14px; }
  .full-view .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px 24px; margin-bottom: 20px; padding: 16px 0; border-block: 1px solid var(--board-line); }
  .full-view .kpi { padding: .05em 0 .05em .6em; border-left: 2px solid var(--board-line); }
  .full-view .kpis .kpi > b { font-size: 28px; }
  .full-view .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
  .full-view .grid > * { grid-column: span 6; min-width: 0; }
  .full-view .grid > .w4 { grid-column: span 4; }
  .full-view .grid > .w8 { grid-column: span 8; }
  .full-view .grid > .w12 { grid-column: 1 / -1; }
  @container (max-width: 759.98px) { .full-view .grid > * { grid-column: 1 / -1; } }
  .full-view section { padding: 16px 18px 18px; border: 1px solid var(--board-line); border-radius: var(--board-radius); }
  .full-view section > h2 { margin: 0; font-size: 14px; font-weight: 650; }
  .full-view section > * + * { margin-top: 14px; }
  .full-view .note { color: var(--board-muted); font-size: 14px; }
  .table { overflow-x: auto; }
  .full-view table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .full-view th { padding: 0 10px 8px; border-bottom: 1px solid var(--board-line); color: var(--board-subtle); font-size: 12.5px; font-weight: 600; text-align: left; white-space: nowrap; }
  .full-view td { padding: 9px 10px; border-bottom: 1px solid color-mix(in srgb, var(--board-line) 55%, transparent); vertical-align: top; }
  .full-view th:first-child, .full-view td:first-child { padding-left: 0; }
  .full-view th:last-child, .full-view td:last-child { padding-right: 0; }
  .full-view tbody tr:last-child td { border-bottom: 0; }
  .full-view th.num, .full-view td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>`

/**
 * 模板末尾的脚本：卡片版放不下时按 `data-drop` 收起次要项、再缩主数字（正文字号不动）；按 `data-*` 画迷你走势和走势图
 * （图按像素画，字不随宽度缩放）；浏览器里地址加 `#card` 看卡片版。
 * 写在模板字符串里：不用反引号、`${`、反斜杠。
 */
const SCRIPT = `<script>
/* 照抄：卡片版放不下时收起 data-drop、缩主数字；按 data-* 画 .spark 和 .chart；浏览器里地址加 #card 看卡片版。 */
(() => {
  const root = document.documentElement
  if (!root.hasAttribute('${BOARD_ATTR}') && location.hash === '#card') root.setAttribute('${BOARD_ATTR}', 'card')
  const NS = 'http://www.w3.org/2000/svg'
  const list = (s) => (s || '').split(',').map((v) => v.trim()).filter((v) => v !== '')
  const nums = (s) => list(s).map(Number)
  const fmt = (n) => String(Math.round(n * 1000) / 1000)
  const add = (parent, tag, attrs, text) => {
    const node = document.createElementNS(NS, tag)
    for (const k in attrs) node.setAttribute(k, attrs[k])
    if (text !== undefined) node.textContent = text
    parent.appendChild(node)
    return node
  }

  function spark(svg) {
    const v = nums(svg.dataset.values)
    if (v.length === 0) return
    const goal = svg.dataset.goal === undefined ? null : Number(svg.dataset.goal)
    const all = goal === null ? v : v.concat(goal)
    const lo = svg.dataset.min === undefined ? Math.min(...all) : Number(svg.dataset.min)
    const hi = Math.max(...all)
    const y = (n) => (4 + (1 - (n - lo) / (hi - lo || 1)) * 32).toFixed(2)
    const pts = v.map((n, i) => ((i / Math.max(v.length - 1, 1)) * 100).toFixed(2) + ',' + y(n))
    svg.setAttribute('viewBox', '0 0 100 40')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('aria-hidden', 'true')
    svg.replaceChildren()
    add(svg, 'path', { class: 'area', d: 'M' + pts.join(' L') + ' L100,40 L0,40 Z' })
    if (goal !== null) add(svg, 'line', { class: 'goal', x1: 0, x2: 100, y1: y(goal), y2: y(goal) })
    add(svg, 'polyline', { class: 'line', points: pts.join(' ') })
  }

  function chart(fig) {
    const W = fig.clientWidth
    const H = fig.clientHeight
    const v = nums(fig.dataset.values)
    if (W === 0 || H === 0 || v.length === 0) return
    const cmp = nums(fig.dataset.compare)
    const labels = list(fig.dataset.labels)
    const bars = fig.dataset.kind === 'bar'
    const unit = fig.dataset.unit || ''
    const goal = fig.dataset.goal === undefined ? null : Number(fig.dataset.goal)
    const all = v.concat(cmp, goal === null ? [] : [goal])
    let lo = fig.dataset.min === 'auto' ? Math.min(...all) : fig.dataset.min === undefined ? Math.min(0, ...all) : Number(fig.dataset.min)
    let hi = Math.max(...all)
    if (hi === lo) hi = lo + 1
    const raw = (hi - lo) / 4
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.999)
    lo = Math.floor(lo / step + 1e-9) * step
    hi = Math.ceil(hi / step - 1e-9) * step
    const ticks = []
    for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t)
    const left = 12 + Math.max(...ticks.map((t) => fmt(t).length)) * 7
    const right = 14
    const top = 22
    const bottom = 26
    const iw = W - left - right
    const ih = H - top - bottom
    const x = (i) => left + (bars ? ((i + 0.5) * iw) / v.length : v.length === 1 ? iw / 2 : (i * iw) / (v.length - 1))
    const y = (n) => top + (1 - (n - lo) / (hi - lo)) * ih
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    svg.setAttribute('aria-hidden', 'true')
    for (const t of ticks) {
      add(svg, 'line', { class: Math.abs(t) < step / 1e6 ? 'rule zero' : 'rule', x1: left, x2: W - right, y1: y(t), y2: y(t) })
      add(svg, 'text', { x: left - 8, y: y(t) + 4, 'text-anchor': 'end' }, fmt(t))
    }
    const every = Math.max(1, Math.ceil((labels.length * 64) / iw))
    const shown = labels.map((_, i) => i).filter((i) => i % every === 0)
    const end = labels.length - 1
    if (end > 0 && shown[shown.length - 1] !== end) {
      if (end - shown[shown.length - 1] < every * 0.6) shown.pop()
      shown.push(end)
    }
    for (const i of shown) {
      const anchor = bars ? 'middle' : i === 0 ? 'start' : i === end ? 'end' : 'middle'
      add(svg, 'text', { x: x(i), y: H - 6, 'text-anchor': anchor }, labels[i])
    }
    if (goal !== null) {
      add(svg, 'line', { class: 'goal', x1: left, x2: W - right, y1: y(goal), y2: y(goal) })
      add(svg, 'text', { class: 'goal-text', x: left + 6, y: y(goal) - 6 }, (fig.dataset.goalLabel || '目标') + ' ' + fmt(goal) + unit)
    }
    if (cmp.length > 0) add(svg, 'polyline', { class: 'compare', points: cmp.map((n, i) => x(i) + ',' + y(n)).join(' ') })
    const last = v.length - 1
    if (bars) {
      const bw = Math.min(40, (iw / v.length) * 0.62)
      const base = y(Math.min(Math.max(0, lo), hi))
      v.forEach((n, i) => add(svg, 'rect', { class: i === last ? 'col last' : 'col', x: x(i) - bw / 2, y: Math.min(y(n), base), width: bw, height: Math.abs(base - y(n)) }))
    } else {
      const pts = v.map((n, i) => x(i) + ',' + y(n))
      add(svg, 'path', { class: 'area', d: 'M' + pts.join(' L') + ' L' + x(last) + ',' + y(lo) + ' L' + x(0) + ',' + y(lo) + ' Z' })
      add(svg, 'polyline', { class: 'line', points: pts.join(' ') })
      add(svg, 'circle', { class: 'dot', cx: x(last), cy: y(v[last]), r: 4 })
    }
    add(svg, 'text', { class: 'end', x: x(last), y: y(v[last]) - 10, 'text-anchor': bars ? 'middle' : 'end' }, fmt(v[last]) + unit)
    fig.replaceChildren(svg)
  }

  // 一行字放不放得下：量文字本身的宽（带小数），scrollWidth 取整会漏掉差不到 1px 的截断。
  const range = document.createRange()
  const clipped = (node) => {
    range.selectNodeContents(node)
    return range.getBoundingClientRect().width > node.getBoundingClientRect().width + 0.25
  }

  function fit() {
    const card = document.querySelector('.card-view')
    if (card === null || root.getAttribute('${BOARD_ATTR}') !== 'card') return
    for (const node of card.querySelectorAll('.hero > b, .ring b, .kpi > b')) node.style.fontSize = ''
    const drops = [...card.querySelectorAll('[data-drop]')].sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop))
    for (const node of drops) node.style.display = ''
    const boxes = [card, ...card.querySelectorAll('.card-body, .main, .side')]
    const over = () => boxes.some((e) => e.scrollHeight > e.clientHeight + 1)
    // 正文字号不动（和步骤卡片一套）。放不下时先按 data-drop 收起次要项，再把主数字、环里的数缩到七成。
    for (const node of drops) {
      if (!over()) break
      node.style.display = 'none'
    }
    const big = [...card.querySelectorAll('.hero > b, .ring b')].map((node) => [node, parseFloat(getComputedStyle(node).fontSize)])
    for (let f = 0.95; over() && f >= 0.7; f -= 0.05) for (const [node, px] of big) node.style.fontSize = px * f + 'px'
    // 主数字、指标值一行放不下时单独缩。
    for (const node of card.querySelectorAll('.hero > b, .kpi > b')) {
      let px = parseFloat(getComputedStyle(node).fontSize)
      while (clipped(node) && px > ${BOARD_CARD_FONT.body}) {
        px -= 1
        node.style.fontSize = px + 'px'
      }
    }
  }

  document.querySelectorAll('svg.spark[data-values]').forEach(spark)
  const charts = new ResizeObserver((entries) => entries.forEach((e) => chart(e.target)))
  document.querySelectorAll('figure.chart').forEach((fig) => charts.observe(fig))
  new ResizeObserver(() => requestAnimationFrame(fit)).observe(root)
  if (document.fonts) document.fonts.ready.then(fit)
})()
</script>`

const TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>迭代 23 进度</title>
${STYLE}
</head>
<body>
  <!-- 卡片版：回答「迭代按时做得完吗」。主组件是进度环，旁边一组指标行和一条进度条；放不下时先收起 data-drop="1"，再收 "2"。 -->
  <section class="card-view" aria-label="看板摘要">
    <div class="card-head"><h1>迭代 23</h1><span class="badge warn">⚠ 落后 8%</span></div>
    <div class="card-body">
      <div class="main">
        <div class="ring warn"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="72 100"/></svg><div><b class="num">72%</b><span>已完成</span></div></div>
      </div>
      <div class="side">
        <dl class="stats">
          <div><dt>剩余</dt><dd class="num">9<span class="u">项</span></dd></div>
          <div><dt>阻塞</dt><dd class="num bad">2</dd></div>
          <div data-drop="1"><dt>距截止</dt><dd class="num">2<span class="u">天</span></dd></div>
        </dl>
        <div class="meter mute" data-drop="2"><div><span>时间已过</span><b class="num">80%</b></div><i style="--v: 80%"></i></div>
      </div>
    </div>
  </section>

  <!-- 完整版：全部指标、走势、明细。网格每行加起来 12：8 + 4、6 + 6、12。 -->
  <main class="full-view">
    <header>
      <div><h1>迭代 23 进度</h1><div class="sub">10-20 ~ 10-30 · 最后更新 10-28 16:40</div></div>
      <span class="badge warn">⚠ 落后 8%，2 个阻塞</span>
    </header>
    <div class="kpis">
      <div class="kpi"><span>完成度</span><b class="num warn">72%</b><small>时间已过 80%</small></div>
      <div class="kpi"><span>剩余任务</span><b class="num">9<span class="u">项</span></b><small class="ok">↓ 3 较昨天</small></div>
      <div class="kpi"><span>阻塞</span><b class="num bad">2</b><small>最久 2 天</small></div>
      <div class="kpi"><span>距截止</span><b class="num">2<span class="u">天</span></b><small>10-30 发布</small></div>
    </div>
    <div class="grid">
      <section class="w8"><h2>剩余任务（项）</h2>
        <figure class="chart warn" role="img" aria-label="剩余任务走势，虚线是理想进度"
          data-labels="10-20,10-21,10-22,10-23,10-24,10-25,10-26,10-27,10-28"
          data-values="32,31,28,27,23,20,17,12,9" data-compare="32,28.8,25.6,22.4,19.2,16,12.8,9.6,6.4" data-unit=" 项"></figure>
        <p class="note">虚线是按天均匀完成的理想进度，现在比它多 2.6 项。</p>
      </section>
      <section class="w4"><h2>阻塞</h2>
        <ul class="list">
          <li class="bad"><span>支付回调在预发环境超时，等网关组排查</span><b>2 天</b></li>
          <li class="bad"><span>设计稿缺退款页</span><b>1 天</b></li>
        </ul>
      </section>
      <section><h2>阶段</h2>
        <ol class="steps"><li class="done"><span>设计</span></li><li class="done"><span>开发</span></li><li class="now"><span>联调</span></li><li><span>测试</span></li><li><span>发布</span></li></ol>
        <div class="meter warn"><div><span>完成度（刻度是时间进度）</span><b class="num">72%</b></div><i style="--v: 72%; --goal: 80%"></i></div>
      </section>
      <section><h2>按人（剩余）</h2>
        <div class="bars">
          <div class="bar"><span>王悦</span><i style="--v: 100%"></i><b class="num">4</b></div>
          <div class="bar"><span>陈立</span><i style="--v: 75%"></i><b class="num">3</b></div>
          <div class="bar"><span>赵一</span><i style="--v: 50%"></i><b class="num">2</b></div>
        </div>
      </section>
      <section class="w12"><h2>剩余任务</h2>
        <div class="table"><table>
          <thead><tr><th>任务</th><th>负责人</th><th>状态</th><th class="num">估时</th></tr></thead>
          <tbody>
            <tr><td>支付回调接入新网关</td><td>王悦</td><td><span class="tag bad">阻塞</span></td><td class="num">2 天</td></tr>
            <tr><td>退款页</td><td>陈立</td><td><span class="tag bad">阻塞</span></td><td class="num">1.5 天</td></tr>
            <tr><td>对账报表导出</td><td>赵一</td><td><span class="tag info">进行中</span></td><td class="num">1 天</td></tr>
            <tr><td>回归测试</td><td>王悦</td><td><span class="tag">未开始</span></td><td class="num">1 天</td></tr>
          </tbody>
        </table></div>
      </section>
    </div>
  </main>
${SCRIPT}
</body>
</html>`

/** 能用的组件：用途 + 一段能直接贴的 HTML（样式都在模板里）。 */
const COMPONENTS: readonly [string, string, string][] = [
  [
    '主数字 `.hero`',
    '一个数对目标、对上次：错误率、销售额、NPS。放用户要据此行动的那个数，不一定是最大的那个。单位写进 `.u`；下面一行写对比，十个字以内。',
    '<div class="hero"><span>P99 延迟</span><b class="num">168<span class="u">ms</span></b><small class="ok">↓ 86%，目标 200</small></div>',
  ],
  [
    '指标行 `.stats`',
    '几个次要的数，一行一个：标签在左、值在右，行间一道淡线。卡片的 `.side` 里首选它（三四行正好和主组件一样高）；可舍的行标 `data-drop`。标签六个字以内，值八个字符以内。',
    '<dl class="stats"><div><dt>剩余</dt><dd class="num">9<span class="u">项</span></dd></div><div><dt>阻塞</dt><dd class="num bad">2</dd></div><div data-drop="1"><dt>距截止</dt><dd class="num">2<span class="u">天</span></dd></div></dl>',
  ],
  [
    '指标块 `.kpi`',
    '标签在上、值在下的指标，一块一个；并排放进 `.row`（最多三块）。完整版的 `.kpis` 指标带用它；卡片里用在竖长卡或 `.main` 里。标签四个字以内，值五个字符以内（不算 `.u` 里的单位）；可以加一行 `<small>` 写对比。',
    '<div class="row"><div class="kpi"><span>吞吐</span><b class="num">2.4<span class="u">k/s</span></b></div><div class="kpi"><span>错误率</span><b class="num">0.04%</b><small class="ok">↓ 0.02</small></div></div>',
  ],
  [
    '进度环 `.ring`',
    '完成了多少：迭代完成度、覆盖率。`stroke-dasharray` 的第一个数就是百分比。',
    '<div class="ring ok"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="86 100"/></svg><div><b class="num">86%</b><span>覆盖率</span></div></div>',
  ],
  [
    '进度条 `.meter`',
    '一项对目标的进度，几条叠起来比各项完成度。`--v` 实际；`--goal` 画一道刻度（应到的进度、预算线）；`--f` 画淡色的预测（月底会到哪）。三个按同一把尺子（轴的最大值）换成百分比。',
    '<div class="meter warn"><div><span>本月花费（预算 50 万）</span><b class="num">¥38<span class="u">万</span></b></div><i style="--v: 63%; --f: 87%; --goal: 83%"></i></div>',
  ],
  [
    '对比条 `.bars`',
    '几项比大小：各地区、各严重级别、各渠道。`--v` 按最大那项算；比的是百分比本身（完成率、占比）时写真实百分比。同一个量用一种颜色，要点出某一项就给它 `.bad` / `.warn`，其余可加 `.mute`。',
    '<div class="bars"><div class="bar bad"><span>华南</span><i style="--v: 100%"></i><b class="num">0.61%</b></div><div class="bar mute"><span>华北</span><i style="--v: 49%"></i><b class="num">0.30%</b></div></div>',
  ],
  [
    '漏斗 `.bars.funnel`',
    '一步步流失多少：招聘、转化、审批。`--v` 是占第一步的比例，`<em>` 写比上一步的转化率（第一步留空）。',
    '<div class="bars funnel"><div class="bar"><span>投递</span><i style="--v: 100%"></i><b class="num">420</b><em></em></div><div class="bar"><span>面试</span><i style="--v: 21%"></i><b class="num">88</b><em>21%</em></div><div class="bar"><span>录用</span><i style="--v: 3%"></i><b class="num">12</b><em>14%</em></div></div>',
  ],
  [
    '构成条 `.stack` + 图例 `.legend`',
    '由什么构成、各占多少：渠道占比、NPS 构成、成本构成。`--n` 是份额（按比例分，不用凑 100），最多五段，下面配 `.legend`。',
    '<div class="stack"><i class="ok" style="--n: 58"></i><i class="mute" style="--n: 26"></i><i class="bad" style="--n: 16"></i></div><div class="legend"><span class="ok">推荐 <b>58%</b></span><span class="mute">中立 <b>26%</b></span><span class="bad">贬损 <b>16%</b></span></div>',
  ],
  [
    '区间 `.ci`',
    '差异是不是真的：A/B 实验的提升、预测区间。放在 `.meter` 里代替条；`--lo` / `--hi` 区间、`--at` 估计值、`--zero` 零线，都是轴上的百分比。',
    '<div class="meter ok"><div><span>转化提升（95% 区间）</span><b class="num">+3.1%</b></div><span class="ci" style="--lo: 58%; --hi: 92%; --at: 75%; --zero: 40%"><i></i><b></b></span></div>',
  ],
  [
    '状态格 `.dots`',
    '一串结果：最近 30 次构建、30 天可用性。一格一个，不加类是正常（淡色），只把异常标 `.warn` / `.bad`，没有数据标 `.none`；`--cols` 定每行几格（30 格：卡片里写 10，完整版写 15 或 30），下面可配 `.axis` 标起止。',
    '<div class="dots" style="--cols: 15"><i></i><i></i><i class="bad"></i><i></i><i class="warn"></i><i class="none"></i></div><div class="axis"><span>10-01</span><span>今天</span></div>',
  ],
  [
    '阶段 `.steps`',
    '走到哪一步：发布流程、项目里程碑、审批。`.done` 做完、`.now` 当前。',
    '<ol class="steps"><li class="done"><span>设计</span></li><li class="now"><span>开发</span></li><li><span>测试</span></li><li><span>发布</span></li></ol>',
  ],
  [
    '短列表 `.list`',
    '要处理的事：阻塞、待审、告警。右边一个短值；卡片里一行一条，完整版里长句换行。',
    '<ul class="list"><li class="bad"><span>支付回调超时</span><b>2 天</b></li><li class="warn"><span>缺退款页设计</span><b>1 天</b></li></ul>',
  ],
  [
    '迷你走势 `.spark`',
    '主数字的走势，放在它下面（在 `.main` 里会吃掉剩下的高度，小卡放不下时加 `.hide-s`）。`data-values` 逗号分隔，`data-goal` 画目标虚线，`data-min` 定下限；末尾的脚本画线，不用自己算坐标。',
    '<svg class="spark ok" data-values="1240,610,240,168" data-goal="200"></svg>',
  ],
  [
    '走势图 `.chart`（完整版）',
    '折线图、柱状图，带刻度、网格、末端数值。`data-labels`、`data-values` 逗号分隔；`data-kind="bar"` 画柱（最后一根是实色）；`data-compare` 画一条虚线对照（上期、理想线）；`data-goal` 目标线（`data-goal-label` 改「目标」两字）；`data-unit` 是末端数值的单位；纵轴默认从 0 起，数都挤在高处（可用性 99.9x%）时写 `data-min="auto"`。默认高 200px，要改写 `style="height: 240px"`。',
    '<figure class="chart" role="img" aria-label="P99 延迟走势" data-labels="基线,第 1 轮,第 2 轮,第 3 轮" data-values="1240,610,240,168" data-goal="200" data-unit=" ms"></figure>',
  ],
  [
    '标签 `.tag`、变化 `.delta`',
    '表格里的状态、数字旁边的变化；加色调，`.tag.info` 是进行中。',
    '<span class="tag bad">阻塞</span> <span class="delta ok">↓ 12%</span>',
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

看板不只是性能数据：迭代进度、代码审查、测试结果、安全扫描、销售、调研、运营、成本、招聘、学习进度……都是同一套写法，按问题选组件。

**做法**：复制末尾的模板，样式（\`<style>\`）和末尾的脚本（\`<script>\`）整段照抄、不改，只换两版的内容；自己要加样式就写在模板样式后面，限定在 \`.card-view\` 或 \`.full-view\` 下，不写裸的标签选择器。

## 先想清楚：这张卡回答什么问题

卡片是给人在画布上扫一眼的（画布常缩到一半看），**一张卡只回答一个问题**。先写下这句话，再挑主组件：

| 问题 | 主组件 |
|---|---|
| 一个数到没到目标、比上次好还是差 | 主数字 \`.hero\`（下面配迷你走势） |
| 完成了多少、跟不跟得上时间 | 进度环 \`.ring\`，或进度条 \`.meter\`（\`--goal\` 标应到的位置） |
| 花了多少、会不会超预算 | 进度条 \`.meter\`（\`--f\` 预测、\`--goal\` 预算线） |
| 谁多谁少 | 对比条 \`.bars\` |
| 由什么构成 | 构成条 \`.stack\` + \`.legend\` |
| 一步步流失多少 | 漏斗 \`.bars.funnel\` |
| 差异是不是真的（实验、预测） | 区间 \`.ci\` |
| 最近一串结果怎么样 | 状态格 \`.dots\` |
| 走到哪一步了 | 阶段 \`.steps\` |
| 有哪些要处理 | 短列表 \`.list\` |

\`.side\` 里放次要的：几个数用指标行 \`.stats\`，几件事用短列表 \`.list\`。

## 卡片版

结构固定：

\`\`\`html
<section class="card-view">
  <div class="card-head"><h1>哪一期 / 哪一个</h1><span class="badge">✓ 结论</span></div>
  <div class="card-body">
    <div class="main"><!-- 主组件，一个（可以带一条迷你走势） --></div>
    <div class="side"><!-- 次要的：一组指标行或一个短列表，可以再加一条进度条；可舍的标 data-drop --></div>
  </div>
</section>
\`\`\`

- **字号和画布上的步骤卡片一套**：看板卡片就摆在步骤卡片旁边，一起缩放，字要一样大——标题 ${BOARD_CARD_FONT.title}px、正文和标签 ${BOARD_CARD_FONT.body}px、指标值 ${BOARD_CARD_FONT.value}px，模板里写好了。只有主数字（和进度环里的数）随卡片变大。**卡片大了多放内容，不放大字**；自己加的样式不改字号。
- **卡片自己有标题行**（写着资源的名字），\`<h1>\` 不重复它，写看的是哪一期、哪一个（「迭代 23」「PR #482」「第 43 周」），排成一行淡字；结论写在右边的徽标里。
- **从上往下排，正好铺满一屏**：不滚动、不截断、不垂直居中。内容要多备一两项标 \`data-drop\`（列表多写两行、指标行多写一行），放得下就显示，放不下时末尾的脚本按顺序收起（\`"1"\` 先收、\`"2"\` 再收），还放不下再把主数字缩小一些。主组件不标 \`data-drop\`。
- **版式按卡片形状自动变**（模板里写好了）：
  - 横着的卡：左 \`.main\`、右 \`.side\`；
  - 竖长的卡：\`.main\` 在上、\`.side\` 在下，上下排开；
  - 小卡（高 < 160 或宽 < 200）：只留标题、徽标和 \`.main\`，\`.side\`、\`.hide-s\` 隐藏，\`.main\` 里的进度条变成一行；
  - 大卡（宽 ≥ 420 且高 ≥ 260）：再显示 \`.only-l\`。
- 所以**最要紧的放 \`.main\`**，次要的放 \`.side\`，锦上添花的标 \`.only-l\`。
- **按卡片大小定放多少**（字号固定，大卡要多放东西，不然就空着）：

  | 卡片 | 大约放得下 |
  |---|---|
  | 小（208×128） | 标题行 + 主组件：主数字和一行对比，或三行条 |
  | 中（320×200） | 再加旁边一组：三四行指标行，或三四行列表 |
  | 大（448×280） | 再加两三项（标 \`.only-l\`）：迷你走势、短列表、一条进度条 |
  | 竖长（224×320） | 主组件在上，下面三四项 |
- **组件要少**：主组件一个，次要的一两样（一组指标行、一个短列表、一条进度条）；对比条、列表、指标行三四行，再往后的标 \`data-drop\`。不放表格、段落。
- **字要短**：\`<h1>\` 六个字左右，徽标写结论、五六个字（「✓ 已达标」「⚠ 观察中」「✗ 3 个阻塞」），不只靠颜色——小卡、竖长卡上两个挤在一行；指标块的标签四个字以内、值五个字符以内（单位放进 \`<span class="u">\`，不算字数）；主数字下面那行十个字以内。

## 完整版

放全部内容：指标、图表、明细，可以滚动。

- 开头 \`<header>\`（标题、副标题、徽标），接一条 \`.kpis\` 指标带（四五项，每项可带一行 \`<small>\` 对比）。
- 下面是 12 列的 \`.grid\`，一个分区一个 \`<section>\`，宽度用 \`.w4\` / \`.w6\`（默认）/ \`.w8\` / \`.w12\`，**每行加起来 12**（8 + 4、6 + 6、4 + 4 + 4、12），窄于 760px 时自动单列。常用的骨架：主图 \`.w8\` + 要点或列表 \`.w4\`，两个细分 \`.w6\` + \`.w6\`，明细表 \`.w12\`。
- 图用 \`.chart\`（写数据，脚本画刻度和网格），表格外面包一层 \`<div class="table">\`（窄时横向滚动），数字列加 \`class="num"\` 右对齐。
- 组件在完整版里也能用（字号按 15px 排），列表的长句会换行。

两版说的是同一组数据，数字要一致。

## 颜色

- **状态色**（\`.ok\` / \`.warn\` / \`.bad\`）只表示好坏；**系列色**（\`.c1\` ~ \`.c6\`，不加是 c1）只区分类别，不表示好坏。
- 同一个量的几项（各地区、各渠道）用一种颜色；要点出哪一项，就给它状态色，其余加 \`.mute\`。不要一项一个颜色。
- 状态格、列表默认是平静的颜色，只把异常标出来，异常一眼就能跳出来。

## 组件

样式都在模板里，按下面的写法贴进去；色调加在组件上。

${COMPONENT_TABLE}

## 主题：只用 \`--board-*\` 变量

插件把画布当前的主题写成下面这组 CSS 变量，设在 \`<html>\` 的内联样式上（比页面自己的 \`:root\` 优先），并设好 \`color-scheme\`；用户换主题时就地更新，不重载页面。

| 变量 | 用途 |
|---|---|
${TOKEN_TABLE}

- **颜色、圆角、字体全部从变量取**，不要写死别的颜色；要淡底就混出来：\`color-mix(in srgb, var(--board-accent) 14%, transparent)\`。
- 页面底色用 \`--board-bg\`（和卡片的展示区同色，看板和卡片融成一块），分区用一圈 \`--board-line\`。
- **在 \`:root\` 里写一份后备值**，亮暗两套用 \`prefers-color-scheme\` 切（模板里有现成的两套，照抄）：浏览器里单独打开时用它们。
- 圆角一律写 \`var(--board-radius)\`（有的主题是直角）；胶囊用 \`var(--pill)\`。

## 图表

- 卡片里用 \`.spark\`，完整版用 \`.chart\`：写数据，末尾的脚本按实际像素画，字不随宽度缩放，主题变了自动跟着变。
- 别的图自己写内联 SVG 时，颜色写在 CSS 里（SVG 的 \`fill=\` / \`stroke=\` 属性里不能用 \`var()\`，要写进 \`class\` 或 \`style\`），字别放进会被拉伸的 \`viewBox\` 里。
- 要交互的复杂图可以从 CDN 引入图表库（ECharts、Chart.js）：颜色用 \`getComputedStyle(document.documentElement).getPropertyValue('--board-c1')\` 读，并监听 \`window\` 上的 \`${BOARD_THEME_EVENT}\` 事件重画（插件换完主题会派发它）。只放在完整版里。
- 不要把 PNG 图贴进看板：图片不会跟着主题变色。

## 硬要求

- **一个自包含的文件**：样式、脚本、数据都写进页面；卡片里读不到相对路径的文件，图用内联 SVG 或 data URI。
- 图表库、字体可以从 CDN 引入。
- 不要读写 localStorage、cookie（卡片里会报错）。
- 不要把宽高写死成卡片的像素尺寸。

## 自检

- 这张卡回答的那个问题，扫一眼能看出答案吗？主数字是不是用户要据此行动的那个？
- 在浏览器里打开 \`文件#card\` 看卡片版，把窗口（或开发者工具的设备模式）调到任务描述给的尺寸，再看小（208×128）、竖长（224×320）两档：正好一屏、没有截断、没有大块空白？
- 完整版在 400px 和 1400px 宽下都不挤、不空，每行分区加起来 12？
- 页面里还有没有写死的颜色（\`#\`、\`rgb(\` 只该出现在 \`:root\` 的后备值里）？

## 模板

一张完整的看板（迭代进度）：换成你的问题、组件和数据；样式、脚本、后备值照抄。

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

/** 测试与演示用：skill 正文、模板、模板的样式和脚本。 */
export const BOARD_SKILL_CONTENT = CONTENT
export const BOARD_TEMPLATE = TEMPLATE
export const BOARD_STYLE = STYLE
export const BOARD_SCRIPT = SCRIPT
