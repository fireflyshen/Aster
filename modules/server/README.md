# Aster · Server

Aster 的统一后端服务模块（Node.js 22.16+ 原生模块，无第三方运行时依赖），为 Web、Desktop（Raycast / TinyCast）、MCP 与 Go TUI 提供单一共享工作区、任务队列与 Time Ledger 引擎。

## 模块结构

```text
src/
  index.ts                 启动组合根与环境变量装配
  transport/               HTTP 服务（静态资源、CSP、/healthz）、路由适配、Unix Socket IPC、并发门控与校验
  tasks/                   任务动作、看板分栏变更、Focus 目标状态变更
  organization/            organization.json 原子修订队列与 Taskwarrior/Time 联动服务
  recovery/                误删恢复日志、全量备份校验、恢复调度与部署前一致性备份
  time/                    SQLite WAL Time Ledger、TimingPlan 到限自动停止调度器、协调器、导入与备份
```

## 传输层与安全模型

所有工作区业务接口收敛在 [`src/transport/workspace-api.ts`](src/transport/workspace-api.ts)：

- **HTTP（`src/transport/http-server.ts` / `src/transport/http-adapter.ts`）**：
  - 所有 `POST /api/*` 强制校验 `Origin === PUBLIC_ORIGIN` 且 `Content-Type` 为 `application/json`；
  - 默认响应头设置 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、严格 `Content-Security-Policy` 与 `frame-ancestors 'none'`；
  - 静态资源目录按 `CLIENT_ROOT` → `./client/`（发布打包模式）→ `../web/client/` 解析；
  - 公网访问建议放置在反向代理 / Cloudflare Access / VPN 之后（由代理层负责身份认证）。
- **私有 Unix Socket IPC（`src/transport/workspace-ipc.ts`）**：
  - 可选绑定 `WORKSPACE_SOCKET`（如 `/opt/aster/data/workspace.sock`，`0600` 权限，进程 `umask 0077`），不监听额外 TCP 端口；
  - 校验 `X-Aster-Source` 数据源身份，并与 HTTP 请求共用同一并发门控（`src/transport/workspace-gate.ts`）及序列化事务队列。

## 关键环境变量

| 变量                | 默认值                                 | 说明                                        |
| ------------------- | -------------------------------------- | ------------------------------------------- |
| `HOST` / `PORT`     | `127.0.0.1` / `4180`                   | HTTP 监听地址与端口                         |
| `PUBLIC_ORIGIN`     | `http://localhost:4180`                | 允许的浏览器写操作 `Origin`                 |
| `SSH_TARGET`        | `undefined`（`dev` 默认传值）          | 设置后经由系统 OpenSSH 代理 `task` 命令     |
| `WORKSPACE_LABEL`   | `SSH_TARGET` 大写或 `LOCAL`            | 工作区展示标识                              |
| `TASK_COMMAND`      | `/usr/local/bin/task`                  | Taskwarrior 3 可执行文件路径                |
| `TASKRC`            | SSH 模式默认 `/etc/taskwarrior/taskrc` | Taskwarrior 配置文件路径                    |
| `ORGANIZATION_FILE` | `data/organization.json`               | 组织资料路径（决定默认数据目录 `dataDir`）  |
| `RECOVERY_FILE`     | `<dataDir>/recovery.json`              | 误删任务恢复快照路径                        |
| `TIME_DB_FILE`      | `<dataDir>/time.sqlite`                | Time Ledger SQLite 数据库路径               |
| `TIME_ENABLED`      | `1`                                    | 设为 `0` 可关闭时间账本与自动停止调度       |
| `WORKSPACE_SOCKET`  | 未启用                                 | 私有 Unix Socket IPC 监听路径（供 MCP/TUI） |
| `CLIENT_ROOT`       | 自动探测                               | 显式覆盖前端静态构建目录                    |

## 命令（在仓库根目录执行）

```sh
SSH_TARGET=<your-vps-ssh-alias> npm run dev:server   # 连接远程 VPS 调试服务端
SSH_TARGET= npm run dev:server                       # 连接本机 Taskwarrior 调试服务端
npm run check:server                                 # TypeScript 类型检查
npm run build:server                                 # 打包单文件产物 dist/server/server.mjs
npm run test:server                                  # 单元测试 + 构建 + HTTP/IPC 集成测试
```
