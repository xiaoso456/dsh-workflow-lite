/**
 * dsh-workflow-lite — HTTP 触发的调用示例：同一条请求（POST、带令牌、JSON 正文）在 curl、PowerShell、
 * JavaScript、Python 里怎么写。纯计算，给「触发方式」对话框里的示例框和「复制」用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/httpSnippets
 */

import type { TriggerEndpoint } from '../../shared/wire/trigger.ts'

export const SNIPPET_LANGS = ['curl', 'powershell', 'javascript', 'python'] as const
export type SnippetLang = (typeof SNIPPET_LANGS)[number]

/** 示例里的正文：随便一个 JSON，收到的会话把它当背景信息。 */
export const SAMPLE_BODY = '{"event":"deploy","ref":"main"}'

/** 这种语言的示例（多行，带上令牌）。 */
export function snippetOf(
  lang: SnippetLang,
  endpoint: Pick<TriggerEndpoint, 'url' | 'token'>,
): string {
  const { url, token } = endpoint
  switch (lang) {
    case 'curl':
      return [
        `curl -X POST "${url}" \\`,
        `  -H "Authorization: Bearer ${token}" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${SAMPLE_BODY}'`,
      ].join('\n')
    case 'powershell':
      return [
        `Invoke-RestMethod -Method Post -Uri "${url}" \``,
        `  -Headers @{ Authorization = "Bearer ${token}" } \``,
        `  -ContentType "application/json" \``,
        `  -Body '${SAMPLE_BODY}'`,
      ].join('\n')
    case 'javascript':
      return [
        `await fetch("${url}", {`,
        `  method: "POST",`,
        `  headers: {`,
        `    Authorization: "Bearer ${token}",`,
        `    "Content-Type": "application/json",`,
        `  },`,
        `  body: JSON.stringify(${SAMPLE_BODY}),`,
        `})`,
      ].join('\n')
    case 'python':
      return [
        'import requests',
        '',
        'requests.post(',
        `    "${url}",`,
        `    headers={"Authorization": "Bearer ${token}"},`,
        `    json=${SAMPLE_BODY},`,
        ')',
      ].join('\n')
  }
}
