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
  avif: 'image',
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

/**
 * 比 {@link FileKind} 细的分类，只管图标和颜色（文件夹浏览、选择框里每个文件前面那一枚）：
 * 常见的文档、表格、幻灯片、压缩包、音视频、字体、数据库、脚本、网页、配置、锁文件、可执行文件各有各的。
 */
export type FileGroup =
  | 'markdown'
  | 'text'
  | 'doc'
  | 'pdf'
  | 'sheet'
  | 'slides'
  | 'data'
  | 'config'
  | 'code'
  | 'web'
  | 'shell'
  | 'database'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'font'
  | 'lock'
  | 'binary'
  | 'other'

const GROUP_EXTENSIONS: Record<Exclude<FileGroup, 'other'>, readonly string[]> = {
  markdown: ['md', 'markdown', 'mdx'],
  text: ['txt', 'log', 'rst', 'adoc', 'nfo'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'pages', 'tex'],
  pdf: ['pdf', 'epub'],
  sheet: ['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'ods', 'numbers'],
  slides: ['ppt', 'pptx', 'odp', 'key'],
  data: ['json', 'jsonl', 'ndjson', 'json5', 'jsonc', 'xml', 'plist', 'proto', 'graphql', 'gql'],
  config: ['yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 'editorconfig'],
  code: [
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'py',
    'pyi',
    'rs',
    'go',
    'java',
    'kt',
    'kts',
    'scala',
    'c',
    'h',
    'cpp',
    'cc',
    'hpp',
    'cs',
    'rb',
    'php',
    'swift',
    'dart',
    'lua',
    'r',
    'pl',
    'ex',
    'exs',
    'erl',
    'hs',
    'clj',
    'zig',
    'vue',
    'svelte',
    'css',
    'scss',
    'sass',
    'less',
  ],
  web: ['html', 'htm', 'xhtml', 'mhtml'],
  shell: ['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd'],
  database: ['sql', 'db', 'sqlite', 'sqlite3', 'mdb', 'parquet'],
  image: [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'avif',
    'bmp',
    'ico',
    'tif',
    'tiff',
    'heic',
    'psd',
    'ai',
    'fig',
  ],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'mid', 'midi'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'dmg'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
  lock: ['lock', 'pem', 'key', 'crt', 'cer', 'pub', 'p12', 'pfx'],
  binary: ['exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'jar', 'wasm', 'apk', 'msi'],
}

const BY_EXTENSION = new Map<string, FileGroup>()
for (const [group, list] of Object.entries(GROUP_EXTENSIONS)) {
  for (const ext of list) BY_EXTENSION.set(ext, group as FileGroup)
}

/** 没有扩展名、但看名字就知道是什么的。 */
const BY_NAME: Record<string, FileGroup> = {
  dockerfile: 'config',
  makefile: 'shell',
  license: 'text',
  readme: 'text',
  changelog: 'text',
  authors: 'text',
  notice: 'text',
}

export function fileGroupOf(path: string): FileGroup {
  const ext = extensionOf(path)
  if (ext !== '') return BY_EXTENSION.get(ext) ?? 'other'
  const name = fileBaseName(path).toLowerCase()
  // `.gitignore`、`.env` 这类点开头、没有别的扩展名的：配置。
  if (name.startsWith('.') && name.length > 1) return 'config'
  return BY_NAME[name] ?? 'other'
}

/** 字节数写成人看的样子：`812 B`、`3.4 KB`、`1.2 MB`。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
