// 右栏目录：当前小节左边的标记条随滚动滑动（只动 transform 和 opacity）。
const place = (ul: HTMLElement, bar: HTMLElement) => {
  const current = ul.querySelector<HTMLElement>('a[aria-current="true"]')
  if (!current) {
    bar.style.opacity = '0'
    return
  }
  bar.style.opacity = '1'
  bar.style.transform = `translateY(${current.offsetTop}px) scaleY(${current.offsetHeight})`
}

type Toc = HTMLElement & { current: HTMLAnchorElement }

// 页面短、滚不到位时，最后几节的标题到不了判定线，高亮会停在前一节：
// 点击目录项后以点中的为准，滚到页底时以最后一项为准；用户自己滚动就交还给默认逻辑。
let previous: AbortController | undefined

const watchUnreachable = (ul: HTMLElement) => {
  previous?.abort()
  previous = new AbortController()
  const { signal } = previous
  const toc = ul.closest<Toc>('starlight-toc')
  if (!toc) return
  const links = [...ul.querySelectorAll<HTMLAnchorElement>('a')]
  let pinned: HTMLAnchorElement | null = null
  // 点击引起的滚动结束后才算「稳定」；之后再有滚动（拖滚动条等）就交还。
  let settled = false
  let settleTimer = 0
  const apply = () => {
    if (pinned) toc.current = pinned
  }
  const unpin = () => {
    pinned = null
  }
  for (const link of links) {
    link.addEventListener('click', () => {
      pinned = link
      settled = false
      apply()
      clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settled = true
      }, 900)
    })
  }
  // 默认逻辑的回调可能晚于点击到达，点过之后它改了高亮就改回来。
  const guard = new MutationObserver(() => {
    if (pinned && ul.querySelector('a[aria-current="true"]') !== pinned) apply()
  })
  guard.observe(ul, { attributes: true, subtree: true, attributeFilter: ['aria-current'] })
  signal.addEventListener('abort', () => guard.disconnect())
  for (const type of ['wheel', 'touchmove', 'keydown']) {
    window.addEventListener(type, unpin, { passive: true, signal })
  }
  window.addEventListener(
    'scroll',
    () => {
      if (settled) unpin()
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      if (atBottom && !pinned && links.length > 0) toc.current = links[links.length - 1]
    },
    { passive: true, signal },
  )
}

document.addEventListener('astro:page-load', () => {
  const ul = document.querySelector<HTMLElement>('.right-sidebar-panel starlight-toc nav > ul')
  if (!ul || ul.querySelector('.wl-toc-bar')) return
  const bar = document.createElement('span')
  bar.className = 'wl-toc-bar'
  bar.setAttribute('aria-hidden', 'true')
  ul.prepend(bar)
  place(ul, bar)
  // 首次定位不要从零滑过来，下一帧再开过渡。
  requestAnimationFrame(() => bar.classList.add('ready'))
  watchUnreachable(ul)
  new MutationObserver(() => place(ul, bar)).observe(ul, {
    attributes: true,
    subtree: true,
    attributeFilter: ['aria-current'],
  })
})
