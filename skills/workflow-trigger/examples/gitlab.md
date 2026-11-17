# GitLab Webhook（HTTP）

1. 建卡片 `{ "kind": "http" }`，`local.hook` 起个好认的名字（如 `gitlab-mr`）。
2. GitLab 项目「设置 → Webhooks」：网址填卡片的地址并在后面加 `?token=<令牌>`（GitLab 的「Secret token」放在 `X-Gitlab-Token` 请求头里，插件不认这个头）；勾选要的事件。
3. GitLab 要能连到这台机器：插件设置里的监听地址改成 `0.0.0.0` 或本机网卡地址。
4. 按事件筛：GitLab 的请求体里有 `object_kind`（`push`、`merge_request`、`pipeline`…）。用 `filter.include` 写一段稳定的原文，如 `"object_kind":"merge_request"`；更细的（只要 `opened`、只要某个分支）写进触发条件，或在工作流第一步判断。
5. GitLab 的请求体有几 KB，大半用不上，照收即可：超过 4000 字时消息里只放开头，执行的模型去读全文。
6. 试：`test_trigger` 的 `body` 用 GitLab 文档里对应事件的样例，或在 GitLab 的 Webhook「最近的事件」里复制一份真实的。
7. 会改仓库的审核、修复类工作流，`launch.overlap` 用 `queue`。
