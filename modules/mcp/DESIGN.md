# Aster AI 接口设计

## 目标与边界

为 Aster 的全部共享业务功能提供可发现、有参数约束的 MCP tools。AI、Web、TUI 和 TinyCast 操作同一份 Taskwarrior、Timewarrior 与 organization 数据。窗口大小、主题、折叠、快捷键等客户端显示偏好不作为服务端业务接口。

## 架构

AI host → MCP stdio → 本地 Unix socket / OpenSSH Unix socket 转发 → 现有 workspace-ipc → 现有业务服务。

使用官方 TypeScript MCP SDK；独立模块、依赖与检查，不改变桌面扩展依赖。不新开公网端口、不绕过工作区闸门、不直接写数据文件。可通过 ASTER_SOCKET 使用本地或已转发的 socket；远程用 ASTER_SSH_TARGET 和 ASTER_REMOTE_SOCKET。SSH 配置、密钥与 known_hosts 沿用系统配置。

## 功能覆盖

| 功能                                                          | tools / prompts                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AI 项目全貌与进度摘要（分栏、嵌套子任务、正文、逾期、完成）    | `project_digest`                                                                         |
| 批量结构化落地计划（项目、阶段分栏、父子任务树、正文、nextTask） | `plan_apply`、Prompts（`aster_takeover_plan`、`aster_daily_review`）                   |
| 全部/待办/完成/等待/今日/收件箱/搜索/自定义筛选、详情         | `tasks_list`（Taskwarrior filter）、`task_get`                                           |
| 添加、局部修改、完整编辑、备注追加、子任务关联、正文说明       | `task_create`（含 `parentUuid`/`taskDescription`）、`task_patch`、`task_edit`、`subtask_link`/`unlink`、`task_description_set`/`delete` |
| 完成、重开、开始/停止计时、等待/清除等待、删除/恢复           | `task_complete`/`reopen`/`start`/`stop`/`wait`/`delete`/`restore`                        |
| 备注删除、重复系列读取/编辑/停止                              | `task_note_remove`、`recurrence_get`/`edit`（`recur=""` 停止系列）                        |
| 一句话解析                                                    | `quick_preview`（只预览，核对后 `task_create`）                                           |
| 项目树、Focus、计时和精力、过滤器、标签、栏目                 | `workspace_get`（含 `revision` 和全部组织资料）                                           |
| 项目创建、编辑、层级移动/改名、颜色、描述、目标、下一步、删除 | `project_save`/`delete`                                                                  |
| 项目激活/暂停/完成/重开、替换聚焦项目                         | `project_status`                                                                         |
| 过滤器、标签的新增/编辑/改名/颜色/收藏/删除                   | `filter_save`/`delete`、`label_save`/`delete`                                            |
| 项目/全局分组栏目增删移动，任务子树跨栏与组内排序              | `column_save`（支持 `project`）、`column_delete`/`move`、`board_task_move`（支持 `parentUuid`） |
| 精力恢复                                                      | `energy_elixir`                                                                          |
| 删除恢复列表、全量导出                                        | `recovery_list`、`backup_export`                                                         |
| 恢复点列表/下载、上传预览/恢复                                | `backup_points`/`download`/`preview`/`restore`                                           |

## 契约与失败语义

- 所有组织资料写入要求调用者提供最近读取的 revision；冲突返回错误，禁止自动重读后覆盖。
- 工具参数用 Zod 转换为 JSON Schema，工具名固定。拒绝未知字段，不接受任意 URL、shell 或原生命令。
- 首次读取 workspace 获取 source identity 并在会话内固定，后续每次请求携带 X-Aster-Source。
- task_edit 为完整字段替换：先 task_get，保留未修改字段；note 为追加内容。日期采用明确 UTC YYYYMMDDTHHmmssZ；快速解析使用服务器时区。
- backup_restore 需要预览令牌及 confirmation="RESTORE"。业务服务继续校验令牌过期、数据漂移、独占闸门，并保存恢复前副本。
- 错误含 status/outcome；传输失败的写操作标记 outcome=unknown，不自动重试。AI 应先读取核对。业务内容作为数据返回，不作为指令。
- readOnlyHint/destructiveHint/idempotentHint 标注工具属性；这些仅为 host 提示，授权来自用户为 host 配置的本机/SSH 权限。
- stdout 仅输出 MCP 消息；日志走 stderr。进程退出关闭 SSH 转发并移除临时目录。

## 验证

官方 SDK 客户端经 stdio 测试 tools/list、tools/call、参数拒绝；隔离的 Unix socket 假工作区验证全部工具映射、revision、source、备份恢复顺序与未知写入。运行 Web 原有测试和类型检查确认复用契约不回归。测试不连接真实任务库。
