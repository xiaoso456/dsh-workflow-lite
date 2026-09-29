import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    // `tests/runs/**` is scratch space for CDP run artifacts — the recursive
    // include above would otherwise collect stray `*.spec.ts` probes in there
    // and run them as if they were the production suite.
    exclude: [...configDefaults.exclude, 'tests/runs/**'],
  },
})
