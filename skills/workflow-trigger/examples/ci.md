# CI 跑完通知（HTTP）

在 CI 的最后一步加一条 `curl`（令牌放进 CI 的密钥变量）：

```sh
curl -X POST "http://<主机>:3791/trigger/<hook>" -H "Authorization: Bearer $WL_TOKEN" -H "Content-Type: application/json" -d "{\"pipeline\":\"$CI_PIPELINE_ID\",\"status\":\"$CI_JOB_STATUS\"}"
```

只在失败时处理：过滤 `include: ["\"status\":\"failed\""]`。
