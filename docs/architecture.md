# 项目架构

Aster 有两个客户端：Raycast / Tinycast 桌面扩展，以及适配电脑与手机的 Web 模块。两者共用 Taskwarrior 核心逻辑，默认连接 RN。Web 独立运行，当前没有线上部署。

## 目录职责

| 位置                                     | 职责                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `src/my-tasks.tsx`、`src/quick-add.tsx`  | 扩展清单指定的入口；保留在 `src/` 根部                           |
| `src/desktop/`                           | 桌面列表、表单、详情与连接检查                                   |
| `src/core/connection/`                   | SSH / 本机 / WSL 配置、命令构造、进程执行与错误                  |
| `src/core/tasks/`                        | Taskwarrior 模型、日期、参数、过滤表达式和任务操作               |
| `modules/web/src/main.tsx`               | 浏览器启动入口                                                   |
| `modules/web/src/app/`                   | 页面状态与请求编排、导航、全局样式                               |
| `modules/web/src/features/tasks/`        | 任务显示、编辑、快速添加、表达式解析与属性选择器                 |
| `modules/web/src/features/organization/` | 保存的过滤器与标签管理界面                                       |
| `modules/web/src/components/ui/`         | shadcn/ui 基础控件；不承载任务业务                               |
| `modules/web/src/components/icons.tsx`   | 跨功能使用的图标                                                 |
| `modules/web/src/lib/api.ts`             | HTTP 请求与错误转换                                              |
| `modules/web/shared/`                    | 浏览器与服务端共用的数据类型、颜色定义；不依赖 UI 或 Node 运行时 |
| `modules/web/server/`                    | HTTP 路由、认证、输入校验、标签业务和文件存储                    |
| `tests/`                                 | 共享核心测试                                                     |
| `modules/web/tests/`                     | Web 表达式、元数据、HTTP 与认证测试                              |
| `assets/`、`modules/web/public/`         | 扩展资源、网页静态资源                                           |
| `dist/`                                  | 构建产物，不直接编辑                                             |

## 依赖方向

```text
桌面入口 → desktop → core/tasks → core/connection

浏览器 main → app → features → components/ui
                ↓       ↓
               shared + lib/api
                          ↓ HTTP
                      server → core/tasks → core/connection
                         ↓
                       shared
```

`core` 不依赖 React、Raycast 或 Web；两个客户端直接使用同一个任务服务。`shared` 只放契约和纯数据，任务类型通过仅类型导入复用核心定义。服务端不导入浏览器代码，浏览器不导入服务端或连接执行逻辑。

Web 的 `App.tsx` 负责请求、状态、导航和写入反馈，展示细节由侧栏、任务列表和任务表单承担。任务与标签管理组件留在各自功能目录；只有跨功能复用的基础控件才放入 `components`。不增加通用仓储、依赖注入或多余的转发入口。

服务端的 `index.ts` 负责启动、路由与静态文件；`auth.ts` 校验 Access 凭证；`validation.ts` 读取并校验请求；`organization-service.ts` 协调 Taskwarrior 与标签元数据；`organization-store.ts` 负责原子文件写入与版本冲突检查。

## 修改位置

| 要改什么                     | 从哪里开始                               |
| ---------------------------- | ---------------------------------------- |
| SSH 连接或 Taskwarrior 命令  | `src/core/connection/`                   |
| 任务字段、筛选语法或任务操作 | `src/core/tasks/`                        |
| 桌面扩展界面                 | `src/desktop/`                           |
| Web 页面布局与导航           | `modules/web/src/app/`                   |
| 快速输入语法与任务编辑       | `modules/web/src/features/tasks/`        |
| 过滤器、标签管理界面         | `modules/web/src/features/organization/` |
| 通用按钮、弹窗等控件         | `modules/web/src/components/ui/`         |
| HTTP 接口、认证、元数据存储  | `modules/web/server/`                    |
| 浏览器与接口的数据契约       | `modules/web/shared/`                    |

## 运行与验证

在仓库根目录运行：

```sh
npm ci
npm ci --prefix modules/web
npm run dev:web
```

Web 入口为 `http://localhost:4180/`。桌面扩展仍使用 `npm run dev`。

```sh
npm run typecheck
npm test
npm run check:web
npm run test:web
npm run build
```

`test:web` 包含网页构建和 HTTP 集成测试，也可单独用 `build:web` 构建。Web 产物为 `dist/web/client/` 与 `dist/web/server.mjs`。测试使用临时文件和模拟 Taskwarrior，不修改 RN 的真实任务。

## 数据与本地文件

任务和实际标签仍保存在 RN Taskwarrior。Web 的过滤器、颜色、收藏保存在 `modules/web/data/organization.json`（上述启动命令的默认工作目录）；`ORGANIZATION_FILE` 可覆盖路径。该目录已忽略版本控制，不属于源码，不应清理或覆盖。迁移目录时连同此数据一起保留。

`node_modules/`、`dist/`、`output/playwright/` 和 `.playwright-cli/` 是依赖、生成文件或验证产物，不放业务源码。根目录与 Web 模块各自维护依赖和锁文件；当前不引入额外工作区工具或新的打包层。

原 `modules/mobile/` 已改名为 `modules/web/`，根命令的 `:mobile` 后缀同步改为 `:web`，产物移至 `dist/web/`。原有界面、快捷键和数据格式保持兼容。
