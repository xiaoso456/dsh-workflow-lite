# 回调要验签名、读请求头（监视，自己开端口）

GitHub、飞书、钉钉这类回调要验签名、看请求头（事件类型）或握手，`http` 卡片拿不到请求头，写个监视程序自己开端口。下面拿 GitHub 写，别家换掉验签名和取字段的那几行。命令 `node hook.mjs 3801`；Webhook 的 secret 请用户放进密钥目录的 `github-secret.txt`。对方在外网时还要用户配隧道或转发。

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { emit, injected, onStop, secret, seenIds, warn } from '../watch.mjs'

const key = secret('github-secret.txt', 'Webhook 的 secret')
const seen = seenIds() // 对方会重投同一次投递

function handle({ event, payload }) {
  const pr = payload.pull_request
  emit(`${payload.repository?.full_name} 来了 ${event}${pr ? `：#${pr.number} ${pr.title}` : ''}`, { event, url: pr?.html_url })
}

const server = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    const expected = Buffer.from(`sha256=${createHmac('sha256', key).update(body).digest('hex')}`)
    const given = Buffer.from(String(request.headers['x-hub-signature-256'] ?? ''))
    const ok = given.length === expected.length && timingSafeEqual(given, expected)
    response.writeHead(ok ? 202 : 401).end()
    if (!ok) return warn('签名不对，丢掉')
    const event = String(request.headers['x-github-event'])
    if (event === 'ping' || !seen.add(request.headers['x-github-delivery'])) return
    seen.save()
    handle({ event, payload: JSON.parse(body.toString('utf8')) })
  })
}).listen(Number(process.argv[2]), '0.0.0.0')
onStop(() => server.close())
injected(handle)
```

试：写一个按同一个 secret 签名、往本机端口发请求的小脚本，放在卡片目录的 `hook-poke.mjs`：

```js
import { createHmac } from 'node:crypto'
import { secret } from '../watch.mjs'

const body = JSON.stringify({ repository: { full_name: 'acme/app' }, pull_request: { number: 7, title: '试一下' } })
const response = await fetch(`http://127.0.0.1:${process.argv[2]}/`, {
  method: 'POST',
  body,
  headers: {
    'x-github-event': 'pull_request',
    'x-github-delivery': `poke-${Date.now()}`,
    'x-hub-signature-256': `sha256=${createHmac('sha256', secret('github-secret.txt')).update(body).digest('hex')}`,
  },
})
console.log(`返回 ${response.status}`)
```

`poke` 写 `node hook-poke.mjs 3801`：`poke.output` 是「返回 202」，`events` 里正好一行「acme/app 来了 pull_request：#7 试一下」。要看真实的请求体会打成什么样，从对方的投递记录里存一份，包成 `{"event": …, "payload": …}` 投样本（`kit.md`）。
