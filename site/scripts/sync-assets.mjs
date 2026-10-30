/**
 * 把仓库根 assets/ 里文档站要用的品牌图复制进来，避免在站点里再存一份二进制。
 *
 * 目标是 src/assets/brand/（已在 .gitignore 里，由 `pnpm run sync` 生成），页面和配置从这里引用。
 * 首页用的两张界面图是从封面长图 hero.zh.png / hero.en.png 里按区域裁出来的（英文首页用英文封面），封面重拍后重新同步即得。
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = (path) => fileURLToPath(new URL(path, import.meta.url))
const OUT = root('../src/assets/brand')
mkdirSync(OUT, { recursive: true })

const FILES = ['icon.webp', 'icon-full.webp', 'wordmark.png']
for (const name of FILES) copyFileSync(root(`../../assets/${name}`), `${OUT}/${name}`)

/** 封面长图（2080 宽）里两块界面的区域，单位是原图像素；英文封面更高，第二块往下挪了一截。 */
const CROPS = {
  zh: {
    'shot-design': { left: 64, top: 327, width: 1952, height: 603 },
    'shot-run': { left: 64, top: 1826, width: 1952, height: 1195 },
  },
  en: {
    'shot-design': { left: 64, top: 327, width: 1952, height: 603 },
    'shot-run': { left: 64, top: 1974, width: 1952, height: 1195 },
  },
}

let count = 0
for (const [lang, regions] of Object.entries(CROPS)) {
  for (const [name, region] of Object.entries(regions)) {
    const file = lang === 'zh' ? `${name}.webp` : `${name}.${lang}.webp`
    await sharp(root(`../../assets/hero.${lang}.png`)).extract(region).webp({ quality: 90 }).toFile(`${OUT}/${file}`)
    count += 1
  }
}
console.log(`sync-assets: ${FILES.length} 个文件，${count} 张裁图`)
