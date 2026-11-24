# 来源发现与更新实现说明

> 当前实现来源候选发现、公开页面探测、重复检测和人工审核。自动搜索服务和新来源配方的批量生成保留接口。

## 1. 来源增长流程

```text
手动网址 / 现有来源外链
  -> 域名去重
  -> 公开首页读取
  -> robots.txt 检查
  -> 标题、描述、格式、许可、登录提示提取
  -> 候选评分
  -> 隔离 / 待审核 / 需要授权 / 重复
  -> 人工审核
  -> 加入来源库（默认停用）
  -> 后续完成 provider 配方
```

## 2. 当前发现入口

- 手动输入一个站点 URL。
- 扫描已启用上游来源首页中的外部链接。
- 可开启每日自动扫描。

自动扫描：

- 默认关闭。
- 间隔不少于 24 小时。
- 每次最多读取 16 个已知来源首页。
- 最多探测 12 个候选域名。
- 请求有超时和 User-Agent。
- 不绕过登录、验证码或访问控制。

## 3. 评分因子

- 首页中的 3D/模型/游戏资产关键词。
- 可能的模型链接数量。
- FBX、GLB、glTF、OBJ、Blend、USDZ 等格式。
- 是否发现 CC0、CC BY、Royalty Free 或 Public Domain。
- robots.txt 是否允许。
- 页面是否严重依赖 JavaScript。
- 是否出现登录/注册提示。

候选分数是审核辅助，不是可信度结论。

## 4. 候选状态

```text
candidate
probing
ready_for_review
access_required
duplicate
quarantined
approved
rejected
error
```

加入来源库后的记录：

```text
connector_status = candidate_approved
enabled = false
```

必须先完成站点适配和访问验证，用户才能启用。

## 5. 数据库

`source_candidates`

- 域名唯一键
- 首页和最终 URL
- 发现来源
- 发现方式
- 状态和评分
- 探测证据 JSON
- 许可摘要
- 格式
- 访问模式
- 最近探测时间

`discovery_runs`

为后续持久化扫描批次和调度任务保留。

## 6. 后续接口

### 搜索提供者

后续增加：

```text
SourceSearchProvider
  search(query, region, cursor)
  supportedLanguages()
```

可插拔：

- Brave Search API
- Google Custom Search
- 本地 SearXNG
- 其他合规搜索服务

未配置搜索 API 时，仍可使用手动 URL 和现有来源外链发现。

### 候选适配器生成

候选审核通过后，下一步应：

1. 获取至少 3 个模型详情页。
2. 验证列表、详情和许可页面。
3. 生成声明式 provider recipe。
4. 保存离线 fixture。
5. 运行 live smoke test。
6. 进入 beta 连接器。

当前只完成候选注册和证据收集，没有自动启用新 provider。

### 更新检测

后续为每个已启用来源保存：

- API cursor
- RSS/Sitemap ETag
- 页面内容哈希
- 资产规范 URL
- 下载文件 SHA-256
- 许可文本哈希

更新事件不会覆盖已导入 Unity 的资产版本。

## 7. 安全边界

- 新来源默认停用。
- 重复域名不再次添加。
- robots 禁止根路径的站点隔离。
- 许可未知只进入人工审核。
- 不自动下载候选站点模型。
- 不自动绕过登录、验证码或付费墙。
