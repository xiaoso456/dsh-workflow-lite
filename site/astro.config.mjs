import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

const REPO = 'https://github.com/xiaoso456/dsh-workflow-lite'

/** 一组页面：label 带英文名，items 里写页面路径（不含语言前缀）。 */
const group = (label, en, items, collapsed = true) => ({ label, translations: { en }, collapsed, items })

/**
 * 侧栏按使用频率分：先装好、跟着做一遍；常用操作要短；「画布展示」是最大的一块功能，每种内容各一页；
 * 其余少用的放进「进阶」，用到再查。页面放在哪个目录不影响侧栏，这里只列路径。
 */
const sidebar = [
  group('快速开始', 'Getting started', ['start/install', 'start/first-workflow']),
  group('典型场景', 'Scenarios', [
    'scenarios/code-review-loop',
    'scenarios/confirm-requirements',
    'scenarios/dashboard',
  ]),
  group('画布操作', 'On the canvas', [
    'editing/steps',
    'editing/loops',
    'running/run',
    'settings/workflow',
    'manage/versions',
  ]),
  group('画布展示', 'Canvas display', [
    'display/overview',
    'display/image',
    'display/web',
    'display/markdown',
    'display/log',
    'display/table',
    'display/text',
    'display/folder',
    'display/rounds',
  ]),
  group('进阶', 'Advanced', [
    'materials/inputs',
    'materials/resources',
    'materials/memory',
    'manage/import-export',
    'manage/hub',
    'settings/plugin',
  ]),
  { slug: 'faq' },
  { slug: 'changelog', translations: { en: 'Changelog' } },
]

export default defineConfig({
  site: 'https://xiaoso456.github.io',
  base: '/dsh-workflow-lite',
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: {
        'zh-CN': '轻量工作流',
        en: 'Workflow Lite',
      },
      description: 'DeepSeek Harness 的软工作流插件：在画布上设计流程，由模型按计划执行。',
      favicon: '/favicon.png',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/site/` },
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
        en: { label: 'English', lang: 'en' },
      },
      customCss: ['./src/styles/theme.css'],
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
        Head: './src/components/Head.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
      },
      expressiveCode: {
        themes: ['github-dark-dimmed', 'github-light'],
        styleOverrides: {
          borderRadius: '10px',
          codeFontFamily: 'var(--sl-font-mono)',
        },
      },
      sidebar,
    }),
  ],
})
