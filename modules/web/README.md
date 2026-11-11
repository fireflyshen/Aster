# Aster · Web

Aster 的独立网页模块，支持桌面与手机。React + shadcn/ui，使用自己的依赖与构建配置；服务端复用仓库的 `src/core/tasks` 和 `src/core/connection`，默认通过 SSH 连接 dmit 的 Taskwarrior。代码按应用、功能、基础控件、服务端和共享契约分组，详见 [架构说明](../../docs/architecture.md)。

## 本地运行

在 Aster 仓库根目录执行：

```sh
npm ci --prefix modules/web
npm run dev:web
```

打开 **http://localhost:4180/**。开发服务仅监听本机；正式入口为 **https://task.caten.top/**，独立运行在 dmit。首次连接先确保终端能运行 `ssh dmit 'task --version'`。不要用文件浏览方式直接打开 HTML，界面需要本地服务提供模块和任务接口。

```sh
npm run check:web
npm run test:web
npm run build:web
```

构建输出为 `dist/web/client/` 和 `dist/web/server.mjs`，与桌面扩展的构建输出分开。模块的独立配置在 `components.json`、`vite.config.ts` 和 `tsconfig.json`；shadcn/ui 组件放在 `src/components/ui/`。

## 功能与边界

界面使用 shadcn/ui，并按用户给出的 Todoist 演示视频重做视觉：白色画布、中性灰强调色、圆形完成框、细分隔线和紧凑的属性按钮。侧栏默认收起；收件箱显示未分类任务，其下按项目折叠，搜索和视图入口放在顶部工具栏。手机使用同样的内容结构，并保留右下角添加入口。

快速添加是页面上方的浮动输入条，宽屏宽 600px，没有暗色遮罩；空白时为单行，输入后展开两行属性按钮。识别出的日期直接在输入原文中高亮，项目、日期、优先级和标签均可通过按钮调整，调整后焦点回到输入框。创建成功后显示左下角 Toast，可直接打开对应的收件箱或项目。

完整表单仍在手机使用底部 Sheet、桌面使用 Dialog；表单控件为 44px 高、16px 字号。窄屏切换为单列表单，短屏内容可滚动。长任务首行与勾选框对齐，长标签完整换行。完成任务后键盘焦点移到下一条，已完成任务保留删除线。

连接中、连接异常和待核对状态分别显示。错误后可重新加载列表而不刷新整页，快速添加草稿会保留；结果尚未确认时可先关闭编辑框检查列表。保存期间锁定全部字段，完整表单支持 **Cmd / Ctrl + Enter** 保存，任务描述中的换行转换为空格。

## 快速添加

网页获得焦点时按 **Q** 弹出快速添加，输入表达式后按 **Enter** 创建。**Shift + Enter** 换行，**Esc** 关闭并保留草稿，**/** 聚焦列表搜索，**M** 展开或收起桌面侧栏；正在输入文字或使用中文输入法时不会触发页面快捷键。这是网页快捷键，系统全局快捷键仍需由桌面客户端提供。

```text
明天 交报告 #工作 @专注 p1
下周一 看完这一章 #阅读
2026-10-20 14:30 审阅设计稿 #"产品 设计" %设计 p2
Meet with Ada tomorrow at 14
```

属性用空格分隔，位置自由：

- 日期：今天、明天、后天、大后天、下周、本周一、周五、下周一、3天后、YYYY-MM-DD、due:YYYY-MM-DD，以及 today / tomorrow。未指定时间时按本机时区的当天零点写入；支持追加 `14:30`、`at 14` 或 `2pm`。
- 项目：`#项目`，带空格的名字使用 `#"项目 名称"`。
- 标签：`@标签` 或 `%标签`，多个标签自动去重。
- 优先级：`p1` → 高，`p2` → 中，`p3` → 低，`p4` → 无。

输入时直接高亮识别出的属性，并同步到下方按钮。日期旁的 × 可以保留日期词为正文；把 `"明天"` 这样的词用引号包住，也会保留为普通文字。未支持的表达式保持原文；非法日期或冲突属性会提示修正。当前不解析周期重复、提醒或任意自然语言。需要手动调整时，点「完整表单」带入全部已解析字段，已有日期时间会保留。

创建成功后关闭弹框并刷新待办列表；明确失败保留草稿供重试，结果不确定时禁用再次提交，先刷新检查，避免重复创建。

- 收件箱、今天、等待、已完成；搜索与项目筛选。
- 新建、编辑、完成、重新打开，以及确认后删除。
- 手机与桌面客户端操作同一份 dmit Taskwarrior 数据；任务数据不另建数据库。
- 联网使用，不缓存私人任务，不自动重试写入。结果无法确认时先刷新检查。
- 模块独立运行，不引用其他 Flowspace 应用的域名、登录配置或部署文件。

正式部署使用独立域名 **https://task.caten.top/** 和 `/opt/aster`，由 `aster.service` 管理，详见 [部署说明](../../deploy/README.md)。已有服务器代码在生产模式下要求显式设置 `CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD` 和 `PUBLIC_ORIGIN`，不会读取其他应用的配置。

## 过滤器与标签

侧栏的「过滤器与标签」集中管理保存的查询和真实任务标签；收藏的条目显示在侧栏。列表、颜色菜单、收藏开关和编辑弹框均使用 shadcn/ui；水滴、标签和管理入口使用与参考图一致的独立 SVG 轮廓。

过滤器直接由 dmit 的 Taskwarrior 执行，支持属性与修饰符、`+标签` / `-标签`、`and` / `or` / `xor`、括号和引号。兼容 `@标签`，会转换为 `+标签`。只接受筛选条件，不接受 Taskwarrior 操作命令、配置覆盖或 shell 指令。结果排除已删除任务；需要只看待办时请写 `status:pending`，也可以明确筛选已完成任务。

```text
status:pending and (@Todo or priority:H)
status:pending +TODAY
status:pending +READY -Block
project:"video to audio" due.before:tomorrow
status:completed +Work
```

普通 `Ready` 与虚拟标签 `READY` 不同；系统虚拟标签不会混入可编辑标签列表。新建标签可以暂不分配任务；改名同步更新 dmit 上非删除任务及已保存过滤器中的直接标签条件，删除仅移除标签，保留任务。计数显示未完成任务数量。

Taskwarrior 保存任务及实际标签。过滤器定义、颜色和收藏作为本网页模块的元数据，保存在服务进程工作目录的 `data/organization.json`（用上述命令运行时为 `modules/web/data/organization.json`）；可通过 `ORGANIZATION_FILE` 指定绝对路径，生产运行应将它放在持久化目录。文件采用原子替换和版本号检查；冲突保留草稿，用户显式重新加载后再保存。线上文件为 `/opt/aster/data/organization.json`，与代码发布分开保存。

## 完成反馈与项目描述

勾选后立即显示完成状态，dmit 确认并刷新成功后任务平滑收起，通知中的 **Undo** 可以撤销完成或重新打开。明确失败会恢复原状态；结果未知时要求先刷新核对，不会自动重试。系统开启减少动态效果时跳过动画。

打开项目，在标题下点击 **Add description**，或在项目的 **… → Edit project** 中编辑描述。支持换行，最多 2,000 个字符。描述与过滤器、颜色、收藏一起保存在网页模块的 `data/organization.json`，刷新或重启后保留；它是 Aster 的项目资料，不写入 Taskwarrior 任务正文。版本冲突时保留草稿，选择 **Reload and keep draft** 后再保存。

## 看板

右上角 **List / Board** 切换布局，浏览器会记住选择。看板同时显示未完成和已完成任务；保存的过滤器仍按表达式筛选任务。

**Add column** 添加自定义栏目，栏目菜单支持改名、左右移动和删除。没有指定栏目的任务显示在 **Unsectioned**；删除栏目会将任务移回这里，保留任务。已有的 Todo、Doing、Done 栏目作为普通栏目保留，可以任意改名或删除。

栏目与任务状态完全独立。抓住卡片正文或手柄可以跨栏拖动，也能在同栏调整顺序；手机长按后拖动，正常滑动仍用于滚动。卡片的 **Move** 菜单提供相同的移栏操作。键盘聚焦手柄后按空格拿起、左右箭头选栏、空格放下，Esc 取消。拖动到看板之外取消移动。

拖动、排序和 Undo 只保存栏目位置，不修改 Taskwarrior 的完成状态、开始时间、等待日期或任务内容。完成与重新打开仍由任务圆圈控制，任务完成后保留在原栏目；即使栏目名为 Done 或 Todo，也不会触发状态操作。

栏目和位置持久化在网页模块的 `data/organization.json`，使用版本检查和原子保存；失败回到原位置，版本冲突或结果未知时先重新加载核对，编辑草稿保留。过滤或搜索不会丢失隐藏任务的位置。看板交互代码按需加载；布局偏好保存在本浏览器，私人任务不写入浏览器缓存。

## Appearance

顶部月亮 / 太阳图标打开主题菜单：**Light / Dark / System**。默认跟随系统，手动选择会保存在本浏览器；选择 System 时实时响应系统变化。页面首帧即应用已选主题，日历、弹窗、看板和通知共用主题变量。浏览器存储不可用时，当前会话仍可切换。

## Projects, filters, and labels

- In the sidebar, click **Projects** to search and manage projects; the **+** button creates a project without adding a placeholder task. Project menus support editing the name/description and deleting the project.
- Project rename or move updates the full branch of non-deleted Taskwarrior tasks (including completed history), preserving child suffixes and updating explicit project references in saved filters. Deleting a branch clears its tasks' project field, keeping completion, labels, UUIDs and board placements.
- **Filters & labels** provides search, creation, editing, favorites and deletion through visible **…** menus. Filters use native Taskwarrior queries. Label rename/removal changes the labels on non-deleted tasks; tasks are retained. Configured CLI tag suggestions are not treated as task-backed labels.
- Empty projects and labels, descriptions, filter definitions, colors and favorites are stored in the shared organization file. Saves use revision checks; conflicts retain drafts. A release never replaces this data file.

## Focus

Focus is the default home. At most three projects can be Active; new and legacy projects start in Later. A finish line is required for activation. Activating a fourth project requires choosing one to pause in the same revision-checked operation. Overlapping parent/child projects cannot use separate slots; tasks in subprojects belong to their active parent.

Each project can reference one existing unfinished task as its next step. Completing that task leaves the finish line and project status intact; choose the next step explicitly. Pausing or completing a project changes only project metadata. Completing a project with unfinished tasks requires confirmation to keep those tasks; they remain available in Later. Today continues to show genuinely due tasks from paused projects. Inbox contains unassigned captures.

Project details and All projects support finish lines, next-step selection, activation, pause, completion and reopening. The project limit is enforced inside the organization store's serialized revision queue; clients cannot activate a project through ordinary project saves. Existing metadata edits preserve goal fields when older clients omit them.

TinyCast uses the existing SSH connection to reach the same server process over `/opt/aster/data/workspace.sock` (0600). Enable `WORKSPACE_SOCKET` in the server environment. The socket has no TCP listener; it checks Taskwarrior source identity, uses the same revision queue as web, and exposes metadata operations only. The public web API still requires Cloudflare Access. `Shared Workspace: auto` uses this connection for SSH, or localhost web for a local Taskwarrior client. Existing localhost defaults migrate to shared SSH when using dmit.

### Nested projects

Projects use native Taskwarrior dot paths (`Product.Web.Interface`). The UI exposes a tree, Add subproject, Parent project and parent breadcrumbs. There is no fixed nesting depth; the existing 200-character path bound still applies. Inferred ancestors from CLI-created projects are shown automatically. Parent task views and counts include descendants.

Renaming or moving a project remaps its entire branch, including metadata and explicit project references in saved filters. Native writes target exact paths, deepest first, retaining descendant suffixes, UUIDs and task status. Deleting a branch clears its tasks' project field to Inbox and removes that branch's metadata; board placements stay unchanged. Partial native-write failures are reported as unconfirmed and never retried automatically. Focus references to tasks that leave an ancestor are cleared, and moves cannot create overlapping active goals.

Project colors use the shared filter/label palette. Each project stores its optional color in workspace metadata; missing colors render gray. Colors are independent per subproject and preserved through branch changes and older clients that omit the field. Editing a color never writes Taskwarrior tasks.

## Recovery, exports and repeating tasks

The sidebar's **Data & recovery** opens deleted-task recovery and a full JSON export. Task editing adds **Repeat** / **Ends**, **Edit series** for existing occurrences, and multiline **Notes**. Stop series preserves existing tasks. These use native Taskwarrior recurrence and annotations; the recovery journal remains separate workspace metadata. See [behavior, limitations and validation](../../docs/reliability-2026-11-03.md).

## 列表分组与看板统一

List 与 Board 使用同一份栏目及任务范围。每个列表分组对应一个看板栏目，顺序、任务归属、组内排序和空栏目一致；没有指定栏目的任务进入 Unsectioned。列表支持折叠、拖动、Move 菜单、新增分组、改名、调序和删除，操作会同步到看板。删除分组保留任务并移回 Unsectioned。收件箱仍只显示无项目任务，搜索和筛选不会清除隐藏任务的位置。
