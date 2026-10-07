/**
 * dsh-workflow-lite — 截图管线的假 LLM（OpenAI 兼容），**不发任何真实模型请求**。
 *
 * 为什么需要它：封面要拍的是"一条有消息的会话"——空白会话页没有 tab，而让会话非空白的
 * 唯一入口是 `session/prompt`，它一定会问模型。所以把模型接到这里：
 * 真 dsh、真会话、真工具链路，只有"模型说了什么"是编的。
 *
 * 接线方式照 `dsh-bash-plus/tests/support/harness/support.ts` 的先例：由
 * `shots-env.mjs` 把 `llm-pi-ai` 的 providers 指向本服务的 `baseURL`。
 *
 * 直接跑（调试用）：`node tests/support/mock-llm.mjs --port 0`
 *
 * @module tests/support/mock-llm
 */

import { createServer } from 'node:http'

/** 假模型的固定回答。挑一句无害的，别让它看起来像真在干活。 */
export const MOCK_REPLY = '（假模型）收到，这一步按计划继续。'

/**
 * 起一个假供应商。
 * @param {{ port?: number, reply?: string }} [options]
 * @returns {Promise<{ url: string, port: number, requests: unknown[], close: () => Promise<void> }>}
 */
export async function startMockLlm(options = {}) {
  const reply = options.reply ?? MOCK_REPLY
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const path = req.url ?? '/'
      let parsed
      try {
        parsed = body === '' ? undefined : JSON.parse(body)
      } catch {
        parsed = body
      }
      if (path.endsWith('/chat/completions') || path.endsWith('/completions')) {
        requests.push({ path, body: parsed })
        const streaming = typeof parsed === 'object' && parsed !== null && parsed.stream === true
        if (streaming) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          const chunk = (delta, finish) =>
            `data: ${JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'mock-model',
              choices: [{ index: 0, delta, finish_reason: finish ?? null }],
            })}\n\n`
          res.write(chunk({ role: 'assistant', content: '' }))
          // 分几段吐，避免个别客户端把单块当异常
          for (const piece of reply.match(/.{1,8}/gu) ?? [reply])
            res.write(chunk({ content: piece }))
          res.write(chunk({}, 'stop'))
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'mock-model',
            choices: [
              { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        )
        return
      }
      if (path.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
        return
      }
      // 其它端点一律 404：真跑到这儿说明接线不对，别静默糊过去
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `mock-llm: 不认这个端点 ${path}` } }))
    })
  })

  await new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    port,
    requests,
    close: () =>
      new Promise((resolve) => {
        // 光 close() 只停止接受新连接：宿主那侧要是还挂着一条 keep-alive，回调要等到
        // keepAliveTimeout 才来，`stop()` 就白等。先把在飞的连接踢掉。
        server.closeAllConnections()
        server.close(() => {
          resolve()
        })
      }),
  }
}

// 直接 `node tests/support/mock-llm.mjs` 时当服务跑，便于手工排查
if (process.argv[1] !== undefined && /mock-llm\.mjs$/u.test(process.argv[1])) {
  const portArg = process.argv.indexOf('--port')
  const port = portArg === -1 ? 0 : Number(process.argv[portArg + 1] ?? 0)
  const mock = await startMockLlm({ port })
  console.log(`mock-llm listening on ${mock.url}`)
}
