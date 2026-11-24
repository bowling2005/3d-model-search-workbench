# Blender 与 Unity 对接契约

> 本文件记录当前已实现的接口，避免后续阶段重复设计或破坏兼容性。

## 1. Blender 设置

应用设置表 `app_settings`：

```json
{
  "blender.path": "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe"
}
```

未配置或路径无效时：

- “核验面数与拓扑”按钮禁用。
- “清理并导出 FBX”按钮禁用。
- Blender 路径选择入口保持可用。
- 原始 FBX/OBJ 仍可提交 Unity 导入。

## 2. Blender Job

```json
{
  "mode": "inspect",
  "input_file": "D:\\3dModelSearch\\data\\library\\...\\source\\model.glb",
  "output_dir": "D:\\3dModelSearch\\data\\library\\...\\artifacts\\inspect-...",
  "result_path": "D:\\3dModelSearch\\data\\library\\...\\artifacts\\inspect-...\\result.json"
}
```

`mode` 可取：

```text
inspect
process
```

调用：

```powershell
blender.exe --background --factory-startup --disable-autoexec `
  --python-exit-code 1 --python blender/worker.py -- job.json
```

## 3. Blender Result

```json
{
  "ok": true,
  "blenderVersion": "4.2.1 LTS",
  "objects": 6,
  "meshes": 5,
  "vertices": 1056,
  "triangles": 2020,
  "polygons": 2020,
  "uvLayers": 0,
  "materials": 5,
  "textures": 0,
  "armatures": 0,
  "animations": 0,
  "shapeKeys": 0,
  "bounds": [1.12, 0.750526, 1.079965],
  "issues": {
    "nonManifoldEdges": 0,
    "boundaryEdges": 0,
    "looseVertices": 0,
    "degenerateFaces": 0,
    "duplicateFaces": 0
  },
  "warnings": [],
  "outputModel": "D:\\...\\processed.fbx"
}
```

`inspect` 不修改源文件。
`process` 输出：

```text
normalized.blend
processed.fbx
result.json
```

当前安全处理仅包括：

- 应用旋转和缩放。
- 合并近重复顶点。
- 删除松散顶点。
- 重算法线。

不做自动重拓扑、破坏性减面和未确认材质重写。

## 4. Unity 设置

```json
{
  "unity.projectPath": "D:\\Island"
}
```

检测条件：

```text
<Project>/ProjectSettings/ProjectVersion.txt
```

插件目标目录：

```text
<Project>/Packages/com.modelsearch.importer/
```

## 5. Unity Import Request

```json
{
  "requestId": "uuid",
  "assetId": "provider:native-id",
  "sourceId": "threedassets",
  "sourceDirectory": "D:\\...\\artifacts\\process-...",
  "preferredModel": "D:\\...\\artifacts\\process-...\\processed.fbx",
  "targetDirectory": "Assets/ModelLibrary/threedassets/provider-native-id",
  "sourceUrl": "https://...",
  "licensePath": "D:\\...\\license.json",
  "scale": 1
}
```

请求写入：

```text
<Project>/.model-library/inbox/<requestId>.json
```

结果写入：

```text
<Project>/.model-library/outbox/<requestId>.result.json
```

处理后的请求归档到：

```text
<Project>/.model-library/archive/
```

## 6. Unity Import Result

```json
{
  "requestId": "uuid",
  "assetId": "provider:native-id",
  "status": "completed",
  "importedPath": "Assets/ModelLibrary/.../processed.fbx",
  "message": "Asset imported successfully.",
  "importedAt": "2026-11-24T06:27:48Z"
}
```

## 7. Unity 验证方式

在任意一次性 Unity 项目中设置：

```text
UNITY_PROJECT_PATH=<UnityProject>
```

然后运行：

```powershell
npm run unity:smoke
```

验证会：

- 安装本地 UPM 插件。
- 提交一个已处理资产的导入请求。
- 导入模型。
- 新建验证 Scene。
- 在 Scene 中加入模型、`Main Camera` 和 `Directional Light`。

输出位置：

```text
<UnityProject>/Assets/ModelLibrary/Validation/ModelSearchImportValidation.unity
<UnityProject>/.model-library/outbox/island-validation.json
```

## 8. 后续对接点

- 将单资产 Blender Worker 扩为持久批处理队列。
- 为 URP/HDRP 增加材质重建预设。
- 自动生成 Prefab 和 LOD 配置。
- 安装 glTFast 后扩展原生 GLB 导入。
- 批量导入失败后从 checkpoint 重试。
- 账号代理只负责授权和会话，不直接介入 Blender/Unity 文件协议。
