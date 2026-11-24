# 相关 GitHub 项目调研与架构建议

> 调研日期：2026-11-23
> 关注点：多站素材搜集、许可证归一化、Blender 导入与材质、Unity 导入、账号和权限管理。
> 注意：GitHub Star 和提交数是采用信号，不是质量和安全审计结论。

## 1. 结论摘要

这三类项目可以组合使用，但不应混成一个大而全的爬虫：

1. **3D Asset Server 是最值得优先验证的采集后端。** 它已有 27 个站点适配器、统一搜索、直接下载、许可字段、逐站状态、离线 fixture 和每日来源发现流程。它是 TypeScript、Apache-2.0、维护较活跃。
2. **Game Asset Finder MCP 适合作为数据模型和许可证策略参考。** 它的源码许可归一化、跨源去重、游标分页、来源状态和本地索引设计很好，但项目只有 1 个提交、采用度很低，且没有完整下载/Blender/Unity 流水线，不适合作为核心依赖。
3. **Universal GLB Grabber 和 3d-extracter 只能作为“用户主动触发的补充捕获工具”参考。** 它们解决的是从网页已加载内容中发现模型，不是来源站点的正式下载接口；“没有下载按钮也能下载”意味着明显的版权和站点条款风险。两者都没有在仓库中声明代码许可证，不应复制进产品。
4. **Blender 和 Unity 部分应自建薄集成层。** Blender 用后台 Python 任务；Unity 用编辑器插件。可以复用 MIT/Apache-2.0 项目的实现思路和依赖，但不要把第三方插件的 UI 和状态当作主数据源。
5. **账号管理需要自建“访问代理”，不要依赖网页抓取器。** 推荐系统保险库 + 隔离浏览器会话 + 每站权限探测 + 待办恢复。自动管理应指账号档案、会话、授权、额度、任务续跑，而不是自动破解验证码或绕过平台权限。

## 2. 重点项目的真实定位

### 2.1 3D Asset Server

- 仓库：[arielshad/3d-asset-server](https://github.com/arielshad/3d-asset-server)
- 技术：TypeScript、Node.js、Web UI、HTTP API、CLI、MCP。
- 许可：Apache-2.0。
- 调研快照：约 344 Stars、32 Forks、216 个提交，最近可见推送为 2026-11-22。
- 当前宣称覆盖：27 个来源，包括 Poly Haven、ambientCG、BlenderKit、Kenney、Quaternius、Fab、Sketchfab、3DAssets、Grab3D、OpenGameArt、CGTrader、TurboSquid、itch.io 等。

已确认的能力：

- 统一 `search_assets`、`get_asset`、`download_asset`、`list_providers` 工具。
- 一次搜索多个站点，结果合并和排序。
- 返回逐站状态，例如成功、超时、错误、跳过或仅链接。
- 归一化许可、免费状态、署名要求、格式、分辨率和面数等字段。
- 直接下载 GLB/glTF 及附属 `.bin` 和贴图，解析 ZIP，返回许可和署名行。
- 有 REST API 和 MCP。
- 有 provider 注册表、离线 fixture 测试和 live smoke test。
- 提供安全下载、ZIP 解压、缓存、超时、重试和限速的已有实现。
- 仓库中存在自动来源发现工作流：每天搜索未登记来源，检查 robots/条款，选择一个来源生成 provider、fixture 和测试，经过门禁后合并。

重要限制：

- 重点是搜索和下载，不负责 Blender 面数/拓扑检测、材质规范化或 Unity 导入。
- 不提供面向普通用户的账号保险库、多个账号档案、二次验证交互、免费商品领取和任务恢复。
- 登录限制的来源基本只返回链接；例如 Sketchfab 直接下载需要登录。
- 来源自动发现和适配器生成依赖外部 LLM 密钥，需要换成本地或可替换的发现器。
- 它的 provider 接口没有把“访问授权/秘密句柄”作为一等能力。
- 设计目标是通用网页资产搜索，默认资产类型包括纹理、HDRI、音频等，模型工具需要限制 `type=model`。
- 公共部署服务会收到搜索词，适合公共来源；私有授权来源不应把 Cookie 或搜索内容发给第三方服务器。

建议：

- 做一次把该项目固定到特定 commit、在 `127.0.0.1` 本地自托管的技术验证。
- 如果代码、测试和来源质量符合要求，将它作为“公共来源搜索与下载 sidecar”，桌面 GUI 通过本机 HTTP 调用。
- 扩展其 `Provider` 模型，增加 `access`、`permissionProbe`、`quota`、`credentialRef` 等元数据，但不要给 provider 直接读取原始 Cookie 的能力。
- 增加给 provider 的短期、域名受限 HTTP 会话句柄，由访问代理执行请求。
- 新站点发现保留两道门：候选发现可以自动化；“生成配方、测试、启用”仍要有可回滚记录和测试门。

### 2.2 Game Asset Finder MCP

- 仓库：[sudoriaa/game-asset-finder-mcp](https://github.com/sudoriaa/game-asset-finder-mcp)
- 技术：TypeScript、MCP stdio、本地索引。
- 许可：MIT。
- 调研快照：约 3 Stars、0 Forks、1 个提交，2026-08-18 首次提交后代码基本未推进。
- 来源：Kenney、OpenGameArt、itch.io、Openverse、ambientCG、Poly Haven、Freesound 和本地素材目录。

值得吸收的设计：

- 统一 `license_policy`：`any`、`commercial`、`cc0`、`no-attribution`。
- 未知许可不会被解释为可用，并通过 `include_unknown_license` 显式控制。
- 每个来源返回 `ok / partial / disabled / timeout / rate_limited / error`。
- URL 规范化、镜像来源合并、跨源去重和来源多样化。
- 中文关键词扩展和游戏术语召回。
- `limit + nextCursor` 分页，避免一次把全部结果送入模型或 UI。
- 缓存 TTL/LRU、并发去重、限流和 `Retry-After` 处理。
- 本地索引使用增量扫描、SHA-256、原子写入、根目录约束和符号链接跳过。
- 用 sidecar JSON 保存本地素材标题、作者、许可、来源和标签。

重要限制：

- 工具面主要是“搜索 + 详情 + 来源列表 + 本地索引”，没有完整下载和导入流水线。
- 只有少量来源，无法替代 30+ 站点注册表。
- 不能根据它已有的低采用度判断其稳定性。
- 只有 Freesound API Key 一类的简单凭据，没有站点账号、Cookie、OAuth、二次验证或额度恢复系统。

建议：

- 不把它作为唯一的搜索后端。
- 将它作为许可证策略、来源状态、本地 sidecar 和分页设计的参考实现。
- 如果直接复用代码，保留 MIT 许可证和第三方声明；仍建议自己增加端到端测试。

### 2.3 Universal GLB Grabber

- 仓库：[zheminwork/Universal-GLB-Grabber](https://github.com/zheminwork/Universal-GLB-Grabber)
- 技术：Windows CLI/EXE，从 HTML、外链 JS、直接链接和部分产品查看器提取 glTF。
- 调研快照：约 10 Stars、3 Forks、1 个提交；仓库未找到 LICENSE 文件。
- 输出：自包含 GLB、同名 JSON 报告；`.gltf` 可补充 `.bin` 和贴图。

有价值的技术点：

- 校验 GLB 2.0。
- 把外部 `.bin`、贴图和 data URI 封装成单文件 GLB。
- 扫描 HTML 和外链 JS，给出候选资源、Draco 状态和质量标签。
- 导出提取报告。
- README 明确表示不绕过登录、付费墙、DRM、验证码、签名 URL 或访问控制。

风险：

- 能发现“页面已经加载但没有正式下载按钮”的模型，不代表有权下载、分发或商用。
- 通过浏览器请求头重试 403 可能违反站点条款。
- 只覆盖 glTF/GLB，不转换 FBX、OBJ、USDZ。
- 仓库没有代码许可证，默认不能安全地复制或再分发其源码。

建议：

- 可作为“用户主动从我有权访问的产品页/网页导入模型”的独立辅助工具。
- 不纳入自动全网采集器，不对任意 URL 自动运行。
- 如果需要类似能力，自研并记录来源页、许可证据和用户授权确认；仅对白名单域名开放。
- 优先实现 `.gltf + .bin + textures → GLB` 的封装，而不做任意网络响应抓取。

### 2.4 3d-extracter

- 仓库：[hoodini/3d-extracter](https://github.com/hoodini/3d-extracter)
- 技术：Chrome Manifest 扩展、JavaScript。
- 调研快照：约 60 Stars、14 Forks、9 个提交；仓库未找到 LICENSE 文件。
- 宣称支持 GLB、glTF、FBX、OBJ、USDZ、STL、PLY、DAE、3DS、X3D、VRML 等。

有价值的技术点：

- 监听网页网络请求，按扩展名、MIME 和启发式规则识别模型。
- 通过文件头识别扩展名错误或 `.bin` 文件的真实格式。
- 选择候选资源后使用浏览器下载。
- 有网络检查器和手动标记功能。

高风险点：

- 宣传可以直接从“没有下载按钮”的网站保存模型。
- 会拦截已经加载到当前浏览器会话中的资源；这可能同时捕获登录后才显示、未授权下载或不允许再利用的内容。
- 没有明确的批量自动管理，但很容易被用来构建批量绕过网页交互的采集器。
- 代码没有许可证，不能合法假定可复制或嵌入。
- 网页资产不能因为技术上可读取，就自动获得商业使用许可。

建议：

- 不把网络流量拦截作为正式下载器。
- 学习其 magic-byte 格式识别和候选展示 UI，但代码与产品流程重新实现。
- 只在用户明确点击“从当前页导入”，且域名与条款通过策略检查时启用类似能力。
- 自动流程只使用来源站点公开 API、RSS/Sitemap/HTML 元数据和正式下载链接。

## 3. 其他值得参考的 GitHub 项目

### 3.1 Blender 导入和材质

#### BlenderKit / Blendkit

- 仓库：[BlenderKit/BlenderKit](https://github.com/BlenderKit/BlenderKit)
- 约 293 Stars、48 Forks；GPL-2.0。
- 官方 Blender 插件，支持在 Blender 内搜索、下载、拖放模型和材质；免费账户和 Full Plan 有权限差异。

建议：

- 作为 Blender 内搜索与拖放交互的参考。
- 如果要直接集成来源 API，可以单独实现 provider。
- 不要复制 GPL 代码进入闭源桌面程序。作为独立 GPL Blender 扩展分发则需遵守 GPL。

#### Asset Importer for Blender

- 仓库：[drune9d/blender-asset-importer](https://github.com/drune9d/blender-asset-importer)
- 约 8 Stars、5 个提交；MIT。
- 支持 ZIP 和目录批量导入，自动选择 LOD0/高质量网格，跳过 proxy、collision、low 变体。
- 能识别 Base Color、Metallic、Roughness、Gloss、Normal、Bump、Height、AO、Cavity、Emission、Alpha 等贴图。
- 安全解压、进度、取消、失败跳过、PBR 材质构建和贴图分辨率选择都比较贴近你的需求。

建议：

- PBR 文件命名识别和材质节点图是最值得借鉴的部分。
- MIT 许可有利于复用，但仍需保留版权和许可声明。
- 你的应用更适合把类似功能封装成 Blender 后台作业，而不是依赖用户先安装这个插件。

#### Multi-Platform Asset Search for Blender

- 仓库：[NNotTheCoder/blender-multi-asset-search](https://github.com/NNotTheCoder/blender-multi-asset-search)
- 约 2 Stars；GPL-3.0；支持 Sketchfab、Poly Haven、Poly Pizza 搜索后导入。
- API Key 保存到 Blender Preferences。

建议：

- 可作为“搜索到导入”的 UX 参考。
- 不建议把它作为安全凭据存储方案，也不要把其 GPL 代码混入闭源核心。

#### blender-ai-copilot-assets

- 仓库：[zovulrira1974/blender-ai-copilot-assets](https://github.com/zovulrira1974/blender-ai-copilot-assets)
- MIT；搜索 Poly Haven、Sketchfab、Poly Pizza，并在用户确认后导入；同时包含 MCP 和场景工具。
- 项目较新、采用数字用户名、提交数量与项目体量需要进一步审计，不能只凭 Star 判断可靠性。

建议：

- 可观察其“确认后导入、许可随结果展示、服务密钥集中保存、MCP 端点”的交互。
- 不把它作为资金/账号安全敏感功能的依赖。

### 3.2 Unity 导入

#### Unity glTFast

- 仓库：[atteneder/glTFast](https://github.com/atteneder/glTFast)
- 实际 Unity 包名：`com.unity.cloud.gltfast`。
- 约 1,494 Stars、294 Forks；Apache-2.0。
- 支持 Editor/Runtime 导入和导出，支持 Built-in、URP、HDRP。
- 官方包维护，适合作为 GLB 的主要 Unity 导入通道。

建议：

- 默认使用 Unity 原生 FBX 导入器处理 FBX。
- 对 GLB/glTF 使用 glTFast，Editor 导入后生成 prefab 和资源。
- 构建前检查 glTFast shader variants，避免编辑器中正常、打包后材质丢失。

#### GLTFUtility

- 仓库：[Siccity/GLTFUtility](https://github.com/Siccity/GLTFUtility)
- 约 1,112 Stars；MIT；支持 glTF/GLB、骨骼和动画。

建议：

- 作为轻量替代方案，不优先于 glTFast。
- 更新活跃度和渲染管线支持需按 Unity 版本重新验证。

#### Polyfork Unity Connector

- 仓库：[lucas-martinic/polyfork-unity-connector](https://github.com/lucas-martinic/polyfork-unity-connector)
- 约 8 Stars、88 个提交；Unity 6+，依赖 `com.unity.cloud.gltfast`。
- 在 Unity 内浏览目录、预览 GLB、调整参数并导入为 prefab，有 API Key 管理界面。

建议：

- 单来源连接器，但 Unity 内搜索、预览、导入和 API Key 的 UX 很值得参考。
- 不要照搬“把密钥放在 StreamingAssets”的做法；桌面应用的用户密钥应由系统保险库管理，Unity 插件只使用短期令牌。

### 3.3 账号、凭据和浏览器会话

#### keyring-rs

- 仓库：[open-source-cooperative/keyring-rs](https://github.com/open-source-cooperative/keyring-rs)
- 约 785 Stars；Apache-2.0。
- 跨平台系统密码库接口，可对接 Windows Credential Manager。

建议：

- 用于保存站点密码、API Key 或加密保险库的主密钥。
- 不要把 Cookie、Token 和密码以明文 JSON 保存。

#### Tauri Stronghold

- 仓库：[tauri-apps/tauri-plugin-stronghold](https://github.com/tauri-apps/tauri-plugin-stronghold)
- 官方镜像仓库，开发已迁移到 Tauri plugins workspace；约 109 Stars；Apache-2.0。

建议：

- 适合加密存储会话 Cookie、OAuth token 和多站点账号资料。
- 可以用系统保险库保存 Stronghold 主密钥，同时用 Stronghold 保存结构化会话。

#### Playwright

- 仓库：[microsoft/playwright](https://github.com/microsoft/playwright)
- 支持浏览器上下文隔离和 `storageState` 会话复用。

建议：

- 用于连接器测试、登录流程测试和某些站点的浏览器辅助，不适合要求用户把密码交给任意 LLM 代理的自动登录。
- 桌面 GUI 首选应用内 WebView2 交互登录，减少额外浏览器分发和平台差异。

#### gallery-dl

- 仓库：[mikf/gallery-dl](https://github.com/mikf/gallery-dl)
- 支持大量站点、统一 extractor、配置文件、用户名/密码、Cookie、OAuth、下载归档和限速。

建议：

- 作为“多站下载器 + 每站认证适配器”的成熟参考。
- 不直接嵌入，避免把图片站点下载器的模型套到 3D 资产许可和质检上。

## 4. 推荐的产品架构

```text
桌面 GUI
  ├─ 来源中心
  ├─ 搜索与资产库
  ├─ 访问待办与账号管理
  ├─ 下载队列
  ├─ Blender 质检
  └─ Unity 导入

公共来源服务
  ├─ 3D Asset Server 本地 sidecar 或 fork
  ├─ 公共 provider 注册表
  ├─ 搜索结果与逐站状态
  └─ 仅公开、可自动下载来源

本地访问代理
  ├─ 账号档案
  ├─ 系统保险库
  ├─ 隔离 WebView2 会话
  ├─ 权限探测
  ├─ 下载额度
  └─ 登录型 provider

资产处理
  ├─ 下载隔离目录
  ├─ 文件格式校验
  ├─ Blender inspect worker
  ├─ Blender normalize/convert worker
  └─ GLB preview

Unity
  ├─ 模型导入清单
  ├─ 原生 FBX importer 设置
  ├─ glTFast GLB 导入
  └─ 许可/来源结果
```

### 4.1 为什么不直接改造网页抓取扩展

浏览器扩展擅长“用户当前打开了一个网页，帮我找到已加载资源”，但缺少：

- 站点级搜索、分页和来源健康度。
- 许可详情与证据保存。
- 下载去重、版本和任务队列。
- 站点账号、权限、额度和登录恢复。
- Blender 检测和 Unity 导入。

扩展适合补充“手动交接”，不适合承担多站采集主链路。

### 4.2 建议的连接器分层

```text
PublicProvider
  无登录即可搜索、查看许可和下载

AuthenticatedProvider
  使用本地访问代理签发的短期请求会话
  账号、Cookie、Token 不进入 provider 返回值

LinkOnlyProvider
  只返回元数据和来源页，用户手动完成下载

BrowserHandoffProvider
  在隔离浏览器完成领取/验证/下载
  下载完成后把本地文件送回应用

LocalImporter
  用户选择本地 ZIP/FBX/GLB，进入同一质检和 Unity 流程
```

连接器只接受 `AuthSessionHandle`，不能读取完整保险库。访问代理负责：

- 是否允许向该域名发送 Cookie。
- Cookie 是否过期。
- 当前账号有哪些来源权限。
- 剩余下载额度。
- 哪些请求需要用户再次确认。

## 5. 自动管理账号与获取权限

### 5.1 应该自动化的部分

- 创建和维护每站账号档案。
- 安装和检测浏览器登录状态。
- 加密保存最小必要会话。
- 检查会话是否过期。
- 对 OAuth/API Key 自动刷新。
- 检查免费资源的领取状态和账号所有权。
- 读取站点显示的下载额度或平台 entitlement。
- 遇到权限不足时生成待办。
- 用户完成登录或领取后自动恢复原下载任务。
- 在用户明确授权后执行有限页面操作，例如打开资源页、点击“获取/加入库”。

### 5.2 不应自动化的部分

- 自动注册账号。
- 自动打码、短信接码或设备验证。
- 账号共享和令牌共享。
- 自动切换账号规避额度。
- 绕过地区、付费、订阅或站点访问控制。
- 未经用户确认直接输入主密码。
- 把 Cookie 发送给外部搜索服务、LLM 或自动发现的任意域名。

### 5.3 每站认证描述

```json
{
  "source_id": "example",
  "search_access": "public",
  "license_access": "public",
  "download_access": "account_required",
  "auth_strategies": ["browser_session", "oauth2"],
  "login_url": "https://example.com/login",
  "permission_probe": {
    "kind": "json_api",
    "url": "https://example.com/api/me/entitlements"
  },
  "quota_probe": {
    "kind": "page_rule",
    "selector": "[data-free-downloads-left]"
  },
  "automation_allowed": true,
  "automation_scope": ["open_asset_page", "download_owned_free_asset"],
  "requires_human_for": ["captcha", "mfa"]
}
```

### 5.4 建议的账号状态

```text
UNCONFIGURED
AUTHENTICATING
VALID
EXPIRING_SOON
EXPIRED
MFA_REQUIRED
CAPTCHA_REQUIRED
ENTITLEMENT_REQUIRED
QUOTA_WAIT
RATE_LIMITED
PERMISSION_DENIED
REVOKED
ERROR
```

这些状态必须与下载任务状态分开。账号过期不应污染模型的许可状态，也不应把已完成下载标记成失败。

### 5.5 站点类型的具体建议

| 来源类型 | 推荐接入方式 |
|---|---|
| Poly Haven、ambientCG、公开 CC0 站 | 直接 API/HTTP，自动下载 |
| BlenderKit | API Key；免费和已购授权分别检查 |
| Sketchfab | 公共搜索 + 用户交互登录；登录后有权限的下载交给本地访问代理 |
| Unity Asset Store | 不在桌面应用内抓取；通过 Unity 编辑器/包管理器完成领取和导入，应用检测结果 |
| Fab / Epic | SSO 登录，检查 entitlement；下载和导入可能需要 Epic Launcher 或 Unity 插件 |
| Mixamo | Adobe 交互登录；下载后交给本地导入流水线 |
| 每日限额/积分站 | 自动读取额度，达到上限后进入 `QUOTA_WAIT` |
| 只有免费账号才能看下载按钮 | 隔离 WebView2 登录，保存最小会话 |
| 禁止自动化或需要人机验证 | 只提供来源页和手动下载交接 |

“获取权限”在软件中的准确含义是：帮助用户完成站点要求的账号、领取、所有权验证和页面操作，并检测是否成功；它不是绕过站点权限，也不能替代模型许可证。

## 6. 推荐的 Blender 集成方式

不要依赖第三方插件才能工作。主应用应调用独立的 Blender 后台工作器：

```text
blender.exe --background --factory-startup --disable-autoexec
  --python scripts/worker.py -- job.json
```

工作器负责：

1. 导入源文件。
2. 统计对象、网格、三角面、多边形、顶点、UV、材质、贴图、骨骼、动画和形态键。
3. 检查非流形边、边界边、松散点、退化面、重复面、法线异常和包围盒。
4. 根据文件名和材质节点识别 PBR 贴图。
5. 生成规范材质 manifest，并导出 FBX/GLB。
6. 生成预览 GLB 和缩略图。

可参考 `drune9d/blender-asset-importer` 的 PBR 贴图识别、安全 ZIP 解压、批次进度和失败继续策略。若复用其代码，遵守 MIT 要求。

BlenderKit 和 Multi-Platform Asset Search 的 GPL 代码适合作为独立 Blender 扩展分发；不要让它们污染闭源桌面主程序，除非产品本身接受 GPL 约束。

## 7. 推荐的 Unity 集成方式

Unity 侧建议做成独立 UPM 编辑器包：

- 识别 Unity 版本、Built-in/URP/HDRP。
- 读取桌面应用生成的 import manifest。
- 使用原生 ModelImporter 处理 FBX，设置单位、坐标轴、材质、动画、Lightmap UV 和碰撞体。
- 使用 `com.unity.cloud.gltfast` 处理 GLB/glTF。
- 使用 `AssetDatabase.StartAssetEditing` 批量导入并处理异常恢复。
- 生成 Prefab、材质映射报告和许可结果。
- 导入完成后回写结果给桌面应用。

glTFast 是这里最合适的基础依赖：官方 Unity 包、Apache-2.0、同时支持 Editor/Runtime 和三种主要渲染管线。Polyfork 连接器可以用于学习 Unity 内浏览、预览和导入的 UX，但不适合直接作为通用多站方案。

## 8. 建议采用的项目组合

| 模块 | 推荐选择 | 决策 |
|---|---|---|
| 公共多源搜索/下载 | 3D Asset Server | 先本地集成测试，再考虑 fork |
| 许可归一化 | Game Asset Finder MCP | 参考 schema 与策略，不作为唯一后端 |
| 浏览器手动捕获 | Universal GLB Grabber / 3d-extracter | 仅辅助，不进入自动采集主链路 |
| Blender 内搜索体验 | BlenderKit | 参考，必要时单独 GPL 插件 |
| Blender PBR 材质 | blender-asset-importer | 优先参考/复用 MIT 实现 |
| Unity GLB | glTFast | 作为正式依赖 |
| Unity 单来源 UX | Polyfork Connector | 参考，不通用化其 API |
| 凭据保险库 | keyring-rs + Tauri Stronghold | 本地保存，域隔离 |
| 登录会话测试 | Playwright | 用于开发和自动化测试 |
| 多站认证架构 | gallery-dl | 参考 extractor/auth/config 分离 |

## 9. 实施顺序建议

### 第一步：验证而不是重写

1. 在本地运行 3D Asset Server。
2. 选择 10 个常用模型查询，测试搜索质量、逐站失败、许可字段和下载完整性。
3. 检查它的 provider、下载、ZIP 和测试模块是否适合直接复用。
4. 用我们的 `inspect.py` 对至少 20 个下载结果做面数、格式和贴图检测。
5. 用 Unity glTFast 导入 5 个 GLB，用原生 importer 导入 5 个 FBX。

### 第二步：建立桌面壳和本地访问代理

1. 桌面 GUI 显示公共来源结果和逐站状态。
2. 建立本地资产库、任务队列和许可证据。
3. 建立 Windows Credential Manager/Stronghold 保险库。
4. 添加账号配置、隔离 WebView2、会话验证和访问待办。
5. 选择一个需要登录的来源，完成“搜索 → 待授权 → 登录 → 下载 → 检测”的闭环。

### 第三步：Blender 与 Unity 流水线

1. 实现后台 `inspect`、`convert` 和 `preview` worker。
2. 增加面数分桶、拓扑报告和安全修复。
3. 参考 MIT 项目实现 PBR 贴图匹配。
4. 实现 Unity UPM 插件、dry-run 和导入结果回写。

### 第四步：自动发现与扩展

1. 扩展来源注册表至 30+。
2. 将来源发现与 provider 生成做成带 fixture、live test 和回滚的流水线。
3. 增加 RSS/API/Sitemap 更新跟踪。
4. 增加站点改版监控和待授权来源能力升级。
5. 根据站点实际行为逐站增加额度检查、权限探测和人工确认。

## 10. 最重要的产品边界

建议把产品定位为：

> 一个本地化的、可审计的 Unity 素材工作台；它帮助用户从公开和已授权来源发现、获取、检查、转换并导入模型。

不要定位为：

> 一个能抓取任意网站的模型下载器。

前者可以长期维护并形成真正的产品价值；后者会把主要工作量消耗在反爬、账号风控和版权争议上，且很难保证 Unity 资产质量。
