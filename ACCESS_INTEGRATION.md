# 账号与访问权限对接说明

> 当前完成通用账号、会话、待办和安全存储基础；站点专用登录与授权下载适配器后续逐个接入。

## 1. 已实现

- 每个来源可创建多个账号档案。
- 授权方式：
  - 浏览器登录
  - OAuth
  - API Key
  - 账号密码
- 密码和 API Key 使用 Electron `safeStorage` 加密后存入 SQLite。
- 数据库和界面不返回秘密明文。
- 每个账号使用独立持久化浏览器分区：

```text
persist:model-search-account-<source>-<profile>
```

- 打开登录窗口后，用户自行完成登录、二次验证和验证码。
- 用户主动点击“验证会话”后检测会话 Cookie。
- 支持清除本地会话和删除账号档案。
- 搜索中没有直接下载能力的来源可以进入“访问与账号”待办。
- API Key 保存后账号状态可直接标记为可用。

## 2. 数据库

### access_profiles

保存非敏感信息：

- 来源
- 配置名称
- 授权方式
- 掩码用户名
- 权限范围
- 状态
- 验证时间和过期时间

### access_secrets

保存：

- `safeStorage.encryptString(...)` 后的 Base64 密文
- 密文更新日期

不保存明文密码、API Key 或浏览器 Cookie。

### pending_actions

保存需要用户操作的来源级事项：

- 来源
- 待办类型
- 原因
- 关联账号档案
- checkpoint JSON
- 状态

## 3. 状态

```text
unconfigured
awaiting_login
pending_verification
ready
expired
revoked
error
```

## 4. 站点适配器接口

文件：`core/access/adapter.ts`

```text
AuthenticatedAccessAdapter
  sourceId
  loginUrl
  checkPermission(sessionHandle, assetUrl)
  resolveDownload(sessionHandle, assetUrl)
```

约束：

- 适配器不读取密码或 Cookie。
- 只获得短期 `sessionHandle`。
- Access Manager 验证域名和目标 URL。
- 适配器不能绕过验证码、付费墙、额度或地区限制。
- 下载结果进入现有 staging、哈希、解压和资产库流程。

## 5. 后续站点接入顺序

1. 官方 API + OAuth/API Key 来源。
2. 浏览器会话 + 公开免费下载。
3. 首次免费领取/加入库后检测 entitlement。
4. 有每日额度或积分的来源。
5. 只能手动下载的来源，使用本地文件导入。

首批候选：

- Sketchfab
- Unity Asset Store
- Fab
- Mixamo
- VRoid Hub
- BOOTH

具体接入前必须逐站确认 API、条款和可自动化范围。

## 6. 未完成接口

- 站点专用登录页适配器。
- 登录态权限探测。
- entitlement 和额度 API。
- 领取免费资源后的自动续跑。
- 下载任务 checkpoint 与认证恢复。
- 多账号自动选择策略。

这些接口已经与搜索、下载、许可和任务数据模型分离，后续不需要修改 Blender/Unity 协议。
