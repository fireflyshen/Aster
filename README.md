# Aster

## Web 客户端（桌面与手机）

网页客户端是本仓库的独立模块 [`modules/web`](modules/web/README.md)，界面使用 React + shadcn/ui，继续连接 RN 的同一份 Taskwarrior 数据。

```sh
npm ci --prefix modules/web
npm run dev:web
```

本地入口为 **http://localhost:4180/**。当前仅做本地开发与验证，之前的线上部署已撤销。模块拥有独立依赖与构建配置，不挂载在其他应用中。

## 桌面客户端

Aster 是运行在本机的 Taskwarrior 3 客户端，通过 Raycast 查看和管理任务。默认连接 VPS `rn`，本机无需安装 Taskwarrior。也支持已有的本地 Taskwarrior 3，以及 Windows 上的 WSL。

## 日常使用

**My Tasks** 是主入口：

- 查看待办、今天与逾期、等待中、已完成的任务；已完成记录按完成时间倒序。
- 搜索描述、项目和标签；下拉菜单可直接查看某个项目的待办。
- 创建、编辑、完成、重新打开任务，以及确认后删除误建任务。
- 设置等待日期或清除等待；开始、停止只影响选中的任务。
- 查看备注及任务属性。菜单中可刷新列表或检查连接。

列表中 `⌘N` 新建，`⌘E` 编辑，`⌘R` 刷新；Windows 使用对应的 Ctrl 快捷键。默认回车完成任务，在已完成列表中回车重新打开任务。

**Quick Add Task** 是供快捷键使用的创建入口，使用同一个表单。表单保留描述、项目、截止日期、标签和优先级；标签以逗号分隔。项目可以搜索已有值，也可以直接创建。项目建议来自任务库，不保留最近使用缓存。

删除使用 Taskwarrior 的 `delete`，不执行永久清除。必要时可通过 Taskwarrior CLI 找到已删除任务并修改为 `status:pending`。批量删除和清空数据库不放进日常客户端。

暂不加入独立计时系统、统计报表、离线写入、多服务器切换或高级重复任务编辑。已有任务的备注、重复规则、依赖和调度字段会在编辑时保留。

## 连接

默认配置：

| 配置                | 默认值                    |
| ------------------- | ------------------------- |
| Connection Mode     | SSH                       |
| SSH Target          | `rn`                      |
| Remote Task Command | `/usr/local/bin/task`     |
| Remote Taskrc       | `/etc/taskwarrior/taskrc` |

使用系统 OpenSSH 的配置、密钥、agent 和 known_hosts，不保存凭据。端口及跳板机写在 SSH config 中。首次连接先在终端验证服务器指纹并完成密钥登录：

```sh
ssh rn 'task --version'
```

Windows 远端模式使用 Windows OpenSSH，无需 WSL。更换服务器时调整 SSH Target 和远端路径；清空 Remote Taskrc 表示使用远端默认配置。修改设置后关闭并重新打开命令，已打开的列表和编辑页始终使用原连接。

连接中断后，无法确认结果的写入不会自动重试。表单保留输入并阻止再次提交；检查 My Tasks 后重新打开表单。写入成功但刷新失败仍会提示保存成功。所有修改使用 UUID，在当前扩展进程中按连接排队；其他进程和客户端仍可同时修改任务。

日期按客户端所选日历日期转换成明确的 UTC 时间，编辑其他字段时保留原截止时间。读取关闭 hooks 和垃圾回收；修改保留 Taskwarrior 的写入 hooks。

Local 模式需要已有的 Taskwarrior 3。macOS 默认 `/opt/homebrew/bin/task`，Windows 默认使用 Ubuntu WSL 中的 `/usr/bin/task`。本次配置的本机 Taskwarrior 和 Timewarrior 已卸载，继续使用 SSH 模式即可。

## 代码结构

```text
src/
  my-tasks.tsx          Raycast / Tinycast 列表入口
  quick-add.tsx         Raycast / Tinycast 创建入口
  core/
    connection/        连接配置、命令执行与错误
    tasks/             Taskwarrior 数据、查询与操作
  desktop/             桌面客户端界面与状态
modules/web/
  server/              HTTP 接口、认证、校验与持久化
  shared/              浏览器与服务端共享的数据契约
  src/
    app/               应用编排、导航与全局样式
    features/
      tasks/           任务列表、表单、快速输入与日期解析
      organization/    过滤器与标签管理
    components/        共用图标、shadcn/ui 基础控件
    lib/               HTTP 请求工具
  tests/               Web 解析、存储和接口测试
tests/                 共享核心行为测试
docs/                  架构说明与远端配置
```

桌面端与 Web 服务端共用 `src/core`；浏览器通过 HTTP 访问服务端，不执行 SSH。详细边界与修改位置见 [架构说明](docs/architecture.md)，Web 的运行方式见 [Web 模块说明](modules/web/README.md)。

## 开发

需要 Node.js 22.14+ 和 Raycast。

```sh
npm ci
npm run dev
npm run typecheck
npm test
npx eslint src tests
npm run build
```

`npm run lint` 还会校验发布清单，发布前需将 `YOUR_RAYCAST_USERNAME` 换成真实 Raycast 账号。VPS 布局见 [remote setup](docs/remote-setup.md)。Taskwarrior 命令语义见 [官方手册](https://taskwarrior.org/docs/man/task.1/)。
