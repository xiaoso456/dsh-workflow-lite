---
title: 安装
description: 在 DeepSeek Harness 的网页版或桌面端安装插件。
sidebar:
  order: 1
---

支持 DeepSeek Harness 0.2.x。

## 网页版

需要 Node.js 22 及以上。

```bash
dsh plugin --profile web add @xiaoso/dsh-workflow-lite
dsh web
```

## 桌面端

1. 打开侧边栏的「插件」，点击「添加插件」→「安装第三方插件」。
2. 填入 `@xiaoso/dsh-workflow-lite`，点击「安装」。
3. 重启 DeepSeek Harness。

安装成功后，会话页顶部出现「工作流」标签页。没有出现时见[常见问题](/dsh-workflow-lite/faq/)。

下一步：[创建第一个工作流](/dsh-workflow-lite/start/first-workflow/)。
