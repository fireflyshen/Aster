# Aster · Server

Aster 的统一后端服务模块（Node.js 22+ 原生模块，无第三方运行时依赖），同时为 Web、Desktop（Raycast / TinyCast）、MCP 与 Go TUI 提供单一共享服务端与持久化队列。

## 传输层与安全模型

所有接口定义收敛在 `src/workspace-api.ts`：

- **公网 HTTP（`src/task-routes.ts` / `src/index.ts`）**：生产模式强制校验 Cloudflare Access JWT（`src/auth.ts`）、严格 `PUBLIC_ORIGIN` / JSON 头校验与 CSP；静态文件目录按 `CLIENT_ROOT` → `./client/`（生产环境 `/opt/aster/current/client/`）→ `../web/client/` 顺序解析。
- **私有 Unix Socket IPC（`src/workspace-ipc.ts`）**：绑定 `WORKSPACE_SOCKET`（如 `/opt/aster/data/workspace.sock`，`0600` 权限，仅限本地或经现有 SSH 隧道访问），不监听 TCP 端口，校验 `X-Aster-Source` 数据源身份并与 HTTP 请求共用同一并发读写门控（`src/workspace-gate.ts`）及 `organization.json` 修订队列。

## 命令（在仓库根目录执行）

```sh
npm run dev:server     # 以 TypeScript 源码直接运行服务端（SSH_TARGET=dmit）
npm run check:server   # TypeScript 类型检查
npm run build:server   # 打包单文件产物 dist/server/server.mjs
npm run test:server    # 单元测试 + 构建 + HTTP/IPC 集成测试
```
