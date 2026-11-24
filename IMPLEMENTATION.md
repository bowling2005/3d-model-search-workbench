# Unity 3D 资产工作台：实现文档

> 版本：1.0
> 日期：2026-11-23
> 依据：[PROJECT_PLAN.md](PROJECT_PLAN.md)、[PROJECT_RESEARCH.md](PROJECT_RESEARCH.md)、[QUERY_ENGINE_DESIGN.md](QUERY_ENGINE_DESIGN.md)、用户现有的 82 条站点记录，以及 3D Asset Server 的 27 个实际集成来源。
> 目标平台：Windows 10/11、Blender LTS、Unity LTS。

## 1. 实现目标

实现一个本地桌面应用，完成以下闭环：

```text
发现来源
  -> 多站搜索
  -> 许可和访问检查
  -> 下载
  -> 隔离解压和校验
  -> Blender 面数/拓扑/材质处理
  -> Unity 导入
  -> 来源、许可和导入记录归档
```

首版不追求让 89 个来源全部完全自动化。首版目标是：

- 建立统一的 89 个来源注册表。
- 复用 3D Asset Server 的公共来源搜索和下载能力。
- 至少启用 8–12 个公共来源和 2 个需要登录的来源。
- 完成 Blender 后台检测与转换。
- 完成 Unity UPM 插件和一次可审计导入。
- 把站点授权建模为可恢复任务，而不是失败状态。

## 2. 最终采用的架构

```text
┌────────────────────────────────────────────────────────────┐
│ Tauri 2 + React 桌面 GUI                                   │
│ 搜索 / 资产库 / 下载 / 访问待办 / Blender / Unity / 来源 │
└───────────────┬───────────────────────────────┬────────────┘
                │ Tauri IPC                     │ 本地 HTTP
                ▼                               ▼
┌──────────────────────────┐       ┌────────────────────────┐
│ Rust Core                │       │ Asset Discovery Core   │
│ 任务队列、索引、策略     │       │ 3D Asset Server fork   │
│ 许可证据、Unity 交接     │       │ 公共 provider、下载    │
└────────────┬─────────────┘       └───────────┬────────────┘
             │                                  │ Scoped HTTP
             │                                  ▼
             │                    ┌────────────────────────┐
             └───────────────────>│ Access Broker          │
                                  │ 账号、会话、权限、额度 │
                                  └───────────┬────────────┘
                                              │
                                  ┌───────────▼────────────┐
                                  │ Windows Vault /        │
                                  │ Stronghold             │
                                  └────────────────────────┘

Blender Worker                       Unity Editor Plugin
后台 Python / JSON 作业               UPM / C# / AssetDatabase
```

### 2.1 为什么分成三个进程

- **Asset Discovery Core** 负责站点适配和公共下载，避免重新实现 27 个 provider。
- **Access Broker** 单独持有账号和会话，provider 只能获得短期、域名受限的请求能力。
- **Rust Core** 负责任务、数据库和本地业务状态，避免 GUI 与爬虫生命周期耦合。

任何进程崩溃都不能让账号秘密进入日志，也不能留下“已成功”但实际未下载的资产。

### 2.2 开源项目使用决策

| 项目 | 用法 |
|---|---|
| 3D Asset Server | fork 固定版本，作为本地公共搜索/下载 sidecar |
| Game Asset Finder MCP | 参考许可策略、逐站状态、游标和本地 sidecar |
| Universal GLB Grabber | 参考 GLB 封装和手动网页导入，不进入自动采集 |
| 3d-extracter | 参考文件头识别；无 LICENSE，禁止复制 |
| BlenderKit | 参考 Blender 内搜索体验；GPL，保持独立 |
| blender-asset-importer | 参考/复用 MIT 的 PBR 识别和 ZIP 导入 |
| glTFast | Unity GLB/glTF 正式依赖 |
| keyring-rs / Tauri Stronghold | 系统凭据和加密保险库 |

复用代码时必须：

1. 固定上游 commit。
2. 保留原 LICENSE、NOTICE 和版权声明。
3. 在 `THIRD_PARTY_NOTICES.md` 登记依赖和用途。
4. 对来源协议、许可证和凭据边界重新测试，不继承上游的行为假设。

## 3. 来源去重与合并

### 3.1 合并结果

实际输入与结果：

| 项目 | 数量 |
|---|---:|
| 用户 CSV 原始记录 | 82 |
| 用户 CSV 去重后的站点 | 78 |
| 3D Asset Server 实际集成来源 | 27 |
| 双方重叠来源 | 16 |
| 仅 3D Asset Server | 11 |
| 仅用户清单 | 62 |
| 最终唯一站点 | **89** |

生成文件：

- `sources.merged.json`：主注册表，保留全部来源和原始条目。
- `sources.merged.csv`：便于人工审阅的扁平表。
- `sources.upstream27.json`：上游来源快照。
- `scripts/merge-sources.ps1`：可重复执行的合并脚本。

### 3.2 合并规则

1. 用户 CSV 每一行都保留在 `seed_entries` 中，合并不会丢原始名称、URL、格式、许可摘要和备注。
2. 站点 ID 优先使用已验证的规范 ID，其次使用规范域名。
3. 同一个站点的不同栏目合并为别名：
   - Poly Haven Models/Textures。
   - Quaternius 主站/动画库。
   - Meshy 首页/游戏模型分类。
   - itch.io 主站/KayKit 作者页。
4. `blenderkit.com` 和 `blendkit.com` 视为同一服务别名。
5. 仅名称相似不能合并；必须通过域名、重定向或站点内容验证。
6. 用户来源默认 `seed_unverified + enabled=false`，探测成功后再启用。
7. 上游已集成来源默认 `upstream_integrated + enabled=true`，但仍然要逐站探测当前许可和权限。

### 3.3 16 个重叠来源

```text
Poly Haven
ambientCG
cgbookcase
BlenderKit
Fab
Kenney
Quaternius
TextureCan
CGTrader
TurboSquid
itch.io
Polyfork
3DAssets.dev
OpenGameArt
Sketchfab
Grab3D
```

其中部分上游来源主要提供材质或 HDRI，不应在模型搜索时默认发送请求；所有搜索都应带 `type=model` 或资产类型过滤。

### 3.4 11 个仅上游来源

```text
ShareTextures
Poliigon
3DTextures.me
3DTexel
Textures.com
HDRMAPS
HDRI Hub
FreeStylized
Wikimedia Commons
Scenario 3D Collection
LazyTextures
```

这些来源中有些是材质/环境资产站。首版应在来源中心展示，但只对“模型”目标启用适合的来源。

### 3.5 来源统一模型

合并后的单条来源必须符合以下语义：

```json
{
  "source_id": "sketchfab",
  "display_name": "Sketchfab",
  "homepage": "https://sketchfab.com",
  "domains": ["sketchfab.com"],
  "aliases": [],
  "provenance": {
    "upstream_3d_asset_server": {
      "source_id": "sketchfab",
      "access": "api"
    },
    "user_catalog_row_ids": ["23"]
  },
  "access": {
    "search": "candidate",
    "license_metadata": "unverified",
    "download": "unverified",
    "auth_required": "unverified",
    "entitlement_required": "unverified",
    "rate_limit": "unverified"
  },
  "connector_status": "upstream_integrated",
  "enabled": true
}
```

来源能力必须按阶段拆开，不能只存一个“要不要登录”：

```text
search_access
detail_access
license_access
download_access
entitlement_access
```

例如某个站点可能公开搜索、公开许可，但下载需要登录；不能因此把整个站点标记为不可访问。

### 3.6 来源状态机

```text
SEED
  -> DISCOVERED
  -> PROBING
  -> BETA
  -> VERIFIED
  -> DEGRADED
  -> ACCESS_REQUIRED
  -> BLOCKED
  -> REJECTED
```

- `SEED`：来自用户 CSV，尚未验证。
- `PROBING`：正在测试 robots、页面结构、许可和下载能力。
- `BETA`：有自动配方但尚未通过足够样本。
- `VERIFIED`：离线 fixture、live 测试和采样下载均通过。
- `ACCESS_REQUIRED`：结构可解析，但登录/领取/额度/验证码需要用户。
- `BLOCKED`：站点条款或技术边界明确禁止自动访问。
- `REJECTED`：不适用于模型、无许可、盗版风险或长期不可用。

## 4. 来源探测与自动发现

### 4.1 用户来源验证流程

对 `sources.merged.json` 中每个未验证站点执行：

1. 解析最终 URL 和重定向链。
2. 检查 `robots.txt` 和站点条款。
3. 判断首页是“站点”“具体模型”“作者页”还是“聚合链接”。
4. 尝试获得至少 3 个模型详情页。
5. 提取标题、作者、缩略图、许可、格式、大小和下载入口。
6. 区分搜索、许可、下载分别需要什么权限。
7. 检查 ZIP 和外部跳转。
8. 生成 `SourceProbeReport`。
9. 生成声明式 recipe 或 custom provider 草案。
10. 通过 fixture 测试后进入 BETA。

探测报告必须记录失败原因，不能只返回空列表：

```json
{
  "source_id": "example",
  "checked_at": "2026-11-23T15:00:00+08:00",
  "final_url": "https://example.com/",
  "robots": "allowed",
  "terms": "review_required",
  "listing_found": true,
  "detail_found": true,
  "license_found": true,
  "download_access": "account_required",
  "formats": ["FBX", "GLB"],
  "candidate_count": 24,
  "status": "ACCESS_REQUIRED",
  "next_action": "configure_browser_session"
}
```

### 4.2 新来源发现与合并

新来源发现由以下来源组成：

- 3D Asset Server 每日来源发现流程。
- 多语言 Web 搜索。
- 现有来源外链。
- GitHub `awesome` 和开放数据目录。
- 用户粘贴或导入的站点。
- 应用内浏览器“加入来源”。
- 上游的 rejected 记录，避免重复评估同一站点。

新候选先写入 `sources.candidates.json`，流程为：

```text
Candidate
  -> canonical domain
  -> registry conflict check
  -> allow/deny/terms probe
  -> sample extraction
  -> recipe generation
  -> fixture/live tests
  -> beta
  -> verified
```

同一站点二次发现时只更新 `last_seen_at`、健康度和候选信息，不创建重复来源。

### 4.3 更新检测

每个已启用来源使用最适合的增量策略：

- API：游标或 `updated_at`。
- RSS：GUID、发布日期和内容哈希。
- Sitemap：`lastmod` 和 URL 集合差异。
- HTML：规范 URL、标题、缩略图哈希和许可片段哈希。
- 详情页：下载最终 URL、文件 SHA-256 和许可证据哈希。

更新事件写入 `source_changes`，分为：

```text
NEW_ASSET
UPDATED_ASSET
REMOVED_ASSET
LICENSE_CHANGED
FILE_REPLACED
LAYOUT_DRIFT
RATE_LIMITED
AUTH_REQUIRED
```

上游更新不能覆盖已导入 Unity 的文件，只能生成“可用新版本”提示。

## 5. Asset Discovery Core

查询、缓存、超时、熔断和排序的具体算法见 `QUERY_ENGINE_DESIGN.md`。总体原则是本地索引优先、来源级 TTL 判断、实时结果流式补充，不等待所有来源。

### 5.1 集成方式

首版 fork `arielshad/3d-asset-server` 到：

```text
services/asset-discovery/
```

启动条件：

- Node.js 20+，由应用捆绑运行时或独立 sidecar。
- 仅监听 `127.0.0.1` 随机端口。
- 每次启动生成短期 Bearer token。
- 下载目录固定为应用 staging 目录。
- 默认关闭公网部署和不需要的远端 MCP。

核心接口：

```text
GET  /v1/providers
GET  /v1/search?q=...&type=model&free=true&downloadable=true
GET  /v1/assets/{provider}:{id}
GET  /v1/assets/{id}/files
GET  /v1/assets/{id}/download
GET  /health
```

### 5.2 Provider 扩展

在原有 provider 接口上增加访问上下文：

```ts
interface ScopedHttpClient {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  download(url: string, destination: string): Promise<DownloadReceipt>;
}

interface AccessContext {
  http: ScopedHttpClient;
  authProfileId?: string;
  requestId: string;
}

interface Provider {
  id: string;
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderSearchResult>;
  getAsset(id: string, ctx: ProviderContext): Promise<ProviderAssetResult | null>;
  buildSearchUrl(query: SearchQuery): string;
}
```

约束：

- provider 看不到密码、完整 Cookie、OAuth refresh token。
- `ScopedHttpClient` 只能访问当前来源声明的域名。
- 句柄有任务 ID、来源 ID、过期时间和最大请求数。
- 下载认证 URL 由 Access Broker 发起，provider 只获得本地 staging 文件路径。
- 发起任何写操作前必须经过站点能力声明和用户策略检查。

### 5.3 统一结果字段

```json
{
  "asset_id": "local-uuid",
  "source_id": "kenney",
  "source_asset_id": "source-specific-id",
  "title": "Low Poly Trees",
  "author": "Kenney",
  "source_url": "https://kenney.nl/assets/...",
  "thumbnail_url": "https://...",
  "license": {
    "id": "CC0-1.0",
    "commercial_allowed": true,
    "attribution_required": false,
    "evidence_id": "evidence-uuid"
  },
  "formats": ["FBX", "GLB"],
  "asset_type": "model",
  "style_tags": ["low-poly"],
  "access": {
    "search": "public",
    "download": "public"
  },
  "downloadability": "direct"
}
```

所有 provider 输出都经过 schema 校验。缺失字段用 `null` 或 `unknown`，不要伪造为可用。

## 6. Access Broker 与账号管理

### 6.1 组件职责

Access Broker 负责：

- 管理站点账号档案。
- 保存 API Key、Cookie、OAuth token 等秘密。
- 打开隔离登录窗口。
- 检测会话有效性。
- 验证资源领取和平台所有权。
- 读取额度。
- 向 provider 签发受限 HTTP 能力。
- 把失败转换为访问待办。

### 6.2 凭据模式

优先级：

1. 无凭据。
2. 浏览器会话。
3. OAuth 2.0 + PKCE。
4. API Key。
5. HTTP Basic/Token。
6. 用户名密码登录，仅限站点允许且用户明确启用。

浏览器会话是处理验证码、短信、邮箱验证、设备验证的首选。

### 6.3 存储方式

- `keyring-rs` 对接 Windows Credential Manager。
- Tauri Stronghold 保存结构化 Cookie、Token 和长会话数据。
- 随机保险库主密钥保存在 Windows Vault。
- SQLite 只保存 `credential_ref`、状态和掩码信息。
- 密码保存后不可回显，只能替换或删除。

示意：

```json
{
  "access_profile_id": "ap_sketchfab_main",
  "source_id": "sketchfab",
  "display_name": "Sketchfab 主账号",
  "auth_mode": "browser_session",
  "username_hint": "u***@example.com",
  "credential_ref": "vault://sites/sketchfab/ap_sketchfab_main",
  "scopes": ["search", "download_owned_free"],
  "status": "valid",
  "last_verified_at": "2026-11-23T14:00:00+08:00",
  "expires_at": null
}
```

### 6.4 登录流程

1. 下载任务遇到 `AUTH_REQUIRED`。
2. 创建 `pending_actions`，原任务保存 checkpoint。
3. 用户点击“配置访问”。
4. 应用显示需要访问的域名、授权目的、保存内容和权限范围。
5. 打开该站点的隔离 WebView2 profile。
6. 用户完成登录、2FA、验证码或免费资源领取。
7. 应用调用权限探针验证账号可用。
8. 保存最小必要会话，更新权限和额度快照。
9. 恢复原任务，不重新执行整批搜索。

### 6.5 权限和额度

权限结果分为：

```text
PUBLIC
LOGIN_REQUIRED
CLAIM_REQUIRED
OWNED
NOT_OWNED
QUOTA_AVAILABLE
QUOTA_EXHAUSTED
REGION_BLOCKED
AUTOMATION_PROHIBITED
UNKNOWN
```

额度来源优先级：

1. 正式 API。
2. 账号页面的结构化数据。
3. 页面中的明确额度文本。
4. 人工配置。

达到额度后任务进入 `QUOTA_WAIT`，显示重置时间，不轮换账号规避限制。

### 6.6 账号隔离

- 一个站点可以有多个档案，但用户必须明确选择当前档案。
- Cookie 按站点/登录域隔离。
- CDN 请求默认不携带站点 Cookie，除非站点能力描述明确允许。
- 任何外部重定向重新校验目标域名。
- 秘密不导出，不进入诊断包，不发给外部搜索服务或 LLM。

## 7. 下载和文件处理

### 7.1 下载状态

```text
QUEUED
ACCESS_PENDING
DOWNLOADING
PAUSED
VERIFYING
EXTRACTING
READY_FOR_INSPECTION
FAILED
CANCELLED
```

### 7.2 文件目录

```text
data/
  staging/
    <download-id>/
  library/
    <source-id>/
      <asset-id>/
        source/
        converted/
        preview/
        manifest.json
        license.json
        inspection.json
  cache/
  logs/
```

### 7.3 安全校验

- 下载前限制 URL、文件大小和域名。
- 内容长度和实际文件大小一致。
- SHA-256 写入文件记录。
- 拒绝绝对路径、`..`、符号链接逃逸和异常压缩比。
- 解压后限制总大小和文件数。
- 通过 magic bytes 与 Blender 导入双重识别格式。
- 对 `.blend` 禁用自动执行脚本。
- 下载失败或中断不得把半成品送到 Blender/Unity。

## 8. Blender Worker

### 8.1 启动

```text
blender.exe
  --background
  --factory-startup
  --disable-autoexec
  --python scripts/worker.py
  -- job.json
```

应用保存：

- Blender 可执行路径。
- 实际版本。
- 支持的版本范围。
- 任务超时。
- 临时目录。
- 默认导出格式和坐标轴设置。

### 8.2 作业类型

```text
inspect
convert
normalize_materials
render_preview
batch
```

建议先启动一个 Blender 进程执行多个作业，降低启动开销；工作进程崩溃后隔离失败，不阻塞整个队列。

### 8.3 检测结果

```json
{
  "schema_version": "1.0",
  "blender_version": "4.x",
  "source_format": "fbx",
  "objects": 8,
  "meshes": 6,
  "vertices": 2418,
  "triangles": 4300,
  "polygons": 2200,
  "uv_layers": 1,
  "materials": 2,
  "textures": 4,
  "armatures": 0,
  "animations": 0,
  "shape_keys": 0,
  "bounds": [2.1, 1.0, 1.8],
  "issues": {
    "non_manifold_edges": 0,
    "boundary_edges": 24,
    "loose_vertices": 0,
    "degenerate_faces": 0,
    "duplicate_faces": 0,
    "flipped_normals": false
  },
  "warnings": [],
  "outputs": {
    "fbx": "converted/model.fbx",
    "glb": "converted/model.glb",
    "preview": "preview/model.glb"
  }
}
```

### 8.4 自动修复边界

默认执行：

- 统计。
- 删除真正无引用的临时数据。
- 标记可疑几何。
- 应用导出前必要的变换。

用户确认后执行：

- 合并近重复顶点。
- 删除松散顶点。
- 重算法线。
- 应用统一缩放。
- 整理统一根层级。

不自动执行：

- 全量重拓扑。
- 猜测修复所有边界边。
- 破坏形状的 aggressive merge。
- 未经确认替换全部材质。

### 8.5 材质规范化

参考 MIT 项目 `blender-asset-importer` 的贴图命名识别：

- Base Color / Albedo / Diffuse。
- Normal。
- Roughness / Gloss 反向转换。
- Metallic。
- AO / Cavity。
- Height / Displacement。
- Emission。
- Alpha / Opacity。
- Transmission。

输出 `material_manifest.json`：

```json
{
  "materials": [
    {
      "source_name": "Wood_Old_Mat",
      "target_name": "M_Wood_Old",
      "textures": {
        "base_color": "textures/wood_old_albedo.png",
        "normal": "textures/wood_old_normal.png",
        "roughness": "textures/wood_old_roughness.png"
      },
      "confidence": 0.98,
      "manual_review_required": false
    }
  ]
}
```

无法可靠识别的材质保留原图并在 GUI 标记“待确认”。

## 9. Unity 插件

### 9.1 包结构

```text
unity/com.model-library.importer/
  package.json
  Editor/
    ModelLibraryWindow.cs
    ImportRequestWatcher.cs
    ImportExecutor.cs
    ModelImportProfile.cs
    MaterialBuilder.cs
    LicenseReportWriter.cs
  Runtime/
  Tests/
```

### 9.2 项目识别

打开 Unity 项目时检测：

- `ProjectSettings/ProjectVersion.txt`。
- `Packages/manifest.json`。
- Built-in/URP/HDRP。
- glTFast 版本。
- 是否安装 Newtonsoft JSON。
- inbox/outbox 是否可写。
- 未保存场景和未完成编译。

### 9.3 交接协议

桌面应用写入：

```text
<UnityProject>/.model-library/inbox/<request-id>.json
```

Unity 插件读取、验证并执行，然后写：

```text
<UnityProject>/.model-library/outbox/<request-id>.result.json
```

资源复制到：

```text
Assets/ModelLibrary/<source-id>/<asset-id>/
```

示例请求：

```json
{
  "request_id": "req-uuid",
  "asset_id": "asset-uuid",
  "source_dir": "<workspace>/data/library/kenney/asset-uuid",
  "target_dir": "Assets/ModelLibrary/kenney/asset-uuid",
  "render_pipeline": "urp",
  "preferred_format": "fbx",
  "material_mode": "normalize",
  "generate_prefab": true,
  "dry_run": false,
  "license_file": "license.json",
  "material_manifest": "material_manifest.json"
}
```

### 9.4 Unity 导入策略

- FBX：Unity 原生 `ModelImporter`。
- GLB/glTF：`com.unity.cloud.gltfast`。
- 批量导入使用 `AssetDatabase.StartAssetEditing()`/`StopAssetEditing()`，始终在 `try/finally` 中调用结束。
- 导入前保存当前模型导入配置，失败可回滚项目侧生成的文件。
- 生成材质时保留原材质映射。
- 导入结果包含警告、路径、GUID、许可和来源。

### 9.5 dry-run

导入前生成：

- 将复制的文件。
- 将创建或覆盖的资源。
- FBX/GLB 导入器参数。
- 材质和贴图创建结果。
- 动画和骨骼说明。
- 许可和署名要求。

默认不覆盖已有导入资产。覆盖必须由用户确认，并保留上一版本。

## 10. 本地 API 与数据模型

### 10.1 SQLite 主要表

```text
sources
source_recipes
source_probe_reports
source_changes
catalog_items
assets
asset_offers
asset_files
licenses
license_evidence
download_jobs
inspection_jobs
import_jobs
inspection_runs
material_mappings
access_profiles
auth_sessions
permission_snapshots
quota_snapshots
pending_actions
tags
asset_tags
imports
settings
```

### 10.2 关键字段

`sources`：

```text
source_id, display_name, homepage, canonical_host,
connector_status, enabled, access_json,
last_probe_at, last_success_at, health_score
```

`assets`：

```text
asset_id, canonical_title, author, asset_type,
style_tags_json, verified_triangle_count,
triangle_bucket, duplicate_group_id, created_at
```

`asset_offers`：

```text
offer_id, asset_id, source_id, source_asset_id,
source_url, license_id, formats_json, access_state,
downloadability
```

`license_evidence`：

```text
evidence_id, offer_id, license_url, snapshot_path,
terms_hash, captured_at, commercial_allowed,
attribution_required, user_decision
```

`access_profiles`：

```text
profile_id, source_id, auth_mode, username_hint,
credential_ref, scopes_json, status,
last_verified_at, expires_at
```

所有秘密字段只存引用，不存明文。

### 10.3 FTS 与去重

- `catalog_fts` 使用 SQLite FTS5，索引标题、作者、来源标签和标准化风格。
- 中文首版用预分词词典 + 子串回退，后续再考虑 trigram/embedding。
- URL 去重使用规范 URL。
- 文件去重使用 SHA-256。
- 几何/视觉相似只生成候选，不自动删除。

## 11. GUI 实现

### 11.1 页面

1. **发现**
   - 查询框。
   - 许可/格式/面数/风格筛选。
   - 来源启用状态。
   - 流式结果和逐站状态。
2. **资产库**
   - 已下载、已检测、重复候选、待审核。
   - 卡片和详情面板。
   - 3D 预览。
3. **下载**
   - 进度、暂停、恢复、取消、重试。
   - 权限/额度阻塞原因。
4. **访问待办**
   - 登录、二次验证、验证码、领取、额度、手动下载。
   - “配置并恢复”操作。
5. **Blender**
   - Blender 路径和版本。
   - 批量检测。
   - 拓扑、材质和转换问题。
6. **Unity**
   - 项目、渲染管线、导入预设。
   - dry-run、导入历史和结果。
7. **来源与账号**
   - 89 个来源。
   - 已启用、仅索引、待授权、阻塞。
   - 账号掩码、会话状态、权限、额度。
8. **设置**
   - 存储、网络、代理、日志、隐私、语言、主题。

### 11.2 状态展示

每个来源同时展示：

- 搜集能力：API / HTML / 仅链接 / 手动。
- 下载能力：公开 / 登录 / 领取 / 额度 / 手动。
- 许可信息：已验证 / 仅来源声明 / 未知。
- 最近成功时间。
- 当前阻塞动作。

禁止只显示一个笼统的“失败”。

### 11.3 交互要求

- 搜索按来源流式返回。
- 每个任务可以取消。
- 关闭应用后任务状态保留。
- 登录完成后自动恢复原任务。
- 批量导入前显示摘要。
- 许可、转换参数和登录范围不隐藏在默认值。
- 必须支持键盘、高 DPI、浅色/深色和中文界面。

## 12. 安全与合规

### 12.1 网络

- 默认只请求来源白名单域名。
- 本地 sidecar 只监听 loopback。
- 重定向后重新验证域名。
- 不请求用户未授权的内网地址。
- 不绕过登录、验证码、付费墙、DRM、地区限制或站点明确的自动化禁令。

### 12.2 凭据

- Windows Credential Manager/DPAPI + Stronghold。
- 秘密不写入普通配置、SQLite、日志、MCP 返回值和诊断包。
- 密码不显示明文。
- 同一来源可使用多个档案，但不能自动切换规避额度。
- 删除凭据不删除已下载资产和许可证据。

### 12.3 Blender/Unity

- Blender 禁用 `.blend` 自动执行。
- Unity 插件不接受任意 shell 命令。
- 只读取固定 inbox 目录和 schema 校验后的 JSON。
- 不直接写 Unity `Library`，不覆盖已存在资产。
- 模型文件和许可证据分开存储。

### 12.4 法律

- “免费”与“可商用”分开判断。
- 来源页快照与许可文本哈希必须保留。
- 没有可靠许可证据的来源不能进入自动商用流程。
- 网页已经加载、但站点没有提供下载入口的模型，不进入自动采集。

## 13. 测试计划

### 13.1 来源注册表

- 89 个来源 ID 唯一。
- 每个来源至少一个域名。
- 每个来源有来源证明。
- 合并脚本重复运行结果稳定。
- 修改 CSV 后不丢失手动覆盖。

### 13.2 搜索和 provider

- 单站超时不影响其他站点。
- 空结果、HTML 改版、429、需要登录、验证码可区分。
- 分页和 checkpoint 可恢复。
- 公共来源不携带其他站点 Cookie。

### 13.3 凭据

- 崩溃日志和诊断包不含密码、Cookie、Token。
- 会话过期进入待授权。
- 登录成功后原任务恢复。
- 跨域重定向不泄漏 Cookie。
- 删除凭据后无法继续访问该来源。

### 13.4 下载

- 断点续传和哈希校验。
- ZIP Slip、解压炸弹、符号链接逃逸。
- 错误格式和伪装文件。
- 下载中断不产生“可用”资产。

### 13.5 Blender

固定测试集：

- 干净低模。
- 非流形网格。
- 开放服装/叶片。
- 骨骼动画。
- 多材质和缺失贴图。
- 错误比例和超大多对象场景。

### 13.6 Unity

- Unity 2022.3 LTS + Unity 6 LTS。
- Built-in + URP。
- glTFast 和原生 FBX。
- 文件名冲突、未保存场景、编译错误和编辑器锁定。
- 重复导入的幂等性。

### 13.7 端到端

至少两条：

```text
公共来源：搜索 Kenney -> 下载 -> Blender 检测 -> Unity 导入 -> CREDITS
授权来源：搜索登录型站点 -> 访问待办 -> 登录 -> 权限验证 -> 下载 -> Unity 导入
```

## 14. 分阶段实现

### 阶段 A：注册表和公共来源

周期估算：1–2 周。

- 合并来源完成。
- 本地启动 3D Asset Server。
- 对接搜索、详情和下载。
- 显示逐站状态。
- 完成公共来源到本地资产库。

验收：

- 89 个唯一来源可见。
- 至少 8 个公共来源可以搜索。
- 至少 5 个公共来源可以下载。

### 阶段 B：访问代理与账号

周期估算：2–3 周。

- Windows 保险库。
- 账号档案。
- 隔离 WebView2。
- 权限探针。
- 额度状态。
- 访问待办与原任务恢复。

验收：

- 至少两个需要登录的来源完成闭环。
- 登录和授权不需要用户重新搜索。
- 凭据不出现在日志/SQLite 明文。

### 阶段 C：Blender

周期估算：2–3 周。

- 检测脚本。
- 面数分桶。
- 拓扑问题。
- FBX/GLB 转换。
- PBR 材质 manifest。
- 预览图。

验收：

- 20 个不同来源的模型可检测。
- 失败单模型不影响批次。
- 所有输出符合 JSON schema。

### 阶段 D：Unity

周期估算：2–3 周。

- UPM 插件。
- dry-run。
- FBX/GLB 导入。
- 材质创建。
- 导入结果回写。

验收：

- 同一资产可重复导入且结果稳定。
- Unity 2022.3 和 Unity 6 至少各验证一个项目。

### 阶段 E：自动发现和更新

周期估算：2–4 周。

- 新来源候选。
- recipe 生成。
- fixture/live test。
- 来源漂移检测。
- 资产更新提醒。

验收：

- 新来源可以生成 BETA 连接器。
- 结构变化进入 DEGRADED，不静默返回空结果。
- 文件更新不覆盖已导入版本。

### 阶段 F：生产化

周期估算：2–4 周。

- 安装包和签名。
- 数据库迁移。
- 崩溃恢复。
- 日志导出。
- 性能优化。
- 第三方声明和许可审计。

## 15. 第一周具体任务

### Day 1–2：技术验证

- 固定 3D Asset Server 版本并本地启动。
- 对其 27 个来源执行 `npm run test:live` 或等价探测。
- 选 10 个模型查询，保存请求、响应和失败状态。
- 检查下载目录和 ZIP 安全逻辑。

### Day 3：注册表

- 校验 `sources.merged.json` 的 89 个来源。
- 标记模型/材质/HDRI/角色等资产类型。
- 标记首期 12 个公共来源、6 个授权来源、风险来源。
- 产生 `sources.enabled.json` 子集。

### Day 4–5：桌面原型

- 建立 Tauri + React 工程。
- 显示用户来源和上游来源的合并列表。
- 调用本地 Discovery Core 搜索。
- 显示逐站状态、许可和下载按钮。
- 将下载结果写入 staging。

### Day 6–7：后端作业

- 编写 Blender `inspect.py` 最小版本。
- 对一个 GLB 和一个 FBX 输出检测 JSON。
- 设计 SQLite migration 和任务表。
- 完成首次端到端演示。

## 16. 首版需要明确的配置

```json
{
  "search": {
    "default_asset_type": "model",
    "max_concurrent_sources": 8,
    "per_source_timeout_seconds": 20
  },
  "blender": {
    "executable": "",
    "supported_major_versions": ["4.2", "4.5"],
    "job_timeout_seconds": 300,
    "default_export": "fbx"
  },
  "unity": {
    "project_path": "",
    "render_pipeline": "urp",
    "gltf_backend": "gltfast",
    "preferred_model_format": "fbx",
    "asset_root": "Assets/ModelLibrary"
  },
  "access": {
    "save_passwords": false,
    "prefer_browser_session": true,
    "auto_resume_after_login": true,
    "credential_export": false
  }
}
```

## 17. 不进入实现范围的内容

- 自动注册站点账号。
- 自动解决人机验证或短信接码。
- 自动绕过付费、地区和账号额度。
- 从任意网页响应中批量抓取模型。
- 自动下载版权来源不明的提取站内容。
- 自动合并所有模型材质。
- 无人工检查的全自动拓扑修复。
- 直接修改 Unity `Library` 或游戏项目的编译产物。

## 18. 最终交付物

首版完成时应至少包含：

- Windows 桌面安装包。
- 89 个去重来源注册表。
- 8–12 个已启用公共来源和 2 个登录型来源。
- 本地公共来源 sidecar。
- 本地访问代理和凭据保险库。
- Blender inspect/convert/preview 工作器。
- Unity UPM 插件。
- SQLite 资产库和任务队列。
- 许可证据与署名生成。
- 来源探测、漂移和资产更新记录。
- 第三方许可证与 NOTICE 清单。
