/**
 * dsh-workflow-lite — HTTP 触发的调用示例：同一条请求（POST、带令牌、JSON 正文）在 curl、PowerShell、
 * JavaScript、Python 里怎么写。纯计算，给「触发方式」对话框里的示例框和「复制」用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/httpSnippets
 */

import type { TriggerEndpoint } from '../../shared/wire/trigger.ts'

export const SNIPPET_LANGS = ['curl', 'powershell', 'javascript', 'python'] as const
export type SnippetLang = (typeof SNIPPET_LANGS)[number]

/** 页签上各写法的名字（专有名词，不分语言）。 */
export const SNIPPET_NAME: Record<SnippetLang, string> = {
  curl: 'curl',
  powershell: 'PowerShell',
  javascript: 'JavaScript',
  python: 'Python',
}

/** 示例里的正文：随便一个 JSON，收到的会话把它当背景信息。 */
export const SAMPLE_BODY = '{"event":"deploy","ref":"main"}'

/**
 * 这种语言的示例（多行）。
 * @param endpoint - `token` 是 `null` 时地址不校验令牌，示例里不带。
 */
export function snippetOf(
  lang: SnippetLang,
  endpoint: Pick<TriggerEndpoint, 'url'> & { token: string | null },
): string {
  const { url, token } = endpoint
  const lines = (...items: (string | false)[]): string =>
    items.filter((line): line is string => line !== false).join('\n')
  const auth = token !== null
  switch (lang) {
    case 'curl':
      return lines(
        `curl -X POST "${url}" \\`,
        auth && `  -H "Authorization: Bearer ${token}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${SAMPLE_BODY}'`,
      )
    case 'powershell':
      return lines(
        `Invoke-RestMethod -Method Post -Uri "${url}" \``,
        auth && `  -Headers @{ Authorization = "Bearer ${token}" } \``,
        `  -ContentType "application/json" \``,
        `  -Body '${SAMPLE_BODY}'`,
      )
    case 'javascript':
      return lines(
        `await fetch("${url}", {`,
        `  method: "POST",`,
        `  headers: {`,
        auth && `    Authorization: "Bearer ${token}",`,
        `    "Content-Type": "application/json",`,
        `  },`,
        `  body: JSON.stringify(${SAMPLE_BODY}),`,
        `})`,
      )
    case 'python':
      return lines(
        'import requests',
        '',
        'requests.post(',
        `    "${url}",`,
        auth && `    headers={"Authorization": "Bearer ${token}"},`,
        `    json=${SAMPLE_BODY},`,
        ')',
      )
  }
}
