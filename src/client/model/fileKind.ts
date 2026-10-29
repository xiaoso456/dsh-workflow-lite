/**
 * dsh-workflow-lite — 文件的类型：粗分几类在 `shared/fileKind.ts`（编译计划也要用），这里是只管界面的细分类。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/fileKind
 */

import { extensionOf, fileBaseName } from '../../shared/fileKind.ts'

export {
  extensionOf,
  type FileKind,
  fileBaseName,
  fileDirName,
  fileKindOf,
} from '../../shared/fileKind.ts'

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

/**
 * 终端颜色、光标控制这类转义序列（日志里常见的 `ESC[31m`）：文本里显示出来只是一串乱码，去掉。
 * 认 CSI（`ESC [ … 终止字节`）、OSC（`ESC ] … BEL / ESC \`）和其余两字节的 `ESC x`。
 */
const ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 要认的就是这几个控制字符
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/gu

export function stripAnsi(text: string): string {
  return text.includes('\u001b') ? text.replace(ANSI, '') : text
}
