/**
 * Third-party tsdown build for @xiaoso/dsh-workflow-lite.
 *
 * Node half: plain ESM library build from src — `@deepseek-ai/*` imports stay
 * external (the Loader resolves them through the profile install), so only this
 * package's own sources are bundled. `@xyflow/react` / `elkjs` are ours and are
 * never imported by the host half.
 *
 * Browser half: CJS closure-factory bundle the web module loader expects
 * (`window.__ModuleLoader__.load({id, factory})`), React and the client platform
 * modules left external, `@xyflow/react` + `elkjs` bundled in. CSS Modules are
 * compiled with lightningcss into a hashed class map plus an injected
 * `<style data-plugin-css>` tag so HMR can find and remove it.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const require_ = createRequire(import.meta.url)

/** Package name — the loader module-table id and the style-tag owner stamp. */
const ID = '@xiaoso/dsh-workflow-lite'

/** Platform modules the frozen loader table answers; every other import inlines. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-workspace',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export default defineConfig([
  {
    // Node half: the file repository, the validator/compiler, the one tool.
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    // Browser half: the React Flow canvas, the workflow picker, the plan preview.
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      // tsdown 默认会把 `dependencies` 外部化——但 `@xyflow/react` / `elkjs` / `pathe` 是我们自己的产物，
      // 必须**打进来**：模块加载器只认冻结的平台 externals，留在 require() 里就是运行时报错。
      alwaysBundle: [/^@xyflow\//, /^elkjs($|\/)/, /^pathe($|\/)/],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [
      {
        // Build-time mirror of the module-edge rules: cross-plugin @deepseek-ai
        // value imports are forbidden (type-only imports are erased).
        name: 'workflow-lite-bundle-purity',
        resolveId(source: string) {
          if (!source.startsWith('@deepseek-ai/')) return null
          if (CLIENT_EXTERNALS.includes(source)) return null
          throw new Error(
            `client bundle purity: "${source}" is not a platform module — cross-plugin value imports are forbidden`,
          )
        },
      },
      {
        // CSS（含 CSS Modules）走 lightningcss：
        // - `*.module.css` 产出哈希化的类名表 + 注入 <style data-plugin>；
        // - 普通 `.css`（例如 React Flow 自己的样式表）只注入、不导出类名表。
        name: 'workflow-lite-css',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.css')) return null
          let abs: string
          if (source.startsWith('.') || source.startsWith('/')) {
            abs = importer === undefined ? source : resolve(dirname(importer), source)
          } else {
            // 裸包名（如 `@xyflow/react/dist/style.css`）：走 node 解析，尊重包的 exports 映射。
            abs = require_.resolve(source)
          }
          return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(fileId)
          const isModule = fileId.endsWith('.module.css')
          const source = await readFile(fileId)
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            ...(isModule ? { cssModules: { pattern: '[hash]_[local]' } } : {}),
            minify: true,
          })
          const classMap: Record<string, string> = {}
          for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
          return [
            `const css = ${JSON.stringify(code.toString())};`,
            `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
            'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
            '  const tag = document.createElement(\'style\');',
            `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
            '  tag.dataset.pluginCss = tagId;',
            '  tag.textContent = css;',
            '  document.head.appendChild(tag);',
            '}',
            `export default ${JSON.stringify(classMap)};`,
          ].join('\n')
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
