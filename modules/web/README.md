# Aster · Web

Aster 的纯前端网页模块，支持桌面与手机。React + shadcn/ui +
Vite，代码按应用、功能、基础控件和 DTO 导出分组；后端接口由独立的
[`modules/server`](../server/README.md) 提供（本地开发模式下 Vite 将 `/api` 与
`/healthz` 代理至 `modules/server`）。

## 本地运行

在 Aster 仓库根目录执行：

```sh
pnpm install
SSH_TARGET=<your-vps-ssh-alias> npm run dev:web   # 通过 SSH 连接远程 Taskwarrior
# 或连接本机 Taskwarrior：
SSH_TARGET= npm run dev:web
```

打开 **http://localhost:4180/**。`dev:web` 会同时启动
[`modules/server`](../server/README.md)（默认内部端口 `4181`，`SSH_TARGET`
默认示例值
`dmit`）和 Vite 开发服务（`4180`）。若使用 SSH 模式，请先确保终端能运行
`ssh <your-vps-ssh-alias> 'task --version'`。

```sh
npm run check:web
npm run test:web
npm run build:web
```

前端构建输出为 `dist/web/client/`；服务端单独通过 `npm run build:server` 构建为
`dist/server/server.mjs`。模块的独立配置在
`components.json`、`vite.config.ts`、`dev.mjs` 和
`tsconfig.json`；shadcn/ui 组件放在 `src/components/ui/`。

生产构建将 React 运行时与日期组件依赖分别打包为 `react-vendor` 和
`calendar-vendor`，与应用代码分开缓存；看板继续按需加载。保留 Vite 默认的 500
kB 分块警告阈值，便于发现后续体积增长。

## 功能与边界

界面使用 shadcn/ui，按 Todoist 参考截图对齐页面比例、列表、行内编辑和任务详情。桌面默认展开 280px 侧栏，保留常用视图、收藏和项目；时间账本合并为一个入口，进入后切换时间线、本周分布和成本报告。点击「我的项目」标题管理项目，点击左上 Aster 打开设置，时间与预算设置、数据恢复集中在其中。列表正文最大宽 800px，居中显示。任务用圆形完成框和逐行细线分隔，子任务只按层级缩进。手机侧栏默认收起，并保留底部导航。

快速添加是页面上方的浮动输入条，宽屏宽 600px，没有暗色遮罩；空白时为单行，输入后展开两行属性按钮。识别出的日期直接在输入原文中高亮，项目、日期、优先级和标签均可通过按钮调整，调整后焦点回到输入框。创建成功后显示左下角 Toast，可直接打开对应的收件箱或项目。

点击任务标题打开详情；悬停铅笔按钮或 **E**
进入行内编辑，编辑父任务时子任务保持可见。详情在桌面使用 900px 双栏 Dialog：左侧为任务标题、子任务与备注，右侧为项目、日期、标签、优先级和重复设置；有未保存改动时显示保存栏。手机使用可滚动的底部 Sheet，属性区移动到正文下方。长任务首行与勾选框对齐，长标签完整换行。完成任务后键盘焦点移到下一条，已完成任务保留删除线。

连接中、连接异常和待核对状态分别显示。错误后可重新加载列表而不刷新整页，快速添加草稿会保留；结果尚未确认时可先关闭编辑框检查列表。保存期间锁定全部字段，完整表单支持
**Cmd / Ctrl + Enter** 保存，任务描述中的换行转换为空格。

任务详情关闭、切换父子任务或进入重复设置前，会确认是否放弃未保存的任务字段、描述、评论与子任务草稿；刷新或离开网页时也会提示。保存任务字段时，尚未发送的评论或子任务草稿会继续留在详情中。描述、评论和子任务各自的
**Cmd / Ctrl + Enter** 只提交当前输入，**Esc**
优先退出局部编辑；中文输入法选词不会触发保存。打开详情时焦点停在详情容器，关闭后返回原入口。

描述保存使用统一的组织资料版本检查和写入锁；失败会保留输入，错误旁可选择「刷新核对并保留草稿」。行内编辑不会忽略描述保存失败。快速添加通过
**Cmd / Ctrl + E**
切换完整表单时保留描述，新建任务也会保存该描述。手机描述、评论和子任务输入采用 16px 字号，局部操作与删除按钮保留足够的触控面积。

任务页右上角的「显示」集中提供列表/看板切换、按视图允许的维度分组、显示已完成和恢复默认。分组继续沿用每个视图各自的本地偏好；项目操作仍在旁边的更多菜单中。日期沿用 Aster 配色，只有逾期、今天、明天与未来七天强调颜色，更远的日期使用中性色。

「今天」将逾期与今日任务分开，已完成记录不会重新算进逾期区。逾期区的「重新安排」先选择今天、明天、周末、下周或任意日期，再批量调整当前逾期任务；各任务保留原有截止时间。部分任务调整失败时停止写入、刷新已成功部分并明确报告进度，结果不确定时继续要求核对。今天没有安排但仍有逾期事项时，不显示“全部完成”。

在日期、项目、优先级或标签分组中添加任务，会自动继承该分组的属性；可以继续通过自然语言或属性控件覆盖，连续添加时仍保留分组上下文。

## 快速添加

网页获得焦点时按 **Q** 弹出快速添加，输入表达式后按 **Enter** 创建。**Shift +
Enter** 换行，**Esc** 关闭并保留草稿，**/** 聚焦列表搜索，**M**
展开或收起桌面侧栏；正在输入文字或使用中文输入法时不会触发页面快捷键。这是网页快捷键，系统全局快捷键仍需由桌面客户端提供。

```text
明天 交报告 #工作 @专注 p1
下周一 看完这一章 #阅读
2026-10-20 14:30 审阅设计稿 #"产品 设计" %设计 p2
Meet with Ada tomorrow at 14
```

属性用空格分隔，位置自由：

- 日期：今天、明天、后天、大后天、下周、本周一、周五、下周一、3天后、YYYY-MM-DD、due:YYYY-MM-DD，以及 today
  / tomorrow。未指定时间时按本机时区的当天零点写入；支持追加 `14:30`、`at 14` 或
  `2pm`。
- 项目：`#项目`，带空格的名字使用 `#"项目 名称"`。
- 标签：`@标签` 或 `%标签`，多个标签自动去重。
- 优先级：`p1` → 高，`p2` → 中，`p3` → 低，`p4` → 无。

输入时直接高亮识别出的属性，并同步到下方按钮。日期旁的 × 可以保留日期词为正文；把
`"明天"`
这样的词用引号包住，也会保留为普通文字。未支持的表达式保持原文；非法日期或冲突属性会提示修正。当前不解析周期重复、提醒或任意自然语言。需要手动调整时，点「完整表单」带入全部已解析字段，已有日期时间会保留。

创建成功后关闭弹框并刷新待办列表；明确失败保留草稿供重试，结果不确定时禁用再次提交，先刷新检查，避免重复创建。

- 收件箱、今天、等待、已完成；搜索与项目筛选。
- 新建、编辑、完成、重新打开，以及确认后删除。
- 手机、Web 与桌面客户端操作同一份服务端 Taskwarrior 数据；任务数据不另建数据库。
- 联网使用，不缓存私人任务，不自动重试写入。结果无法确认时先刷新检查。

生产部署通常与反向代理 / Cloudflare Access 配合使用（详见
[部署说明](../../deploy/README.md)），服务端仅要求显式设置 `PUBLIC_ORIGIN`
以校验浏览器写操作来源。

## 过滤器与标签

侧栏的「过滤器与标签」集中管理保存的查询和真实任务标签；收藏的条目显示在侧栏。列表、颜色菜单、收藏开关和编辑弹框均使用 shadcn/ui；水滴、标签和管理入口使用与参考图一致的独立 SVG 轮廓。

过滤器直接由服务端关联的 Taskwarrior 执行，支持属性与修饰符、`+标签` /
`-标签`、`and` / `or` / `xor`、括号和引号。兼容 `@标签`，会转换为
`+标签`。只接受筛选条件，不接受 Taskwarrior 操作命令、配置覆盖或 shell 指令。结果排除已删除任务；需要只看待办时请写
`status:pending`，也可以明确筛选已完成任务。

```text
status:pending and (@Todo or priority:H)
status:pending +TODAY
status:pending +READY -Block
project:"video to audio" due.before:tomorrow
status:completed +Work
```

普通 `Ready` 与虚拟标签 `READY`
不同；系统虚拟标签不会混入可编辑标签列表。新建标签可以暂不分配任务；改名同步更新 Taskwarrior 上非删除任务及已保存过滤器中的直接标签条件，删除仅移除标签，保留任务。计数显示未完成任务数量。

Taskwarrior 保存任务及实际标签。过滤器定义、颜色和收藏作为工作区元数据，保存在服务端数据目录的
`organization.json`（可通过 `ORGANIZATION_FILE` 指定绝对路径，生产部署通常位于
`/opt/aster/data/organization.json`）。文件采用原子替换和版本号检查；冲突保留草稿，用户显式重新加载后再保存，发布更新不会覆盖数据目录。

## 完成反馈与项目描述

勾选后立即显示完成状态，服务端确认并刷新成功后任务平滑收起，通知中的 **Undo**
可以撤销完成或重新打开。明确失败会恢复原状态；结果未知时要求先刷新核对，不会自动重试。系统开启减少动态效果时跳过动画。

打开项目，在标题下点击 **Add description**，或在项目的 **… → Edit project**
中编辑描述。支持换行，最多 2,000 个字符。描述与过滤器、颜色、收藏一起保存在服务端
`data/organization.json`，刷新或重启后保留；它是 Aster 的项目资料，不写入 Taskwarrior 任务正文。版本冲突时保留草稿，选择
**Reload and keep draft** 后再保存。

## 看板

右上角 **List / Board**
切换布局，浏览器会记住选择。看板同时显示未完成和已完成任务；保存的过滤器仍按表达式筛选任务。

**Add column**
添加自定义栏目，栏目菜单支持改名、左右移动和删除。没有指定栏目的任务显示在
**Unsectioned**；删除栏目会将任务移回这里，保留任务。已有的 Todo、Doing、Done 栏目作为普通栏目保留，可以任意改名或删除。

栏目与任务状态完全独立。抓住卡片正文或手柄可以跨栏拖动，也能在同栏调整顺序；手机长按后拖动，正常滑动仍用于滚动。卡片的
**Move**
菜单提供相同的移栏操作。键盘聚焦手柄后按空格拿起、左右箭头选栏、空格放下，Esc 取消。拖动到看板之外取消移动。

拖动、排序和 Undo 只保存栏目位置，不修改 Taskwarrior 的完成状态、开始时间、等待日期或任务内容。完成与重新打开仍由任务圆圈控制，任务完成后保留在原栏目；即使栏目名为 Done 或 Todo，也不会触发状态操作。

栏目和位置持久化在服务端
`data/organization.json`，使用版本检查和原子保存；失败回到原位置，版本冲突或结果未知时先重新加载核对，编辑草稿保留。过滤或搜索不会丢失隐藏任务的位置。看板交互代码按需加载；布局偏好保存在本浏览器，私人任务不写入浏览器缓存。

## Appearance

左上 **Aster → 设置 → 主题**
使用分类侧栏、浅色 / 深色 / 系统分段选择和主题预览卡片。提供 Aster 中性色、Todoist 红、月光石、橙红、甘蓝、蓝莓、薰衣草和玫红；主题颜色用于主要按钮、选中侧栏和交互强调，日期、优先级、项目与标签保留自己的语义颜色。

外观默认跟随系统，主题与配色保存在本浏览器；选择系统时，即使设置关闭也实时响应系统变化。首帧应用保存的偏好，存储不可用时当前会话仍可切换。「常规」集中设置完成任务后收起或显示删除线。

侧栏项目与收藏条目的右侧使用固定宽度操作位：平时显示已有任务数量，悬停整行或键盘聚焦时原位切换成
**…**；菜单打开时保持显示，名称与计数不会跳动。触屏直接显示
**…**。项目沿用项目操作菜单，收藏支持直接编辑和取消收藏；标签编辑直接显示颜色选择器。

侧栏导航图标共用 20px
SVG 网格、1.5px 描边和对齐规则；Aster 标志、网页图标与安装图标使用统一的六瓣图形。任务详情中的「时间与成本」与子任务共用正文对齐，时长选择和开始计时分两行，空的关联支出默认收起。

## Projects, filters, and labels

- In the sidebar, click **Projects** to search and manage projects; the **+**
  button creates a project without adding a placeholder task. Project menus
  support editing the name/description and deleting the project.
- Project rename or move updates the full branch of non-deleted Taskwarrior
  tasks (including completed history), preserving child suffixes and updating
  explicit project references in saved filters. Deleting a branch clears its
  tasks' project field, keeping completion, labels, UUIDs and board placements.
- **Filters & labels** provides search, creation, editing, favorites and
  deletion through visible **…** menus. Filters use native Taskwarrior queries.
  Label rename/removal changes the labels on non-deleted tasks; tasks are
  retained. Configured CLI tag suggestions are not treated as task-backed
  labels.
- Empty projects and labels, descriptions, filter definitions, colors and
  favorites are stored in the shared organization file. Saves use revision
  checks; conflicts retain drafts. A release never replaces this data file.

## Focus

Focus is the default home. At most three projects can be Active; new and legacy
projects start in Later. A finish line is required for activation. Activating a
fourth project requires choosing one to pause in the same revision-checked
operation. Overlapping parent/child projects cannot use separate slots; tasks in
subprojects belong to their active parent.

Each project can reference one existing unfinished task as its next step.
Completing that task leaves the finish line and project status intact; choose
the next step explicitly. Pausing or completing a project changes only project
metadata. Completing a project with unfinished tasks requires confirmation to
keep those tasks; they remain available in Later. Today continues to show
genuinely due tasks from paused projects. Inbox contains unassigned captures.

Project details and All projects support finish lines, next-step selection,
activation, pause, completion and reopening. The project limit is enforced
inside the organization store's serialized revision queue; clients cannot
activate a project through ordinary project saves. Existing metadata edits
preserve goal fields when older clients omit them.

Desktop（Raycast / TinyCast）、MCP 与 Go
TUI 通过现有 SSH 连接访问同一服务端进程上的
`/opt/aster/data/workspace.sock`（权限
`0600`）或在本地直连 HTTP 服务。服务端通过
`modules/server/src/transport/workspace-api.ts` 对 HTTP 与 Unix
Socket 暴露统一的任务查询、动作、组织资料、时间账本、恢复与备份接口；浏览器 HTTP 写请求强制校验
`PUBLIC_ORIGIN` 与 `application/json`。

### Nested projects

Projects use native Taskwarrior dot paths (`Product.Web.Interface`). The UI
exposes a tree, Add subproject, Parent project and parent breadcrumbs. There is
no fixed nesting depth; the existing 200-character path bound still applies.
Inferred ancestors from CLI-created projects are shown automatically. Parent
task views and counts include descendants.

Renaming or moving a project remaps its entire branch, including metadata and
explicit project references in saved filters. Native writes target exact paths,
deepest first, retaining descendant suffixes, UUIDs and task status. Deleting a
branch clears its tasks' project field to Inbox and removes that branch's
metadata; board placements stay unchanged. Partial native-write failures are
reported as unconfirmed and never retried automatically. Focus references to
tasks that leave an ancestor are cleared, and moves cannot create overlapping
active goals.

Project colors use the shared filter/label palette. Each project stores its
optional color in workspace metadata; missing colors render gray. Colors are
independent per subproject and preserved through branch changes and older
clients that omit the field. Editing a color never writes Taskwarrior tasks.

## Recovery, exports and repeating tasks

The sidebar's **Data & recovery** opens deleted-task recovery and a full JSON
export. Task editing adds **Repeat** / **Ends**, **Edit series** for existing
occurrences, and multiline **Notes**. Stop series preserves existing tasks.
These use native Taskwarrior recurrence and annotations; the recovery journal
remains separate workspace metadata.

## 极简时间账本与计时计划（Time Ledger）

Web 端 `src/features/time/` 提供极简、留白优先的时间账本视图，对应设计见
[产品设计](../../docs/time-management-design.md)：

- **时间线 / 本周分布 / 成本报告**
  三个页面统一日期导航和摘要层级；待确认睡眠候选、未定位估记和额外计划按需展开，规则配置集中在设置中；
- **执行条 & 定时计划（TimingPlan）**：遵循
  **手动开始 → 到限自动停止 → 确认或修正记录**
  流程。到期自动停止或跨小时检查点通过顶部单行极简提示呈现，支持一键确认、暂停/继续（共享同一剩余额度与最晚停止时刻）、加时或修改结束时刻。

## 列表分组与看板统一

List 与 Board 使用同一份栏目及任务范围。每个列表分组对应一个看板栏目，顺序、任务归属、组内排序和空栏目一致；没有指定栏目的任务进入 Unsectioned。列表支持折叠、拖动、Move 菜单、新增分组、改名、调序和删除，操作会同步到看板。删除分组保留任务并移回 Unsectioned。收件箱仍只显示无项目任务，搜索和筛选不会清除隐藏任务的位置。

## 时间线与统计视图

时间线集中呈现实际记录，不再常驻展示待开始计划。使用细线和节点连接时间记录，保持现有配色与排版。本周分布支持每日、项目、标签；成本报告支持项目与标签分组，并可切换时长与已确认时间成本。每日记录可以进入当天时间线。待核对记录不计入图表，标签分别累计。

时间统计统一使用「项目 / 标签」两个维度，默认项目。本周分布与成本报告均不提供任务或每日维度切换。时长与时间成本作为指标切换；标签包含未设标签的独立记录，多标签分别累计，不能将标签金额相加作为总额。现金汇总保留，标签不分摊现金或任务预算。

## 预览、侧栏与日期选择

「预览」按本地日期展示任务：列表连续展示四周，看板展示所选一周，支持居中列表和横向看板、月份跳转、上一周 / 今天 / 下一周，以及按日期添加任务。任务日期、习惯起始日和账本日期共用中文日历：周一开头、统一月份导航、今天轮廓和主题色选中态。

设置的「侧栏」可逐项隐藏入口并切换任务数量，偏好通过后端共享存储同步；隐藏的视图仍可从搜索打开。习惯热力图随主题配色变化。「本地已连接」成功提示不再显示，连接错误仍保留。

工作区默认视图为 **「现在能做」（`now`）**：顶部展示异常与到期提醒横幅，展开显示最多 5 项「处理中」任务（活跃计时置顶），下方默认折叠「计划中」「等待中」「长期搁置」分组，超出 5 项上限时通过选择框明确替换。内置过滤器列表已移除，仅保留自定义过滤器与 `# 标签`。习惯仅在侧栏专属 **「习惯」** 菜单中查看与打卡，不再嵌入「现在能做」「今天」「收件箱」「预览」等任务列表；空状态采用紧凑提示。按标签分组时，行内不再重复分组标签；项目只显示末级名称，完整位置可悬停查看。任务列表优先显示实际投入与超预算提示，预算详情在任务的「时间与成本」中查看。

时间账本各页面采用同一日期工具栏和摘要区；补记、项目 / 标签分布和明细分层展示，额外计划与诊断内容按需展开。时间线的金额、中文时长和编辑入口使用固定列。

新建计时、补记、估记及计时计划必须有项目，标签可选；关联任务已有项目时自动继承。睡眠未指定项目时使用「睡眠」，旧睡眠记录的统计也归入该项目，不改写历史记录。任务本身仍允许没有项目。
