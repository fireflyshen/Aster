# Aster

Aster 是一个基于 **Taskwarrior 3**
构建的个人任务与时间工作区 Monorepo：用统一的共享后端整合
**Web（桌面 & 手机）**、**Desktop（Raycast / TinyCast）**、**Go TUI 终端** 与
**MCP（AI / Grok Bot）**
四套客户端，在保留 Taskwarrior 原生存储的同时补齐 Focus、看板分组、嵌套子任务、误删恢复与
**Time Ledger 时间账本**。

---

## 核心特性

1. **统一共享服务端（`modules/server`）**
   - Node.js 22.16+ 原生实现（零第三方运行时依赖），通过 HTTP（Web
     / 本地客户端）与私有 Unix Socket IPC（SSH 远程客户端、MCP、Go
     TUI）对外提供同一套序列化事务与并发门控。
   - **任务执行状态机 & 历史审计**：基于 Taskwarrior
     UDA（`state`、`waitreason`、`statechanged`）与 `state-history.jsonl` 管理
     `planned` / `doing`（最多 5 项）/ `scheduled` / `waiting` / `parked`，支持
     `409 STATE_DOING_LIMIT` 原子替换、依赖阻塞与跨日自动升迁；配套
     [`scripts/migrate-task-state.mjs`](scripts/migrate-task-state.mjs)
     做幂等数据迁移。
   - 统一持久化 **Organization & Habits**：`organization.json`
     队列管理项目树、最多 3 个 Active 的 Focus 目标、看板自定义分栏与排序、saved
     filters（仅保留用户自定义过滤器与标签）、项目与任务 Markdown 说明及颜色；`habits.sqlite`
     存储习惯配置与每日记录，绑定到 Todo 的
     `taskUuid`，并与 Taskwarrior 任务及子任务自动保持同步。
   - **Time Ledger（SQLite WAL）**：独立
     `time.sqlite` + 恢复隔离屏障（`.barrier.json`）管理 24h 时间覆盖（`C + U = T`）、睡眠候选识别、待定位估记、跨小时检查点、两阶段 Taskwarrior 协调事务，以及**时间投入成本**（单一时薪单价、最初/追加预算快照、待核对金额隔离、周/月成本报告与只读 Bills 现金关联）。
   - **基于项目与标签统计**：直接关联 Taskwarrior 已有项目与标签（`projectSnapshot` +
     `tags`），不再强制维护冗余的预制分类；睡眠时段自动按 `¥0`
     计价并免除检查点提醒。
   - **TimingPlan 自动停止机制**：支持「预计用时」+「计划开始」+「最晚停止」的清晰边界，采用
     **手动开始 → 到限自动停止 → 确认或修正记录**
     流程；服务重启仍按原定时限准确结算，不会无故把计划直接变成已执行记录。详见
     [产品设计](docs/time-management-design.md) 与
     [工程契约](docs/time-management-v1-decisions.md)。
2. **极简 Web 应用（`modules/web`）**
   - React 19 + shadcn/ui + Tailwind CSS，默认进入 **「现在能做」（`now`）**
     状态工作区（顶部处理中最多 5 项 + 可折叠计划中/等待中/长期搁置与状态提醒条），支持 Todoist 风格窄列表快速捕捉（`Q`）、行内编辑、树形子任务、List/Board 一体化视图、任务列表与详情内嵌投入成本及预算演化、Data
     & Recovery 备份恢复。
   - 提供极简留白的 **Time
     Ledger（今日时间线 / 本周分布 / 成本报告 / 时间设置）**
     与顶部单行执行条、到限确认与修正弹窗。
   - **习惯管理（Habits，Web 端）**：习惯直接在左侧专属 **「习惯」菜单**
     查看与打卡（不嵌入「现在能做」「今天」「收件箱」「预览」等普通任务列表），与普通任务共用底层 Todo、项目、标签、说明与原生子任务。支持正向打卡、反向习惯（不发生即达成、仅记破例与备注）、可展开动作清单（可选 A/B 训练方案与组/次/重成绩）及统一低饱和灰绿综合热力图。
3. **AI / Grok Bot 接口（`modules/mcp`）**
   - 标准 MCP
     stdio 服务（`@modelcontextprotocol/sdk`），不依赖特定模型 SDK 或 Key，覆盖任务状态机（`task_state_set`
     / `task_schedule` / `task_depends` / `state_summary` /
     `state_history`）、任务规划与看板拆解、**习惯管理（`habit_*`：创建绑定习惯 Todo、日常打卡、动作清单组/次/重与 A/B 切换、反向破例、热力图与补录）**、Time 随手记账、TimingPlan 定时安排与对账摘要。
   - 给 Grok Bot / AI 助手配置 System
     Prompt、项目/标签归类规范、**习惯 Todo 操作与防误删原则**及完整工具清单，请直接阅读
     [`modules/mcp/README.md`](modules/mcp/README.md)。
4. **桌面扩展 & 终端工作台（`modules/desktop` & `modules/tui`）**
   - **Desktop（Raycast / TinyCast）**：提供 `My Tasks`、`Focus & Projects` 与
     `Quick Add Task` 三个命令入口，复用 SSH / 本地共享工作区或原生 Taskwarrior
     3。
   - **Go TUI**：单二进制终端界面，默认进入 **「现在能做」**
     核心视图，支持状态徽章/阻塞标记、`t`
     切换执行状态、上限 5 项替换选择器、宽窄屏自适应布局、Focus/看板管理、实时计时状态与全量备份导出恢复。

---

## 仓库架构

```text
modules/
  core/                    无平台依赖的共用领域内核
    connection/            本机 / SSH OpenSSH 执行器与数据源标识
    habits/                Habit 领域模型、周期调度、动作清单/A/B 映射、连续统计与热力图计算
    tasks/                 Taskwarrior 3 数据模型、状态机规则（state.ts）、过滤解析、Quick Add 与 Timewarrior 导入解析
    time/                  Time Ledger 分类规则、C+U=T 账本计算、快照合并与时区处理
    workspace/             Organization 契约、Focus/看板/子任务模型、恢复/备份与 WorkspaceClient

  server/                  统一服务端（零外部运行时依赖）
    src/
      index.ts             启动组合根、环境装配与默认本地/SSH 模式选择
      transport/           HTTP 服务（静态资源、CSP、/healthz）、路由适配、Unix IPC、并发门控、CLI 维护
      habits/              habits.sqlite 持久化、Taskwarrior 目录同步与 /api/habits/* 路由处理
      tasks/               任务动作、状态机流转/审计/调度（state-*）、看板与 Focus 变更处理器
      organization/        organization.json 版本存储与 Taskwarrior/Time 联动服务
      recovery/            误删恢复快照、全量导出校验、原子恢复与部署前一致性备份
      time/                SQLite Time Ledger、TimingPlan 到限调度器、协调器、导入与备份恢复
    tests/                 71 项服务端单测 + 7 项 HTTP/IPC 真实进程集成测试

  web/                     前端 Web 应用（React + shadcn/ui + Vite）
    shared/                前端复用 DTO 类型导出（@shared/*）
    src/
      app/                 应用骨架、导航、全局快捷键与主题（Light / Dark / System）
      features/            tasks、habits、projects、organization、recovery、time（Today/Weekly/Settings）
      components/          自定义图标与 shadcn/ui 基础组件
      lib/                 HTTP API 请求工具与平台辅助
    tests/                 Web 模型、状态机视图与 Time/Habits API 契约测试

  desktop/                 Raycast / TinyCast 桌面扩展
    src/
      my-tasks.tsx         My Tasks 入口
      projects.tsx         Focus & Projects 入口
      quick-add.tsx        Quick Add Task 入口
      hooks/               useWorkspace / useTaskService / useTaskListActions
      lib/                 列表模型与配色辅助
      ui/                  Raycast 视图、表单与操作菜单组件

  mcp/                     Model Context Protocol (MCP) stdio 服务端
    src/
      index.ts / server.ts / transport.ts
      tools/               helpers / tasks / state / workspace / habits / time / planning 工具分组
    tests/                 基于官方 MCP SDK 的契约、幂等键与故障场景测试

  tui/                     Go Bubble Tea 终端客户端
deploy/                    自托管部署脚本（Docker Compose / systemd / Caddyfile 示例与回滚测试）
docs/                      时间管理产品设计与 V1 工程契约
```

各模块更详细的使用说明：

- [服务端说明](modules/server/README.md)
- [Web 模块说明](modules/web/README.md)
- [MCP 与 Grok Bot 指南](modules/mcp/README.md)
- [TUI 使用指南](modules/tui/README.md)
- [VPS 自托管部署说明](deploy/README.md)

---

## 快速开始

### 1. 环境准备

- **Node.js 22.16+**（需要内置 TypeScript strip-types 与 `node:sqlite`
  `backup()` 支持）
- **Taskwarrior 3**（可安装在本机，或仅安装在你的远程 Linux
  VPS 上通过 SSH 连接）
- 可选：**Go 1.24+**（编译 TUI）、**Raycast / TinyCast**（运行桌面扩展）

在仓库根目录安装依赖：

```sh
pnpm install
npm ci --prefix modules/mcp
npm ci --prefix modules/web
```

### 2. 本地调试 Web + 服务端

```sh
# 方式 A：连接你本机安装的 Taskwarrior 3
SSH_TARGET= npm run dev:web

# 方式 B：通过系统 ~/.ssh/config 别名代理连接远程 VPS 上的 Taskwarrior 3
SSH_TARGET=<your-vps-ssh-alias> npm run dev:web
```

启动后访问 **http://localhost:4180/**（Vite 会将 `/api` 与 `/healthz`
代理到内部运行的 `modules/server`）。

### 3. 启动 MCP（连接 Grok Bot / Claude / Cursor）

```sh
# 本地通过 SSH 隧道复用服务端 Unix Socket：
ASTER_SSH_TARGET=<your-vps-ssh-alias> npm run start:mcp

# 若与 Aster 部署在同一台服务器内，直接配置 ASTER_SOCKET=/opt/aster/data/workspace.sock：
npm run start:mcp
```

完整 Prompt 写法、时间分类规范与工具清单见
[`modules/mcp/README.md`](modules/mcp/README.md)。

### 4. 构建 Go TUI

```sh
cd modules/tui
go build -o ../../dist/tui/aster .
../../dist/tui/aster --ssh <your-vps-ssh-alias>
```

### 5. 运行 Raycast / TinyCast 桌面端

```sh
npm run dev:desktop
```

扩展首选项可在 Raycast 设置中调整 `Connection Mode`（`ssh` / `local` /
`wsl`）、`SSH Target`、`Remote Task Command` 与 `Shared Workspace`
URL（SSH 模式下设 `auto` 会自动经现有 SSH 隧道访问 `WORKSPACE_SOCKET`）。

---

## 自托管部署到个人服务器

别人拉取本仓库后，可以直接部署到任意具备 **Node.js 22.16+** 与 **Taskwarrior 3**
的 Linux VPS：

1. 在服务器上准备 `/opt/aster/data`、参考
   [`deploy/aster.env.example`](deploy/aster.env.example) 创建
   `/opt/aster/aster.env`（设置
   `PUBLIC_ORIGIN`、`ORGANIZATION_FILE`、`TIME_DB_FILE`、`WORKSPACE_SOCKET`
   等）。
2. 参考 [`deploy/aster.service`](deploy/aster.service)（systemd）或 Docker
   Compose 配置守护进程，并参考
   [`deploy/Caddyfile.fragment`](deploy/Caddyfile.fragment)
   配置 HTTPS 反向代理与身份认证（如 Cloudflare Access）。
3. 在本地执行：

```sh
SSH_TARGET=<your-vps-ssh-alias> bash deploy/deploy.sh
```

脚本会自动打包单文件服务端产物 `dist/server/server.mjs` 与静态前端
`dist/web/client/`、在远端执行一致性的预发布备份与校验、切换
`/opt/aster/current` 并检查 `/healthz`；若健康检查未通过则自动回滚。详细步骤见
[`deploy/README.md`](deploy/README.md)。

---

## 桌面快捷捕捉与常用键盘操作

- **My Tasks**：`⌘N` 快速添加、`⌘E` 编辑、`⌘R` 刷新、`⌘O` 查看详情、`⌘Z`
  撤销最近完成或重开、`⌘⇧F` 自定义过滤器、`⌘⇧M` 移动分组、`⌘⇧O`
  在浏览器打开 Web 工作区。
- **Quick Add Task**：支持中英文自然日期表达式与项目/标签/优先级符号，例如：
  ```text
  Submit report tomorrow at 14 #Work @focus p1
  明天下午2点 写周报 #"产品 设计" %设计 p2
  ```
- Web 与 TUI 的完整快捷键说明分别见
  [`modules/web/README.md`](modules/web/README.md) 与
  [`modules/tui/README.md`](modules/tui/README.md)。

---

## 开发与验证

```sh
npm run check                                                   # 全仓 TypeScript 类型检查
npm --prefix modules/desktop run eslint                         # Desktop ESLint 检查
node --experimental-strip-types --test modules/core/tests/*.test.ts  # Core 领域单测
npm test                                                        # deploy + web + build:web + server + mcp 全量测试
(cd modules/tui && go test ./...)                               # Go TUI 单元测试
```
