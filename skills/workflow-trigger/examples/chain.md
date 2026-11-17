# 一个流程跑完接着跑另一个（接续）

`{ "kind": "after", "workflow": "构建" }` 成功后接着发布；再加一张 `{ "kind": "after", "workflow": "构建", "when": "failed" }` 的卡片接到「失败善后」工作流上。要「A 和 B 都跑完才跑 C」时，把它们串成 A → B → C。
