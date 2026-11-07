# Aster 2.0 — TinyCast 产品适配

## 定位

启动器负责几秒内完成的任务捕捉、查找和处理；网页负责持续浏览和组织。保留 My Tasks、Quick Add Task 两个命令，继续用 TinyCast 原生 List、Form、ActionPanel，不复刻网页侧栏或多栏布局。界面用英文。

| 网页能力                 | 插件中的形式                                                            |
| ------------------------ | ----------------------------------------------------------------------- |
| Q 快速输入               | Quick Add Task；可从启动器直接传入表达式，也可在 My Tasks 按 ⌘N         |
| 表达式解析               | 与网页共用解析器；输入即预览，Enter 保存，⌘E 转为原生字段表单           |
| 项目、日期、标签、优先级 | 预览属性；原生表单可修改，保留表达式中的具体时间                        |
| 任务列表                 | 搜索 + 视图下拉；Pending、Today、Inbox、In Progress、Waiting、Completed |
| 项目与标签               | 下拉选择；任务行简洁展示项目、最多两个标签、优先级与日期                |
| 原生过滤器               | ⌘⇧F 输入临时表达式；网页保存的过滤器在下拉中直接运行，收藏优先          |
| 看板栏目                 | 按栏目查看任务；⌘⇧M 搜索目标栏目并移动；包括已完成任务                  |
| 项目描述                 | 在任务详情中展示同一项目描述，⌘O 打开详情                               |
| 完成与重开               | Enter 执行，有进行中与结果反馈；⌘Z 撤销最近一次状态切换                 |
| 完整管理                 | ⌘⇧O 打开网页；栏目创建、排序、删除，标签与过滤器管理在网页完成          |

全局快捷键由用户在 TinyCast 中给 Quick Add Task 绑定；保留既有命令 ID，不替用户覆盖系统快捷键。Windows 使用对应 Ctrl 快捷键。

不在启动器中实现拖放看板、网页式多栏布局、第二套管理页面或独立元数据库。这些操作需要空间和持续上下文，在网页完成更合适。

## 数据边界

任务、项目名称和实际标签直接通过原有 SSH / 本地 Taskwarrior 服务读写，网页未启动也可使用。过滤表达式仍由 Taskwarrior 查询执行，不在插件中重新实现查询语义。

保存的过滤器、标签颜色和收藏、项目描述、栏目及任务位置仍由网页服务管理。插件通过 Web Workspace URL（默认 `http://localhost:4180`）读取 `/api/workspace`；该接口只读取元数据文件，不发起额外 SSH 查询。移动栏目通过已有 `/api/organization` 接口和 revision 冲突检查写入，不直接接触网页数据文件。

首次读取及每次栏目移动前，核对连接种类、SSH 目标、Taskwarrior 路径和 taskrc 的连接标识；不匹配时不启用共享操作。当前只连接本机网页服务，不增加远端凭据配置。清空 Web Workspace URL 可禁用共享资料。

栏目与任务状态独立。移动已完成任务不会重开，移动到名为 Done 的栏目也不会完成；任务状态只由完成 / 重开操作改变。

## 可靠性

- 快速输入草稿按连接保存；重新打开可恢复。输入和解析预览不写任务。
- 无效日期、歧义字段、空标题不允许提交；写入过程中阻止重复提交。
- 保存失败保留草稿；结果不确定时锁定提交并保留跨次打开的待核对记录，不自动重试。
- 栏目冲突或不确定结果要求显式刷新；保存成功而刷新失败仍报告保存成功。
- 撤销前读取当前任务状态；其他客户端已改变状态时停止撤销并要求刷新。
- 网页资料暂时不可用时，原生任务操作仍可用；通过操作菜单查看连接提示。

### Focus 2.1

My Tasks opens Focus next steps: one selected task per active project, at most three. Later retains tasks outside active projects; Today still includes real due commitments. Use **Manage Focus Projects** to edit finish lines, select next tasks, activate, pause or complete a project. Activating a fourth requires choosing an active project to pause. **Set as Next Step** references a task without copying it. Reload and Keep Draft recovers from revision conflicts or uncertain writes before another submission.

The default Shared Workspace `auto` connects through the configured RN SSH account to Aster's private Unix socket. Source identity must match the extension's Taskwarrior executable and taskrc. The same server owns all metadata writes; no second file writer, HTTP auth tokens or browser login is required in TinyCast.

## 2.5 adaptation

Full forms add native Repeat/Ends, notes and label selection. My Tasks offers Manage Notes, Edit Series and Data & Recovery. Keep full backup import/preview in the browser (`?panel=data`), where replacement scope is readable. Shared task writes, including capture, use the existing source-checked private workspace bridge; deletion records the web recovery snapshot. Preserve preferences and the two command IDs when importing the update into TinyCast.
