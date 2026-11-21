# 远端有新提交，审核这一段（定时检查）

每 5 分钟，`when: "every"`，看会话工作区里的仓库（命令里的 `{workspace}`）。脚本记下上次看到的提交，有新的就打出这一段的提交列表。

```json
{ "kind": "schedule", "schedule": { "kind": "every", "seconds": 300 }, "check": { "command": "node new-commits.mjs \"{workspace}\" origin main", "when": "every" } }
```

```js
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [repo, remote = 'origin', branch = 'main'] = process.argv.slice(2)
const stateFile = join(process.env.TRIGGER_DATA_DIR ?? '.', 'last-commit.txt')
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 60_000 }).trim()
try {
  git('fetch', '--quiet', remote, branch)
} catch (error) {
  console.error(String(error))
  process.exit(2)
}
const head = git('rev-parse', `${remote}/${branch}`)
const last = existsSync(stateFile) ? readFileSync(stateFile, 'utf8').trim() : ''
writeFileSync(stateFile, head)
if (last === '' || last === head) process.exit(1) // 第一次只记下；没有新提交
const log = git('log', '--format=%h %an %s', `${last}..${head}`)
console.log(JSON.stringify({ from: last, to: head, commits: log.split('\n') }))
```

只要知道「变了没有」、不需要列出提交时更简单：命令写 `git -C "{workspace}" ls-remote origin -h refs/heads/main`，`when: "change"`。
