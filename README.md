# Aster

## iPhone 手机版

手机版是本仓库的独立模块 [`modules/mobile`](modules/mobile/README.md)，界面使用 React + shadcn/ui，继续连接 RN 的同一份 Taskwarrior 数据。

```sh
npm ci --prefix modules/mobile
npm run dev:mobile
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
  my-tasks.tsx           主客户端入口
  quick-add.tsx          创建快捷入口
  connection/           配置、命令构造、进程执行、错误处理
  tasks/                任务数据、参数、日期、项目建议与操作
  ui/                   列表、表单、详情、连接检查
tests/                 对应的核心行为测试
docs/remote-setup.md    VPS 安装布局
```

依赖方向为 `ui → tasks → connection`。连接与任务模块不依赖 Raycast，界面只处理展示、导航和反馈。保留直接的函数调用，不引入通用仓储、插件系统或同步框架。

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
