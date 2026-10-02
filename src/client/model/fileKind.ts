/**
 * dsh-workflow-lite — 文件的类型：按扩展名粗分几类，给类型签配色、决定能不能在查看框里看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/fileKind
 */

export type FileKind = 'markdown' | 'text' | 'code' | 'data' | 'image' | 'other'

const KINDS: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'data',
  tsv: 'data',
  json: 'data',
  jsonl: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  xml: 'data',
  ini: 'data',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
}

const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'cs',
  'rb',
  'php',
  'sh',
  'ps1',
  'bat',
  'sql',
  'css',
  'html',
  'vue',
  'swift',
])

/** 路径的最后一段。 */
export function fileBaseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '' && part !== '.')
  return parts[parts.length - 1] ?? path
}

/** 路径去掉最后一段剩下的目录（没有就是空串）。 */
export function fileDirName(path: string): string {
  const name = fileBaseName(path)
  const cut = path.lastIndexOf(name)
  return cut <= 0
    ? ''
    : path
        .slice(0, cut)
        .replace(/[\\/]+$/u, '')
        .replace(/^\.[\\/]/u, '')
}

/** 扩展名，小写、不带点；没有就是空串。 */
export function extensionOf(path: string): string {
  const name = fileBaseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function fileKindOf(path: string): FileKind {
  const ext = extensionOf(path)
  if (ext === '') return 'other'
  return KINDS[ext] ?? (CODE.has(ext) ? 'code' : 'other')
}

/** 字节数写成人看的样子：`812 B`、`3.4 KB`、`1.2 MB`。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
