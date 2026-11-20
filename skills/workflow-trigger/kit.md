# 监视的底子 `kit/watch.mjs`

插件在写要跑命令的卡片、每次跑命令前，把它放进工作流目录的 `triggers/watch.mjs`。脚本放在同一层，直接 `import { … } from './watch.mjs'`，不用自己写进去，也别改它（会被换回去）；要的东西它没有，写在自己的脚本里。只用 Node 自带的模块；别的语言写的脚本用不上它，照 `listen.md` 的规矩自己打事件、记状态。各函数怎么搭配，看 SKILL.md「找示例」里的示例。

| 名字 | 做什么 |
|---|---|
| `emit(text, data)` | 打一行事件（换行换掉，一件事一行） |
| `log(...)` / `warn(...)` | 日志打到标准输出，不触发 / 真出错打到错误输出 |
| `remember(name, initial)` | 数据目录里的一份 JSON 状态：`first` 是不是第一次运行，`value` 当前值，`save(next?)` 存 |
| `seenIds(name?, limit?)` | 处理过的编号：`add(id)` 是新的回 `true`，`has(id)`，`save()` 存 |
| `edges(name?, { confirm })` | 状态变化：`update(key, value)` 变了才回 `{ from, to }`，连着 `confirm` 次一样才认，第一次见只记下；`value(key)` 是现在认下的值 |
| `poll(check, { every, idle })` | 隔 `every` 毫秒查一次，`check` 回真表示有事；连着几轮没事放慢到 `idle`；出错退避重试 |
| `stream(connect)` | 长连接：`connect()` 连上、等到断开才返回；断了退避重连 |
| `getJson(url, { headers, etag })` | GET 一个 JSON 接口，15 秒超时；不是 2xx 抛错；给了上次的 `etag`、没变时回 `{ notModified: true }` |
| `settle(path)` | 等文件写完（两秒不变）回 `true`，文件没了回 `false` |
| `secret(name, what?)` | 读用户放在密钥目录里的令牌、密钥、连接串；没放就写清楚缺什么、放哪，退出 |
| `heartbeat(describe?)` | 每 10 分钟打一句「还在运行」 |
| `injected(handle)` | 试的时候把投进来的样本交给 `handle`（见下） |
| `onStop(fn)` / `sleep(ms)` | 结束前要做的收尾 / 等一会儿 |
| `dataDir` / `secretsDir` | 数据目录（试运行是另一份）/ 密钥目录（真打开和试运行是同一处） |

## 试：投样本

接口、数据库、聊天软件这类远端的事，`poke` 造不出来时投样本：

1. 脚本里处理真事件的那个函数也交给 `injected(handle)`。
2. 照对方真实的数据存一件到 `dir/triggers/samples/<名字>.json`（几件就写成数组；个人信息换成假的，它会随工作流导出）。
3. `test_trigger` 的 `poke` 写 `node "{workflow}/triggers/watch.mjs" inject "{workflow}/triggers/samples/<名字>.json"`，`seconds` 写 5 以上。
4. 看 `events`：一件一行、字段齐全；`run.stderr` 里没有连不上、鉴权失败。

样本只走处理函数，不经过对方；真连接收不收得到，打开之后看「最近的输出」，或请用户真触发一次。
