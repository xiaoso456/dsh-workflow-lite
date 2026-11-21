/**
 * dsh-workflow-lite — 定时检查、监听的命令模板：「从模板开始」菜单里的几条常用写法。
 *
 * 命令交给卡片选的 shell（cmd、PowerShell、sh 一类都可能），模板只用 `git` 和 `node -e`（DSH 自带 Node），
 * 双引号里不写 `$`、反引号，两边的 shell 都原样交给程序。挑了模板会连同判定方式一起换（定时检查）。
 * 命令缺省在卡片目录里跑：要看用户仓库、文件夹的写 `{workspace}`（插件跑之前换成卡片选的会话工作区，正斜杠）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/commandTemplates
 */

import type { CheckWhen } from '../../shared/types.ts'
import type { LocaleKey } from '../i18n.ts'

export interface CommandTemplate {
  id: string
  /** 菜单里的名字。 */
  label: LocaleKey
  /** 一句说明。 */
  desc: LocaleKey
  command: string
  /** 定时检查：配哪种判定。 */
  when?: CheckWhen
}

export const CHECK_TEMPLATES: readonly CommandTemplate[] = [
  {
    id: 'git',
    label: 'trigger.tpl.git',
    desc: 'trigger.tpl.gitDesc',
    command: 'git -C "{workspace}" ls-remote origin -h refs/heads/main',
    when: 'change',
  },
  {
    id: 'url',
    label: 'trigger.tpl.url',
    desc: 'trigger.tpl.urlDesc',
    command:
      'node -e "fetch(\'http://127.0.0.1:3000/health\').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"',
    when: 'success',
  },
  {
    id: 'files',
    label: 'trigger.tpl.files',
    desc: 'trigger.tpl.filesDesc',
    command:
      "node -e \"console.log(require('fs').readdirSync('{workspace}/inbox').sort().join('\\n'))\"",
    when: 'change',
  },
  {
    id: 'port',
    label: 'trigger.tpl.port',
    desc: 'trigger.tpl.portDesc',
    command:
      "node -e \"require('net').connect(5432, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(1))\"",
    when: 'success',
  },
]

export const LISTEN_TEMPLATES: readonly CommandTemplate[] = [
  {
    id: 'watch',
    label: 'trigger.tpl.watch',
    desc: 'trigger.tpl.watchDesc',
    command:
      "node -e \"require('fs').watch('{workspace}/inbox', (event, name) => name && console.log('::trigger:: ' + event + ' ' + name))\"",
  },
  {
    id: 'tail',
    label: 'trigger.tpl.tail',
    desc: 'trigger.tpl.tailDesc',
    command:
      "node -e \"const fs = require('fs'); const f = '{workspace}/app.log'; let at = fs.statSync(f).size; fs.watchFile(f, { interval: 1000 }, (s) => { if (s.size > at) for (const line of fs.readFileSync(f).subarray(at).toString().split('\\n')) if (line.trim()) console.log('::trigger:: ' + line.trim()); at = s.size })\"",
  },
  {
    id: 'script',
    label: 'trigger.tpl.script',
    desc: 'trigger.tpl.scriptDesc',
    command: 'node watch-events.mjs',
  },
]
