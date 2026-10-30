// 视图过渡切页时，新页面的侧栏按服务端 HTML 重新渲染：只有当前页所在的分组是展开的，
// 其余全部瞬间收起，列表跟着跳。这里把旧侧栏的展开状态和滚动位置带到新页面上。
const groups = (root: ParentNode) => [...root.querySelectorAll<HTMLDetailsElement>('.sidebar-content details')]
const pane = (root: ParentNode) => root.querySelector<HTMLElement>('#starlight__sidebar')

let scrollTop = 0

document.addEventListener('astro:before-swap', (event) => {
  const opened = groups(document).map((d) => d.open)
  scrollTop = pane(document)?.scrollTop ?? 0
  // 新页面里当前分组本来就是展开的；旧页面里展开过的保持展开，不会收起。
  groups(event.newDocument).forEach((d, i) => {
    if (opened[i]) d.open = true
  })
})

document.addEventListener('astro:after-swap', () => {
  const el = pane(document)
  if (el) el.scrollTop = scrollTop
})
