# Aster MCP

为支持 MCP stdio 的 AI 客户端提供 Aster 的全部共享业务功能。设计、覆盖矩阵和失败语义见 [DESIGN.md](DESIGN.md)。不需要模型 API Key，不依赖 AI 厂商 SDK。

## 安装与连接

需要 Node.js 22.14+ 和系统 OpenSSH。仓库根目录执行：

```sh
npm ci --prefix modules/mcp
ASTER_SSH_TARGET=dmit npm run start:mcp
```

`dmit` 只是当前仓库的默认部署示例，按实际 SSH config 别名替换。先在终端验证主机指纹及密钥登录；MCP 使用 BatchMode，不弹密码窗口。服务器需要运行现有 Web 服务并启用 `WORKSPACE_SOCKET=/opt/aster/data/workspace.sock`；SSH 用户需要该文件的访问权限（0600）。服务器需允许 Unix socket 转发（OpenSSH AllowStreamLocalForwarding）。模块会建立临时本机 socket，退出时关闭 SSH 转发。无需在服务器安装 MCP 包或新增公网端口。

支持 MCP stdio 的客户端可使用下面的配置，替换为本机绝对路径；`node` 需要在该客户端的 PATH 中，也可以填写 Node 可执行文件的绝对路径：

```json
{
  "mcpServers": {
    "aster": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/Users/enmu/nexus/flowspace/Aster/modules/mcp/src/index.ts"
      ],
      "env": {
        "ASTER_SSH_TARGET": "dmit",
        "ASTER_REMOTE_SOCKET": "/opt/aster/data/workspace.sock"
      }
    }
  }
}
```

也可以设置 `ASTER_SOCKET=/absolute/path/workspace.sock` 直接访问本地或已转发的 socket，此时忽略 SSH 配置。只配置连接你打算授权给 AI 使用的工作区；工具可以修改任务并执行数据恢复。

## 使用约定

1. 先 `workspace_get` 读取项目、Focus、标签、过滤器、栏目、精力和 revision。
2. `tasks_list` 支持 Taskwarrior 条件；例如 `status:pending`、`status:waiting`、`due:today`、`project:Work`、`project:`（Inbox）、`description.contains:报告`。默认返回未完成和已完成任务；已删除任务用 `recovery_list`。
3. 编辑任务先 `task_get`，复制返回的 `editInput` 并修改目标字段，再传给 `task_edit`。这是完整编辑，省略 project/due/priority 会清空对应字段。现有备注、依赖和其他未支持编辑的原生属性由业务服务保留；`note` 是新增备注，不要把原有备注再次提交。
4. 组织资料写入传入刚读取的 revision。成功返回最新资料和 revision；409 冲突应重新读取并核对意图，不自动覆盖。
5. 日期输入为 UTC `YYYYMMDDTHHmmssZ`，空字符串表示清除。`quick_preview` 用服务器时区解析一句话，返回 task/tokens/errors；检查后再创建。
6. 栏目移动不改变完成状态；项目完成也不完成其任务。撤销完成/重开分别用 task_reopen/task_complete；撤销移动需要读取最新 revision 后显式移回。
7. 备份：`backup_export` 获取 JSON，`backup_preview` 接收 `{ "backup": <完整 JSON> }` 并返回范围、警告和令牌；核对并取得用户确认后 `backup_restore` 接收 `{ "token": "...", "confirmation": "RESTORE" }`。令牌由服务端保存，10 分钟过期，工作区变化也会使其失效。恢复前副本可用 backup_points/download 读取。上传限制沿用工作区服务的 8 MiB，响应限制 32 MiB。
8. `isError=true` 时读取错误 JSON。`outcome=unknown` 表示可能已写入，先读取核对，禁止自动再次提交。进程不会自动重试请求。

新增标签/过滤器/栏目传空 id，服务端生成正式 id。更名使用现有 id。项目使用点路径（Work.Web）；移动/更名用 project_save.originalName。project_status 中 later 表示暂停或重开，active 表示激活，completed 表示完成；激活第 4 个项目需 replaceProject，完成有未完成任务的项目需 remaining=keep。

主题、布局、折叠和快捷键是各客户端本地偏好，不在共享业务接口范围。当前提供 stdio，不提供远程 HTTP MCP/OAuth 入口；远端数据通过 SSH 私有接口访问。

## 验证

```sh
npm run check:mcp
npm run test:mcp
```

测试使用官方 MCP Client 验证工具发现、全部工具调用映射、参数拒绝、完整编辑日期、版本冲突、不确定结果、来源切换，以及真实 stdio 子进程和隔离 Unix socket；不修改真实工作区。现有 Web 测试继续验证业务规则与备份恢复闸门。

实现依据：[官方 MCP TypeScript SDK 文档](https://ts.sdk.modelcontextprotocol.io/server)。
