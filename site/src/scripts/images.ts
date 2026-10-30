// 正文里的界面截图：点击放大看全图（显示尺寸在 MarkdownContent.astro 里定）。
const SELECTOR = '.sl-markdown-content img:not(.not-content img)'

function open(source: HTMLImageElement) {
  const dialog = document.createElement('dialog')
  dialog.className = 'wl-lightbox'
  const big = new Image()
  big.src = source.currentSrc || source.src
  big.alt = source.alt
  dialog.append(big)
  if (source.alt) {
    const caption = document.createElement('p')
    caption.textContent = source.alt
    dialog.append(caption)
  }
  dialog.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => setTimeout(() => dialog.remove(), 300))
  document.body.append(dialog)
  dialog.showModal()
}

function setup() {
  for (const img of document.querySelectorAll<HTMLImageElement>(SELECTOR)) {
    if (img.dataset.wlZoom === '1') continue
    img.dataset.wlZoom = '1'
    img.tabIndex = 0
    img.setAttribute('role', 'button')
    img.addEventListener('click', () => open(img))
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open(img)
      }
    })
  }
}

document.addEventListener('astro:page-load', setup)
