# 写脚本

检查命令、监视程序都按这里写。先按 SKILL.md 的「找示例」挑一份示例照着改；下面是示例都守着的规矩，改的时候别改掉。

- 推荐用 Node、Python 这类脚本语言写，放进卡片目录（`read` 卡片的 `local.cardDir`，即 `dir/triggers/<卡片 id>/`；随工作流导出、存版本）。命令缺省就在这个目录里跑，写成 `node xxx.mjs 参数…`（Python 就是 `python xxx.py …`）。没有特别的理由就用 Node：DSH 网页版自带，底子和示例也是它；用户有现成的脚本、习惯别的语言，或机器上确定装了 Python，用那个也行。`tail`、`grep` 这类在 Windows 上不一定有。
- 用户工作区里的文件、仓库：命令参数里写 `{workspace}/…`（运行时换成会话工作区），或在脚本里读环境变量 `TRIGGER_WORKSPACE`；别写死本机的绝对路径（带到别的机器上就不对了），也别靠当前目录找。工作流目录是 `{workflow}`、环境变量 `WORKFLOW_DIR`。
- 监视程序用底子 `../watch.mjs`（插件放在 `dir/triggers/`，`kit.md`）：事件行、状态文件、退避、重连、超时都在里面，脚本只写「去哪拿事件、一件事怎么写成一行」。
- 脚本自己要记的（上次看到的编号、处理过哪些、上一次的值）放数据目录（底子的 `dataDir`，环境变量 `TRIGGER_DATA_DIR`）：每张卡片一个；`test_trigger` 用另一份，试的时候记下的不影响真打开后的。只记和本机无关的东西，不记本机路径、进程号、本机时刻。别放卡片目录的别处或工作区（弄脏用户的仓库）。
- 状态文件不存在就是第一次运行：只记下现状、不触发（检查命令返回 1，监视程序只打一句日志）。
- 密钥、令牌、连接串不写进脚本或命令：请用户放进这张卡片的密钥目录（`read` 卡片的 `local.secretsDir`），脚本用底子的 `secret` 读，并告诉用户放哪个文件。真打开和 `test_trigger` 读的都是它。
- 逻辑放在脚本里，命令只留「解释器 + 脚本 + 参数」。像 `node "./check.mjs"` 这样的命令可以跟随默认。
- 命令用了 Bash 语法、PowerShell cmdlet 或 cmd 的 `%VAR%` 等专有写法时，从 `triggerShells.shells` 找对应程序，把完整 `path` 写到卡片的 `local.shell`。PowerShell 7 专用语法选 `pwsh.exe`，Windows PowerShell 5.1 用 `powershell.exe`。编辑已有卡片时先看 `local.shell`，命令适用就保留原来的选择。`poke` 也用同一个 shell。保存后用 `test_trigger` 验证。
- 要第三方库时在卡片目录放依赖清单（`package.json`、`requirements.txt`）并装好。
- 检查命令：退出码 0 是满足、1 是不满足，出错用 2 以上；要打日志就把交出去的那几行写成 `::trigger::` 开头，有这种行时只有它们是背景信息、拿来比较。
- 网络请求都要设超时。
