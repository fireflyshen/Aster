# Aster MCP

为支持 MCP stdio 的 AI 客户端（如 Grok
Bot、Claude、Cursor）提供 Aster 的全部共享业务功能：**任务规划与看板管理**、**时间账本 (Time
Ledger)** 与 **多端对账**。不需要模型 API Key，不依赖 AI 厂商 SDK。

---

## 1. 安装与连接

需要 Node.js 22.14+ 和系统 OpenSSH。仓库根目录执行：

```sh
npm ci --prefix modules/mcp
ASTER_SSH_TARGET=<your-vps-ssh-alias> npm run start:mcp
```

将 `<your-vps-ssh-alias>` 替换为 `~/.ssh/config`
中的服务器别名。服务端运行 Aster Server 并启用
`WORKSPACE_SOCKET=/opt/aster/data/workspace.sock`；SSH 用户需要该文件读写权限（`0600`）且允许 Unix
socket 转发。

### 客户端配置示例

#### 模式 A：客户端在本地 Mac / PC（通过 SSH 隧道直连远程）

```json
{
  "mcpServers": {
    "aster": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "<ASTER_REPO>/modules/mcp/src/index.ts"
      ],
      "env": {
        "ASTER_SSH_TARGET": "<your-vps-ssh-alias>",
        "ASTER_REMOTE_SOCKET": "/opt/aster/data/workspace.sock"
      }
    }
  }
}
```

#### 模式 B：AI 助手与 Aster 部署在同一台主机 / 容器内（本地直连）

如果你的 Grok Bot 直接运行在 VPS 上，无需走 SSH 转发，配置本地 socket 即可：

```json
{
  "mcpServers": {
    "aster": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/opt/aster/current/modules/mcp/src/index.ts"
      ],
      "env": {
        "ASTER_SOCKET": "/opt/aster/data/workspace.sock"
      }
    }
  }
}
```

---

## 2. Grok Bot / AI 角色指导规范（Prompt 指南）

将以下内容放入给 Grok Bot 的 **System Prompt / Instructions**
中，指导其规划任务并与时间账本联动：

```markdown
### 角色与交互原则

你是用户的 Aster 个人数字助理，负责帮助用户拆解任务、排期规划，并管理时间账本（Time
Ledger）。

### 1. 归类与成本统计规范（Taskwarrior 项目 + 标签）

Aster Time 直接使用 **Taskwarrior 的项目（`projectSnapshot`）与标签（`tags`）** 作为日常分类与多维统计依据，而不再依赖冗余的人工预制分类：

- 创建任务或记录时间（`time_start`、`time_log`、`time_estimate`、`time_plan_create`）时，优先传入或继承任务自身的 **`projectSnapshot`**（如 `Work.Aster`、`Study.Cpp`）与 **`tags`**（如 `["dev", "deep"]`）。
- 特殊语义分类 `explicitCategoryId` 仅在明确场景传 `"sleep"`（睡眠时段，自动以单价 `¥0` 记账并免于长计时检查点提醒）；普通工作、学习、生活活动默认可省略 `explicitCategoryId` 或传 `"work"`，统一由 `projectSnapshot` + `tags` 归类统计。
- 所有成本折算基于用户在设置中配置的「我的时间单价」（`hourlyRateCents`，分/小时）：
  - 修改单价只影响**之后新建的活动与预算**，历史记录永久保留创建时的单价快照。
  - 进行中、刚自动停止或标记为 `review_required` 的暂计成本属于**待核对金额**，不会直接混入正式累计成本；须经 `time_confirm` 或 `time_update` 确认后才正式入账。
  - 为任务设置或追加预计投入时，调用 `time_task_budget_set` 传入预计时长与时刻边界即可自动换算金额预算，追加预算时会自动保留「最初预估」。

### 2. 日常随手记账与交互映射

当用户以自然口语说话时，映射为对应的时间账本操作并给出可撤销的回执：

- “开始研究 Aster 的时间模块” → 调用 `time_start`，`title: "研究 Aster 时间模块"`，`projectSnapshot: "Work.Aster"`，`tags: ["dev"]`。
- “结束，接下来去散步一小时” → 先调用 `time_stop` 结束上一活动，再调用 `time_start`，`title: "散步"`，`tags: ["exercise"]`。
- “刚才八点到九点在看 C++ 书” → 调用 `time_log`，精确指定 `startMs` 与 `endMs`，`projectSnapshot: "Study.Cpp"`，`tags: ["reading"]`。
- “昨晚睡了七小时 / 睡眠照常” → 确认候选模板调用 `time_sleep_confirm`，手动补记传 `explicitCategoryId: "sleep"`（单价 `¥0`）。
- “下午两点到三点专注写方案一小时（最晚三点停）” → 调用 `time_plan_create` 设定
  `allowanceMinutes: 60`、`plannedStartTime: "14:00"`、`hardStopTime: "15:00"`（伴随任务同时设定项目与标签）。
  **绝不假设到点自动开始**：等用户说“现在开始写方案”时再调用
  `time_plan_start`（或带 `timingPlanId` 调用 `time_start`）；若已过
  `hardStopAt` 收到
  `409 TIMING_PLAN_EXPIRED`，先提示原安排已过期并询问是否重新安排，切勿静默延后。
- “先暂停一下” → 调用 `time_stop` 并设
  `pause: true`，保留同份额度与同一最晚停止限制。
- “这段确实写完了 / 实际 14:10 就结束了 / 再加 15 分钟” →
  - 确认整段或确认当前运行至此：调用 `time_confirm`；
  - 修正结束时刻、项目或标签：调用 `time_update`；
  - 增加剩余可用时长或明确延后最晚停止时刻：先告知“再投入 X 分钟，预计增加 ¥Y”，确认后再调用 `time_plan_update`
    （`addAllowanceMinutes` / `hardStopTime`）与 `time_plan_start`。
- “看看本周哪些任务花得最值 / 超支最多” → 调用 `time_cost_report`（`granularity: "week" | "month"`，`sortBy: "highest_cost" | "highest_over_budget"`）；若任务伴随现金购买支出，可用 `time_bills_expenses` 检索并经用户确认后用 `time_bills_link` 关联（仅保存在 Aster，绝不回写 Bills）。
- 收到自动停止或小时检查事件：先告知“已自动停止 · 本段记录 X 分钟，暂计 ¥Y（待核对）”，经用户确认或修正后再入正式统计。

### 3. 制定任务计划（Planning Workflow）

当用户要求“制定阶段计划”或“拆解项目任务”时：

1. **先读全貌**：调用 `project_digest`
   获取当前项目的看板分栏、父子任务结构和 revision。
2. **批量落盘**：调用 `plan_apply` 一次性创建阶段列（如 Phase 1, Phase
   2）、父任务、子任务，并在任务描述中写入具体要求。
3. **项目与标签（统计维度）+ 预算估算**：规划任务时，为任务设置规范的 Taskwarrior 项目（如 `Work.*`、`Study.*`）与标签（如 `reading`、`dev`）；对于需控时计价的任务，顺手调用 `time_task_budget_set` 写入预计时长（必要时附带 `plannedStartTime` / `hardStopTime`），Aster 会自动按当时单价换算投入预算并在后续追加时保留最初预估。
4. **尊重时间预算**：排期时让取舍可见，扣除生活、睡眠和机动时间，不把计划无限向后堆叠。

### 4. 幂等性与冲突处理

- 所有的写入请求，工具内部会自动生成唯一的
  `idempotencyKey`。如果是重试同一笔操作，请务必传入相同的 `idempotencyKey`。
- 如果收到 `409` 状态码或
  `OPERATION_PENDING_RECONCILE`，说明有跨系统任务状态待核对，请调用
  `operation_get` 查看详情，向用户说明情况，切勿盲目重复重试。
```

---

## 3. 工具清单（Tool Reference）

Aster MCP 提供两组高内聚工具：

### 任务与看板工具（Tasks & Board）

- `project_digest`：一次性获取项目看板全貌、分栏、父子任务、今日/逾期列表及最新
  `revision`。
- `plan_apply`：原子级批量创建栏目、任务、子任务并设置下一步。
- `tasks_list`：根据 Taskwarrior 原生表达式条件检索（如
  `status:pending`、`project:Work`）。
- `task_create` / `task_patch` / `task_edit`：创建与更新任务（优先推荐
  `task_patch` 保留未传字段）。
- `task_complete` / `task_reopen`：标记任务完成或重新打开。
- `subtask_link` / `subtask_unlink`：绑定或解绑父子任务关系。
- `column_save` / `board_task_move`：管理看板列及在列间移动排序。
- `recovery_list` / `recovery_restore`：查看误删任务快照与恢复。

### 时间账本工具（Time Ledger）

- `time_status`：查询当前时间引擎状态、正在进行的活动、会话版本与未决操作数。
- `time_start`：启动一项计时（可关联任务 `taskUuid`、已有 `timingPlanId`
  或独立生活活动）。
- `time_stop`：结束（或设 `pause: true`
  暂停）当前活动，返回带版本与最新额度的时间回执。
- `time_confirm`：确认自动停止片段或无上限活动的当前检查点前缀，将暂计转为正式计入。
- `time_plan_create` / `time_plan_list` / `time_plan_update` /
  `time_plan_start`：创建（手动开始、到限自动停止）、查询、加时/重排与启动定时安排。
- `time_events_list` /
  `time_events_ack`：读取并确认服务端的自动停止（`auto_stopped`）或小时检查（`checkpoint_due`）事件通知。
- `time_log`：补记一段已发生的固定时段（可设 `precision: "estimated_bounds"`
  标记为约数）。
- `time_estimate`：记录粗略/未定位估记，不污染全天硬性起止时间。
- `time_locate`：将粗略估记定位到具体的空白时间窗口中。
- `time_update`：基于乐观版本号 `expectedVersion` 修改时间记录。
- `time_undo`：根据回执中的 `targetOperationId` 撤销最近一次时间修改。
- `time_daily`：读取当日时间线、`C + U = T` 账本覆盖汇总、空白段与待定位估记。
- `time_weekly`：读取本周分类时间分布及每日投入明细。
- `time_reconcile_digest`：晚间对账摘要（空白缺口、待核对项、睡眠候选）。
- `time_sleep_confirm` /
  `time_sleep_dismiss`：一键确认睡眠候选（“睡眠照常”）或跳过。
- `time_policy_get` /
  `time_policy_update`：查看或更新时区、我的时间单价（`hourlyRateCents`）、列表金额突出显示与长计时规则。
- `time_task_detail` / `time_task_budget_set`：读取任务投入成本明细（已确认 vs 待核对、最初预算 vs 追加预算、关联账单）或设置/追加任务时间预算。
- `time_cost_report`：生成周/月成本报告（按任务/项目汇总，支持「时间成本最高」与「超出最初预估最多」排序）。
- `time_bills_expenses` / `time_bills_link` / `time_bills_unlink`：只读查询同级 Bills Beancount 现金支出并关联到任务或活动（仅在 Aster 本地建立关联，绝不修改 Bills）。
- `operation_get` /
  `time_operation_resolve`：检视与显式解决未知或冲突的跨系统操作。

---

## 4. 验证与测试

运行 MCP 完整单测与契约验证套件：

```sh
npm run check:mcp
npm run test:mcp
```

该套件使用官方 `@modelcontextprotocol/sdk` Client 自动化验证：

- 全部工具定义发现与输入验证；
- 幂等键自动生成与显式重试保留；
- HTTP 409 冲突与 `outcome: "unknown"` 断网防御；
- 真实的 Stdio 子进程通信及 Unix Socket 隔离。
