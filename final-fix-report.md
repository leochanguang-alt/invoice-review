# Atomic invoice numbering：最终分支修复报告

## 范围与状态

本轮完成最终审查清单 C1、C2、I3、R2、I4、I5、I6、I8、I7 及指定 Minor 修复。

全程仅修改本地分支、生成 SQL 文本并运行本地测试/语法检查。未连接或修改远程 Supabase，未应用迁移，未执行生成的 freeze/finalize/rollback/unfreeze SQL，未访问、复制或删除生产 R2 对象。

## 修复摘要

- Manifest 每行新增并严格校验 `oldGeneratedInvoiceId`、`oldAchievedFileLink`、`oldProjectSequence`（均允许 `null`），三个字段纳入 canonical digest。
- 新增 fail-closed `--rollback-sql`，守卫固定项目、项目冻结、35 个 active 行及当前新 sequence/generated ID/key/link；先统一清空 sequence，再恢复全部旧值；counter 只用 `greatest(current, 35)` 保持不回退。
- 新增 `--freeze-sql` / `--unfreeze-sql`，只打印带单行 row-count 守卫的 SQL；finalize guarded SQL 强制项目 `archived = true`。
- Cleanup 保留 `--db-verified` 和 35 个 final 对象 Head 校验，并新增脚本自身的 Supabase 35 行逐项校验；`project_sequence`、`generated_invoice_id`、`achieved_file_id` 任一不符时 Delete 数为零。
- `/api/expenses` 改为稳定双排序的 `range()` 分页，完整读取超过 1000 行的数据；任一分页错误立即中止。
- Reservation RPC 拒绝 archived 项目；生成新 ID 后、写入前拒绝同项目其他行已占用该 generated ID。
- R2 copy 前先 Head target：不存在才 Copy；已存在时仅在 size 以及源端可用 ETag/checksum 均匹配时作为幂等成功，否则拒绝覆盖。
- Manage 编号 reset 成功后返回 HTTP 200、`code: INVOICE_SEQUENCE_RESET`、`sequenceReset: true`、`archiveRetained: true` 和明确 warning；两个前端保存入口都会弹窗说明，不把已写入操作谎报为失败。
- CSV 导出删除 generated invoice ID 猜测路径，只接受持久化的 `achieved_file_id` / `achieved_file_link`；存在缺档案行时在下载前中止并提示。
- Reject invoices 用 `.limit(2)` 检出 generated ID 歧义，拒绝多行场景并继续只按唯一数据库 `id` 更新。
- Reservation 适配器拒绝空 RPC 响应，并在 RPC 前将 record ID 规范为安全正整数。
- 项目下拉 option 的 value/label 统一 HTML escaping。
- 同日 manifest 的排他创建遇到 `EEXIST` 时，明确提示审核并以 `--manifest` 复用现有文件。

## TDD 证据

新增测试均先观察到预期 RED：

- Manifest/rollback/freeze/cleanup：首次因 `generateFreezeSql` 等导出不存在而失败。
- Expenses 分页：首次因 `fetchAllExpenses` 导出不存在而失败。
- R2/RPC：首次出现 target 未 Head、archived/duplicate guard 缺失的 6 项失败。
- UI/适配器/escaping/EEXIST：首次出现 7 项预期失败，包括空 RPC 解引用、字符串 record ID 未规范化、无 reset warning、无 escaping 和 writer 导出缺失。

最小实现后分别转为 GREEN，并最终运行完整测试套件。

## 最终验证

```text
npm test
tests 86
pass 86
fail 0
```

```text
node --check api/expenses.js
node --check api/manage.js
node --check lib/invoice-archive.js
node --check lib/invoice-number-reservation.js
node --check public/app.js
node --check public/project-options.js
node --check scripts/renumber-project-invoices.js
```

以上语法检查全部 exit 0。`git diff --check` exit 0，IDE lint 0 errors。

## 未解决风险与上线前事项

- 按禁止生产操作的要求，迁移及生成 SQL 只做了静态契约测试，尚未在隔离 PostgreSQL/Supabase 实例实际解析执行；上线前必须在隔离数据库验证权限、锁、唯一索引两阶段置换和异常回滚。
- S3/R2 的 “Head target 不存在后再 Copy” 是两次请求，存在理论 TOCTOU 窗口；当前实现符合指定流程，但底层 `CopyObject` 没有通用的 target `If-None-Match` 原子创建条件。生产执行必须保持项目冻结和单一迁移执行者。
- Rollback SQL 只恢复数据库字段且刻意不回退 counter，也不会删除新 R2 对象；对象清理由独立、显式且带数据库/R2 双重校验的 cleanup 流程处理。
- Cleanup 的数据库验证与逐对象 Delete 之间不是跨 Supabase/R2 的分布式事务；项目冻结及单执行者仍是必要操作条件。
- 测试输出包含仓库既有的 npm `devdir` 弃用提示和缺少测试环境 Supabase 变量提示，不影响 86/86 测试结果。

---

## 最终签核阻塞修复追加

### 修复内容

- 共享导出 `isSinglePartContentETag`：只有 32 位十六进制单段 ETag
  作为 content ETag 强比对；multipart/opaque ETag 跳过 ETag 比对，但
  size 与可用 checksum 仍必须一致。归档 helper、迁移 stage/final/verify/
  rollback 使用同一判断。
- CSV 改为只输出 `Submitted` 且具有真实 `achieved_file_id` 或可解析
  `achieved_file_link` 的行。在途或缺路径行被跳过，下载继续，并在前端
  alert 明确 skipped 数量；不存在 generated ID 猜路径 fallback。
- 迁移新增 `projects.numbering_frozen boolean not null default false`。
  Reservation RPC 对 project 行取得 `FOR SHARE` 锁并拒绝冻结编号；
  freeze/unfreeze、forward guarded SQL 与 rollback SQL 全部改用
  `numbering_frozen`，不再修改或依赖业务 `archived` 状态。
- Freeze SQL 可直接以 `--project Neoss-MoEx-2608 --freeze-sql` 生成，
  不依赖 manifest；unfreeze 支持 project 或 manifest。Help 与 runbook
  明确 freeze 必须是第一步、unfreeze 必须是最后一步。
- Manifest 升级为 version 2，顶层保存规范化 `publicUrl` 并纳入 digest。
  Finalize/guarded/rollback URL 必须与 manifest 完全一致；数据库校验新增
  `achieved_file_link` 精确比对。
- `--rollback-sql` 在输出任何 SQL 前 Head 全部 35 个 old key，并按
  manifest 验证 size、单段 content ETag 与可用 checksum。Cleanup 删除
  old key 后 rollback 会 fail closed；文档明确 cleanup 前才是 rollback
  窗口。
- Reservation RPC 在同一 project/counter 锁事务内循环分配候选号。若
  generated ID 已被同项目其他行占用，会继续递增 counter；最多尝试
  1,000 次，超过上限才失败，避免事务重试永久命中同号。
- Expenses API 改为 `id DESC` keyset pagination，后续页使用
  `id < lastId`；校验 cursor 严格递减，并以默认 10,000 页上限
  fail closed，避免 offset 在并发插入下漏行或异常响应造成无限循环。
- Design spec 与 implementation plan 已写入完整
  freeze → dry-run → stage → finalize → DB → verify/smoke test → cleanup
  → unfreeze 顺序，以及 cleanup 前 rollback 窗口。

### TDD 记录

- 首轮新增回归测试出现 10 个预期失败：keyset API 仍调用 `range`、
  CSV helper 不存在、RPC 仍使用 `archived` 且碰撞直接 raise、
  rollback preflight 与共享 ETag helper 尚未导出。
- 最小实现后，针对性测试 67/67 通过；随后新增 dry-run freeze 前置门
  RED→GREEN 回归。
- 完整测试套件 94/94 通过。

### 最终验证

```text
npm test
tests 94
pass 94
fail 0
```

全部改动 JavaScript 文件通过 `node --check`；`git diff --check` exit 0；
IDE lint 0 errors。

### 仍需上线前验证

- 按要求未连接生产 Supabase/R2，也未应用迁移或执行生成 SQL。必须先在
  隔离 PostgreSQL 验证 `FOR SHARE` 与 freeze update 的锁互斥、循环计数器、
  两阶段序号置换和 rollback 异常回滚。
- R2 Head-then-Copy 仍是两个请求，存在底层 API 无 target create-only
  条件导致的理论 TOCTOU；生产流程必须保持 numbering freeze 和单执行者。
- Cleanup 的数据库验证、R2 final Head 与 Delete 无法组成跨系统事务；
  cleanup 必须最后执行，并被视为明确放弃 rollback 的不可逆门。
