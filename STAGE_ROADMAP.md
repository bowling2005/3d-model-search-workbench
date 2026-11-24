# 重新规划后的阶段路线

> 更新日期：2026-11-24
> 原则：未完成能力保留稳定接口，不在当前阶段强行做成完整产品；Blender 未配置时，仅禁用需要 Blender 的核验与后处理。

## 1. 当前已完成

### 阶段 1：基础平台

状态：完成。

- Electron + React + TypeScript 桌面应用。
- SQLite 持久化和迁移。
- 89 个去重来源注册表。
- 来源搜索、筛选和启用状态管理。

### 阶段 2：公共来源搜索与下载

状态：完成。

- 固定版本 3D Asset Server sidecar。
- 多来源实时搜索、逐站状态、超时和取消。
- 查询缓存优先，实时结果流式补充。
- 格式、面数、免费和直接下载筛选。
- 下载隔离、重定向检查、ZIP 安全解压、SHA-256 和许可记录。

### 阶段 3：下载资产管理与本地 DCC 交接

状态：完成当前范围内的闭环。

- “我的资产”页面显示本地下载资产。
- Blender 路径自动检测和手动选择。
- Blender 未配置时禁用“核验面数与拓扑”和“清理并导出 FBX”。
- Blender 后台核验三角面、顶点、多边形、UV、材质、骨骼、动画和拓扑。
- Blender 安全处理：应用变换、合并近重复顶点、删除松散点、重算法线。
- Blender 导出 Unity 工作格式 FBX。
- Unity 项目路径选择和持久化。
- Unity UPM 导入插件安装。
- Unity inbox/outbox 请求协议。
- 使用一次性 Unity 项目完成实际验证：
  - 导入 `processed.fbx`。
  - 创建 `Assets/ModelLibrary/Validation/ModelSearchImportValidation.unity`。
  - 场景包含模型、相机和方向光。

## 2. v0.1.0 之后的增强

当前核心工作流已经收尾，不再按大阶段扩张。以下均为可选增强：

- 站点专用授权适配器：Sketchfab、Unity Asset Store、Fab、Mixamo 等。
- 搜索服务 API、provider recipe 自动生成和 fixture 审核。
- 资产目录增量同步、上游更新和许可变化检测。
- Blender 批量队列、材质预设和任务 checkpoint。
- 安装包签名、自动更新、数据库备份和完整兼容性矩阵。

账号接口见 `ACCESS_INTEGRATION.md`。
来源发现接口见 `SOURCE_DISCOVERY.md`。

## 3. 当前接口边界

### Blender

设置键：

```text
blender.path
```

调用契约：

```text
blender.exe --background --factory-startup --disable-autoexec
  --python-exit-code 1
  --python blender/worker.py -- <job.json>
```

输入和输出定义见 `PIPELINE_INTEGRATION.md`。
未完成：批量材质重写、复杂重拓扑、纹理自动烘焙和批量任务恢复。

### Unity

项目设置键：

```text
unity.projectPath
```

UPM 包：

```text
unity/com.modelsearch.importer
```

交接目录：

```text
<UnityProject>/.model-library/inbox/
<UnityProject>/.model-library/outbox/
<UnityProject>/.model-library/archive/
```

未完成：URP/HDRP 材质预设、Prefab 自动生成、glTFast 自动安装、批量导入失败恢复。

### 账号与访问

通用账号与会话基础已实现，站点专用自动登录和验证码处理仍由用户完成。后续扩展流程：

```text
搜索/下载任务
  -> 权限检查
  -> ACCESS_REQUIRED
  -> 用户登录或领取
  -> 权限快照和额度快照
  -> 恢复原任务
```

## 4. v0.1.0 验收

| 模块 | 结果 |
|---|---|
| 来源注册 | 89 个来源可查询、持久化和启停 |
| 搜索与下载 | 公共来源可搜索和下载，失败逐站隔离 |
| 资产处理 | Blender 核验/处理并导入 Unity 验证 Scene |
| 账号访问 | 本地账号档案、安全存储、隔离登录会话和授权待办 |
| 来源发现 | 手动候选、来源外链扫描、候选评分和人工审核 |
