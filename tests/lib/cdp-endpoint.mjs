/**
 * DevTools 端点（抄自同作者的 task-runner，口径保持一致）。
 *
 * 默认 `http://127.0.0.1:9222`；默认端口被占时可用 `DSH_CDP_HTTP` / `DSH_CDP_PORT` 指到
 * 私有启动的 headless Chrome。
 */

const DEFAULT_PORT = '9222'

/** 读环境变量，空串当未设。 */
function envValue(name) {
  const value = process.env[name]
  return value === undefined || value.length === 0 ? undefined : value
}

/** DevTools HTTP 基址。 */
export const CDP_HTTP =
  envValue('DSH_CDP_HTTP') ?? `http://127.0.0.1:${envValue('DSH_CDP_PORT') ?? DEFAULT_PORT}`

/** 实际使用的 DevTools 端口。 */
export const CDP_PORT = new URL(CDP_HTTP).port || DEFAULT_PORT
