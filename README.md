# 3D Model Search Workbench

[![CI](https://github.com/bowling2005/3d-model-search-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/bowling2005/3d-model-search-workbench/actions/workflows/ci.yml)

面向 Unity 游戏开发的 3D 资产工作台。它把多来源免费模型搜索、下载管理、许可记录、Blender 质检与 Unity 导入串成一条可审计的流水线。

> 当前版本：`v0.1.1`，Windows 优先的实验性版本。站点适配器和 DCC 集成仍会快速演进。

## 下载即用

**[下载 Windows 便携版 EXE](https://github.com/bowling2005/3d-model-search-workbench/releases/latest/download/3D-Model-Search-Workbench-0.1.1-portable.exe)**

普通用户只需要：

1. 从 GitHub Releases 下载 `3D-Model-Search-Workbench-<version>-portable.exe`。
2. 双击打开，不需要安装 Node.js、Git、npm 或数据库。
3. 在搜索结果中点击一次“下载到本地”，软件会完成下载、安全校验和入库。
4. 在“访问与账号”中创建站点账号档案，再点击“打开登录窗口”完成该站点的登录或验证码。
5. 可选配置 Blender 和 Unity 项目，然后核验模型、处理 FBX 并导入 Unity。

工作台本身不要求注册账号。需要登录的模型站点由用户在应用内完成登录；软件不会代填密码、绕过验证码或绕过站点权限。首次运行时，数据库和下载资产保存在当前 Windows 用户的应用数据目录，不写入 EXE。

便携版通过公共 `https://3d.shep.bot` 搜索服务访问站点连接器。搜索词会发送到该服务，下载后的模型文件和本地账号数据仍保存在本机。

## 功能

### 来源注册与发现

- 内置 89 个去重后的来源记录。
- 支持来源搜索、筛选、启用和停用。
- 可手动添加候选网站。
- 可从现有来源首页外链自动发现候选站点。
- 自动读取标题、描述、格式、许可、登录提示和 `robots.txt`。
- 候选站点默认隔离，必须人工审核后才能加入来源库。

### 公共来源搜索与下载

- 便携版通过公共 [3D Asset Server](https://github.com/arielshad/3d-asset-server) 服务搜索公共来源。
- 逐来源返回状态、超时、失败和搜索结果。
- 支持免费、直接下载、格式和最大面数筛选。
- 本地查询缓存优先，实时结果流式补充。
- 下载隔离、重定向检查、ZIP 安全解压和 SHA-256 校验。
- 保存来源、许可、文件列表和下载清单。
- 每条结果只需点击一次“下载到本地”。

### 下载资产库

- 查看所有已下载资产及本地文件。
- 自动检测 Blender，也可手动配置路径。
- 未配置 Blender 时自动禁用核验和后处理。
- Blender 后台核验三角面、顶点、材质、UV、骨骼、动画和拓扑问题。
- 安全应用变换、合并近重复顶点、删除松散点并重算法线。
- 导出 Unity 工作格式 FBX。

### Unity 导入

- 选择并持久化本地 Unity 项目路径。
- 安装本地 UPM 导入插件。
- 通过 `.model-library/inbox` 和 `.model-library/outbox` 交接请求。
- 插件将模型复制到 `Assets/ModelLibrary`、配置 ModelImporter 并回写结果。
- GLB 资产建议先由 Blender 转换为 FBX；原生 FBX/OBJ 可直接提交流程。

### 账号与访问

- 每个来源可创建多个账号档案。
- 支持浏览器登录、OAuth、API Key 和账号密码模式。
- 密码和 API Key 使用 Windows 安全存储加密。
- 每个账号使用独立浏览器会话分区。
- 登录、二次验证和验证码由用户本人完成。
- 支持清除本地会话、删除账号档案和授权待办。

## 工作流

```text
来源发现
  -> 候选审核
  -> 多来源搜索
  -> 许可与访问检查
  -> 下载与安全校验
  -> 本地资产库
  -> Blender 核验/处理
  -> Unity 导入
  -> CREDITS / 来源记录
```

## 使用要求

- Windows 10/11
- 可选：Blender 4.2 LTS 或更高版本
- 可选：Unity 2022.3 LTS 或 Unity 6 LTS

Blender 和 Unity 都是可选项。未配置时，对应操作会保持禁用，不会阻断搜索、下载和资产管理。

## 首次使用

1. 打开便携版 EXE。
2. 在“模型搜索”输入关键词，按 FBX/GLB/OBJ 等格式和最大面数筛选。
3. 点击结果旁的“下载到本地”。
4. 在“我的资产”中选择 Blender 路径，按需核验或处理模型。
5. 选择 Unity 项目、安装导入插件，然后点击“导入 Unity”。

遇到需要站点账号的结果时，在“访问与账号”中选择来源并创建账号档案。推荐使用“浏览器登录”：应用会打开隔离登录窗口，登录、二次验证和验证码都由用户本人完成。密码和 API Key 使用 Windows 安全存储加密。

## 开发者运行

以下内容只面向希望修改代码或运行本地搜索 sidecar 的开发者。普通用户无需执行。

```powershell
git clone --recurse-submodules https://github.com/bowling2005/3d-model-search-workbench.git
cd 3d-model-search-workbench
npm install
npm run setup:discovery
npm run db:seed
npm run dev
```

如果克隆时没有拉取 submodule：

```powershell
git submodule update --init --recursive
```

`npm run dev` 会启动：

- Vite 渲染进程：`http://127.0.0.1:5173`
- Electron 桌面窗口：`3D Asset Search Workbench`

不要只打开浏览器地址；桌面功能依赖 Electron IPC、SQLite 和本地 sidecar。

## 构建 Windows 便携版

```powershell
npm run dist:win
```

生成文件位于 `release/`。推送 `v*` 标签后，GitHub Actions 会自动构建并上传便携版 EXE。

## 本地数据

安装版的默认数据目录位于当前 Windows 用户的应用数据目录：

```text
%APPDATA%\model-search-workbench\data\
```

开发模式的默认数据目录：

```text
data/
  model-search.db
  library/
  staging/
  jobs/
```

下载资产结构：

```text
data/library/<source-id>/<asset-id>-<sha-prefix>/
  source/
  artifacts/
  manifest.json
  license.json
```

`data/`、下载模型、数据库、日志和本地凭据不会提交到 Git。

如果 GitHub Releases 下载较慢，可以使用可信的 GitHub 公开文件加速镜像，但应核对下载地址来自 `bowling2005/3d-model-search-workbench` 的公开 Release，不要把 GitHub 账号密码交给第三方镜像。

## 安全与隐私

- 凭据仅保存在本机。
- 密码和 API Key 使用 Electron `safeStorage` 加密。
- 浏览器登录会话按站点和账号隔离。
- 不在日志中写入密码、Cookie 或 API Key。
- 应用不绕过登录、验证码、付费墙、额度或站点访问控制。
- 自动发现只探测公开页面，新来源默认停用。
- “免费”不等于“可商用”；发布项目前应核对原始许可。

安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 测试

```powershell
npm run typecheck
npm test
npm run build
```

可选的真实流程冒烟测试：

```powershell
npm run stage2:smoke
npm run blender:smoke
```

这些命令会访问公开来源或启动本机 Blender，不属于默认 CI。

## 架构

```text
Electron + React
  ├─ Local SQLite asset library
  ├─ Hosted or local 3D Asset Server
  ├─ Access Broker / isolated WebView sessions
  ├─ Blender background worker
  └─ Unity UPM importer
```

主要目录：

```text
core/         数据库、搜索、下载、访问和流水线核心
electron/     桌面进程、IPC、凭据和登录窗口
src/          React 页面
blender/      Blender headless worker
unity/        Unity UPM importer
services/     3D Asset Server git submodule
database/     SQLite migrations
```

## 当前限制

- 当前主要面向 Windows。
- 89 个来源并不等于 89 个来源都能自动下载。
- 登录型站点的专用权限探测和认证下载适配器仍需逐站接入。
- 未配置 Blender 时不能进行面数核验和 FBX 后处理。
- Unity 插件当前不会自动生成复杂材质、Prefab 或 LOD。
- 应用不提供自动打码、短信接码、账号共享或权限绕过。

## 文档

- [实现文档](IMPLEMENTATION.md)
- [查询引擎设计](QUERY_ENGINE_DESIGN.md)
- [最新交付范围](STAGE_ROADMAP.md)
- [Blender / Unity 对接契约](PIPELINE_INTEGRATION.md)
- [账号与访问接口](ACCESS_INTEGRATION.md)
- [来源发现接口](SOURCE_DISCOVERY.md)
- [项目调研](PROJECT_RESEARCH.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交新来源连接器时，请同时提供：

- 来源许可说明。
- 离线 fixture。
- 失败和限流测试。
- 不包含账号 Cookie 或私人数据的真实响应快照。

## License

本项目使用 MIT License，见 [LICENSE](LICENSE)。

3D Asset Server 作为 Git submodule 使用，遵循其 Apache-2.0 许可证。
