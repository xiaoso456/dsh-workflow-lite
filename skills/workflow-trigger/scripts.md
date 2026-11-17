# 写脚本

检查命令、监视程序都按这里写。

- 用 Node 写，命令写成 `node "{workflow}/triggers/xxx.mjs" 参数…`。DSH 网页版会把自带的 Node 放进 PATH；桌面版要用户装了 Node（找不到时 `test_trigger` 会报「找不到命令」，这时请用户装 Node）。`tail`、`grep`、Python 在 Windows 上不一定有。
- 脚本放进工作流目录的 `triggers/` 下：随工作流一起导出、存版本。`{workflow}` 运行时换成这个目录（用 `/` 分隔），环境变量 `WORKFLOW_DIR` 也是它。
- 脚本自己要记的东西（上次看到的提交、处理过的文件、已经跑过的标记）建议放进环境变量 `TRIGGER_DATA_DIR` 给的目录。它是每张卡片单独的、只在这台机器上、不导出；`test_trigger` 给的是另一个目录，试的时候记下的不影响真打开后的。别放进工作流目录（会被导出到别人那里）或工作区（会弄脏用户的仓库）。
- 状态文件不存在时就是第一次运行：记下现状、不触发（检查命令返回 1，监视程序不打行），别把历史上的全部当成新的。
- 密钥、令牌不要写进脚本或命令（会随工作流导出）：请用户放进环境变量或 `TRIGGER_DATA_DIR` 下的文件，脚本去读；没有就往错误输出写清楚缺什么、退出非 0。
- 命令由卡片上选的 shell 运行；没选用插件设置里的默认 shell，那里也没设就是系统的（Windows 是 cmd，别的是 sh）；也可能是 PowerShell、Git Bash，`read` 卡片的 `local.shell` 能看到是哪个。路径一律加双引号；cmd 里别用单引号包参数、别用 `%`；sh、PowerShell 里双引号中的 `$` 会被展开。逻辑都写进脚本，命令只留 `node "{workflow}/triggers/xxx.mjs" 参数`，就不用管是哪种 shell。
- 要第三方库时在 `dir/triggers/` 放 `package.json` 并装好依赖（`npm install` 在那个目录里跑）。
- 监视程序里，只让要触发的那一行走标准输出。第三方库常用 `console.log` 打日志，开头先改道：

```js
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
console.log = console.info = console.debug = console.error // 别的输出都去错误输出
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
```

- 网络请求要设超时、出错写到错误输出；检查命令出错时退出码用 2 以上，和「不满足」的 1 区分开，人看最近的输出时分得清。
