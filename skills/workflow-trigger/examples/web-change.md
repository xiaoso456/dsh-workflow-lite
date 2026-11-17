# 网页里某一块变了（定时检查）

`when: "change"`，脚本只打出关心的那一块（价格、版本号、公告标题），整页的时间戳、广告变了不算。

```js
const url = process.argv[2]
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const html = await response.text()
  const match = /<h2 class="release">([^<]+)<\/h2>/.exec(html)
  if (match === null) {
    console.error('页面里没找到要看的那一块')
    process.exit(2)
  }
  console.log(match[1].trim())
} catch (error) {
  console.error(String(error))
  process.exit(2)
}
```
