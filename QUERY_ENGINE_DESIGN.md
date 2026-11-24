# 多源 3D 资产查询引擎设计

> 日期：2026-11-23
> 关联文档：[IMPLEMENTATION.md](IMPLEMENTATION.md)
> 结论：采用“持久化本地索引 + 后台增量同步 + 查询时按来源实时补充”，而不是每次查询都同步爬取全部网站。

## 1. 核心决策

正确做法不是简单的：

```text
用户查询
  -> 查本地数据库
  -> 完全找不到才同步爬全部网站
  -> 等待所有网站返回
```

这种方式有两个问题：

- 即使本地已有结果，也可能缺少刚发布的内容。
- 即使本地有结果，也仍然需要判断该来源是否为这个查询做过近期检索。
- 冷查询时同时请求 30–90 个站点，会导致超时、限流、账号风控和极差的首屏体验。

应实现三层查询：

```text
1. 本地索引
   持久化所有已同步的资产元数据，先返回结果。

2. 来源级查询缓存
   记录“某个来源是否在近期搜索过这个规范化查询”，决定是否需要联网补充。

3. 查询时实时补充
   只查询需要刷新的来源，限定并发和时间预算，结果流式返回并写入本地索引。
```

## 2. 三种数据同步方式

### 2.1 目录同步

适合 API、Sitemap、RSS 和结构稳定的 HTML 来源。

后台任务按来源游标增量抓取目录，写入本地索引。它保证用户搜索时已有较大的候选集。

```text
Sitemap / API / RSS
  -> 新 URL 或更新 URL
  -> 详情页元数据
  -> license + format + tags
  -> catalog_items / assets
```

适合：

- Kenney、Quaternius 等稳定资源站。
- Poly Haven、ambientCG、BlenderKit 等 API 来源。
- OpenGameArt、itch.io 等有列表页的来源。

### 2.2 查询时搜索

用于本地覆盖不足、数据过期或来源提供搜索 API 的情况。

```text
query
  -> source-specific search adapter
  -> normalized results
  -> upsert local index
  -> stream to UI
```

它只补充当前查询相关的结果，不进行全站抓取。

### 2.3 按需详情

列表页通常只提供缩略图、标题和部分元数据。只有用户展开详情或准备下载时才请求详情页。

这样可以减少：

- 请求数。
- 站点限流风险。
- 无效详情页抓取。
- 本地数据库体积。

## 3. 查询模式

GUI 默认使用 `cache_first`，同时提供 `live` 和 `background_full`。

| 模式 | 行为 | 默认用途 |
|---|---|---|
| `cache_first` | 本地立即返回；过期来源流式补充 | 默认搜索 |
| `live` | 忽略查询缓存，在全局预算内实时搜索 | 用户明确要求最新 |
| `background_full` | 后台查询更多来源，不阻塞首屏 | 扩大覆盖 |
| `offline` | 只搜本地资产库 | 无网络或隐私模式 |

默认不等待全部来源。首屏先给出可用结果，之后逐站追加。

## 4. 查询流程

```text
1. parse query
2. normalize query and filters
3. query local FTS index
4. emit local results immediately
5. build per-source query plan
6. run eligible source calls with concurrency limits
7. stream source results as they finish
8. normalize, upsert, deduplicate and rerank
9. persist source query freshness
10. schedule uncovered sources for background refresh
```

### 4.1 查询规范化

处理顺序：

1. Unicode NFKC。
2. 大小写统一。
3. 全角/半角统一。
4. 去除多余空白和不可见字符。
5. 解析结构化过滤器。
6. 扩展受控的同义词和中英文词典。
7. 生成稳定查询哈希。

示例：

```text
输入：
  低模 中世纪 木箱 format:fbx tris:<5000 license:commercial

规范化：
  query_text = "低模 中世纪 木箱"
  expanded_terms = ["低模", "low poly", "lowpoly", "中世纪", "medieval", "木箱", "wooden crate", "crate"]
  filters = formats:[fbx], maxTriangles:5000, license:commercial
```

同义词扩展只影响召回，不替换原始查询。查询哈希必须包含过滤器版本和标准化规则版本。

### 4.2 查询哈希

```text
query_key = sha256(
  normalized_query
  + canonical_filters
  + dictionary_version
  + provider_recipe_version
  + access_profile_id   // 只有私有来源包含
)
```

不要让登录账号的私有搜索结果进入公共缓存。

## 5. 每来源查询计划

### 5.1 是否需要实时查询

不是用“本地是否命中结果”作为唯一条件，而是检查来源级状态：

```text
need_live =
    source.enabled
    && source.supports(asset_type)
    && !source.access_blocked
    && (
         query_cache_miss
         || query_cache_stale
         || catalog_coverage == partial
         || request.mode == live
         || source.change_cursor_advanced
       )
```

`query_cache_hit + fresh + local results` 可以直接使用本地结果。
`query_cache_hit + fresh + zero result` 也合法，但应设置为短期 negative cache，避免查询风暴。
`catalog_coverage=partial` 时，即使本地命中，也可以补充实时搜索。

### 5.2 来源覆盖率

每个来源维护：

```text
coverage = unknown | partial | full
last_catalog_sync
last_query_search
last_success
last_error
p50_latency_ms
p95_latency_ms
consecutive_failures
next_retry_at
```

- `unknown`：尚未探测。
- `partial`：只同步了部分目录或仅有查询缓存。
- `full`：已通过 API/Sitemap/RSS 同步完整可见目录。

全目录导入后，大多数关键词可以直接从索引获取；查询时实时搜索只是新鲜度补充。

### 5.3 查询来源分波次

不要一次启动全部站点。默认：

```text
Wave 1：8 个 API/健康度最高的公共来源
Wave 2：最多 12 个补充来源，使用剩余时间预算
Wave 3：后台补充其余已启用来源
```

用户选择的方向可调整优先级：

- 用户明确选中的来源。
- 收藏来源。
- 最近成功的来源。
- 低延迟来源。
- 与资产类型更匹配的来源。

如果用户需要“全网覆盖”，执行 `background_full`，但仍按并发和每站限额分批。

## 6. 超时设计

超时必须是分层的，不能给整个查询只设置一个长超时。

### 6.1 三层超时

```text
全局预算
  └─ 来源预算
       └─ HTTP 连接/响应预算
```

建议默认值：

| 层级 | 默认值 | 说明 |
|---|---:|---|
| 首屏本地返回 | 300 ms | 本地索引目标 |
| 首屏实时软截止 | 2–3 s | 先显示已完成来源 |
| 单来源软超时 | 6 s | 可以按 p95 自适应 |
| 单来源硬超时 | 10 s | 到期取消 |
| 实时查询总截止 | 10–12 s | 时间到即展示部分结果 |
| 详情页请求 | 20 s | 用户主动打开或后台 |
| 下载请求 | 不受查询超时限制 | 独立队列和取消 |

单来源自适应超时：

```text
source_timeout =
  clamp(source.p95_latency_ms * 2,
        min_timeout_ms = 2500,
        max_timeout_ms = 10000)

effective_timeout = min(
  source_timeout,
  query_deadline - now
)
```

### 6.2 超时行为

单个来源超时只返回该来源状态：

```json
{
  "source_id": "example",
  "status": "timeout",
  "elapsed_ms": 6000,
  "partial_results": 0,
  "retry_at": null
}
```

不能使整个查询失败，也不能让 UI 一直显示“加载中”。

### 6.3 取消

- 用户取消查询时，取消所有未完成来源任务。
- 已完成来源结果保留。
- 已经写入本地索引的结果保留。
- 取消状态写入任务事件，不写入“来源失败”健康度。
- HTTP 请求使用 `AbortController`/取消令牌。
- 取消后释放并发槽和数据库事务。

## 7. 重试、退避和熔断

### 7.1 重试范围

只对可安全重试的 GET 和幂等搜索请求重试：

- 连接重置。
- 临时 5xx。
- 429 且存在合理 `Retry-After`。

不自动重试：

- 401/403。
- 登录过期。
- CAPTCHA。
- 明确的权限不足。
- 用户取消。

### 7.2 指数退避

```text
delay = min(base * 2^attempt, cap) + random(0, jitter)
```

建议：

```text
base = 500 ms
cap = 30 s
jitter = 0–500 ms
attempts = 2
```

有 `Retry-After` 时优先使用服务端时间。

### 7.3 熔断

每个来源维护：

```text
CLOSED   正常请求
OPEN     暂时跳过
HALF_OPEN 只放行一个探测请求
```

建议策略：

- 3 次连续网络超时或 5xx 进入 `OPEN`。
- 初次冷却 5 分钟，随后指数增加，最高 1 小时。
- 冷却结束后进入 `HALF_OPEN`。
- 成功一次回到 `CLOSED`。
- 401/403/验证码进入访问状态，不按普通网络失败累计。

## 8. 缓存设计

### 8.1 三层缓存

```text
L1 内存缓存
  热查询、来源状态、去重后的首屏结果

L2 SQLite 持久化目录
  资产元数据、FTS 索引、查询来源状态

L3 内容缓存
  缩略图、许可证据、详情 JSON
```

模型文件不进入查询缓存，下载完成后写入正式资产库。

### 8.2 查询来源状态

建议表：

```sql
CREATE TABLE source_query_state (
  query_key TEXT NOT NULL,
  source_id TEXT NOT NULL,
  access_profile_id TEXT,
  status TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stale_until INTEGER,
  http_etag TEXT,
  http_last_modified TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  retry_at INTEGER,
  PRIMARY KEY (query_key, source_id, access_profile_id)
);
```

不要只存一条全站“搜索结果 JSON”的键。必须按查询 × 来源 × 授权档案分区。

### 8.3 TTL 建议

| 来源类型 | 查询缓存 TTL | 目录 TTL |
|---|---:|---:|
| 官方 API | 5–15 分钟 | 15–60 分钟 |
| 搜索型 HTML | 15–60 分钟 | 1–6 小时 |
| 稳定静态目录 | 6–24 小时 | 6–24 小时 |
| 登录型私有结果 | 1–5 分钟 | 5–30 分钟 |
| 仅链接来源 | 1–6 小时 | 按站点 |

加入 5%–15% 的随机抖动，避免所有来源在同一时刻刷新。

### 8.4 stale-while-revalidate

```text
now < expires_at:
  使用缓存

expires_at <= now < stale_until:
  立即返回旧结果
  后台刷新

now >= stale_until:
  返回旧结果作为“可能过时”
  同时尝试实时查询
```

查询缓存失效不等于删除本地资产。资产仍可用于本地搜索，只是在 UI 中显示“来源数据可能过时”。

### 8.5 负缓存

空结果和权限阻塞都必须短时间缓存：

- 正常空结果：5 分钟。
- 限流：`Retry-After` 或 5–30 分钟。
- 需要登录：进入访问待办，不重复请求。
- 验证码：等待用户主动完成。
- 站点结构漂移：进入 degraded，不再高频重试。

## 9. 并发控制

### 9.1 并发上限

建议初始值：

```text
全局搜索并发：8
每域名搜索并发：1–2
全局详情并发：4
每域名详情并发：1
下载并发：单独配置，按域名限制
```

站点数量增加后，不能线性增加并发。

### 9.2 请求合并

如果用户快速重复同一查询，使用 singleflight：

```text
same query_key + source_id + access_profile_id
  -> 复用同一个正在执行的请求
```

这样切换页面、重复点击搜索或打开多个详情面板不会产生重复请求。

### 9.3 优先级

任务队列优先级：

1. 用户主动搜索。
2. 用户打开的详情。
3. 用户点击下载。
4. 查询后补全来源。
5. 后台更新。
6. 全站目录重建。

低优先级任务不能阻塞用户可见的查询。

## 10. 排名算法

### 10.1 先过滤、后评分

硬过滤：

- 资产类型。
- 许可策略。
- 最大三角面数。
- 必需格式。
- 是否有骨骼/动画。
- 是否可下载。
- 是否被排除来源。

不满足硬条件的资产不应通过更高相关性重新进入结果。

### 10.2 基础评分

```text
score =
  0.35 * text_relevance
  + 0.15 * tag_style_match
  + 0.10 * exact_title_or_phrase
  + 0.10 * source_health
  + 0.10 * freshness
  + 0.10 * metadata_completeness
  + 0.05 * thumbnail_or_user_signal
  + 0.05 * access_readiness
```

各分量归一化到 0–1。

- `text_relevance` 来自标题、描述、作者、标签的 BM25 或 FTS。
- `tag_style_match` 来自规则标签和用户确认标签。
- `source_health` 来源于成功率、延迟和许可透明度。
- `freshness` 按来源更新时间衰减。
- `metadata_completeness` 衡量面数、格式、贴图和许可是否齐全。
- `access_readiness` 表示直接可下载，不等于许可安全。

许可是否允许商用必须先经过硬过滤，不能仅用加 0.1 分代替。

### 10.3 跨来源融合

如果不同来源返回自己的排名，可用 Reciprocal Rank Fusion：

```text
rrf(asset) =
  Σ source_weight * 1 / (k + rank_in_source)

k = 60
```

完全相同的资产合并为同一个 `asset_id`，其他来源成为 `asset_offers`。

### 10.4 去重

分三层：

1. 规范 URL 完全一致。
2. SHA-256 完全相同。
3. 标题、作者、缩略图和量化几何近似。

前两层可以自动合并。第三层只显示“可能是同一资产”。

### 10.5 结果多样性

默认结果页每个来源最多显示 3–5 个结果，避免一个大来源占满全部页面。用户可以关闭这一限制。

### 10.6 稳定排序

排序键：

```text
score DESC
exact_title_match DESC
freshness DESC
asset_id ASC
```

最后使用稳定的 `asset_id` 作为 tie-breaker，避免相同分数时结果上下跳动。

### 10.7 中文检索

SQLite FTS5 默认分词对中文不理想。首版建议：

1. 入库时将标题、描述和标签用 `jieba-rs` 或受控词典切词。
2. 把切词结果与英文 token 一起写入 `catalog_fts`。
3. 查询时使用同一分词版本。
4. 保留 trigram/子串回退，解决短词和无空格查询。
5. 将分词或词典版本写入 schema 版本，升级时重建索引。

SQLite 设置：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

## 11. 后台索引与更新

### 11.1 首次启动

不要在首次启动时等待完整目录同步结束。

流程：

```text
导入预置来源注册表
  -> 立即允许搜索和实时补充
  -> 后台按来源同步目录
  -> 每个来源完成后更新 coverage
  -> UI 显示“来源覆盖 24/89”
```

可以随安装包附带一个元数据快照，但不应附带来源网站的模型文件。

### 11.2 调度

使用持久化队列：

```text
source_id + job_type + cursor
```

重启后恢复：

- 未完成目录同步。
- 失败的详情请求。
- 等待额度恢复的下载。
- 等待登录的访问待办。

### 11.3 新鲜度评分

来源平均更新频率可以动态估计：

```text
update_rate =
  changed_assets_last_30_days
  / total_assets
```

更新越频繁、用户越常搜索、失败越少的来源，可以拥有更短的刷新 TTL。

## 12. 推荐核心伪代码

以下使用 Rust 风格表达，实际可拆分到 `crates/search`、`crates/sources` 和 `crates/jobs`。

```rust
async fn execute_search(
    request: SearchRequest,
    context: AppContext,
) -> Result<SearchStream, SearchError> {
    let query = QueryParser::parse(&request)?;
    let local = context
        .index
        .search(&query, &request.filters, request.local_limit)
        .await?;

    let plans = context
        .planner
        .plan_live_sources(&query, &request)
        .await?;

    Ok(stream! {
        yield SearchEvent::Local(local.clone());

        let deadline = Instant::now() + request.live_budget;
        let mut jobs = JoinSet::new();
        let semaphore = Arc::new(Semaphore::new(
            context.settings.search_global_concurrency,
        ));

        for plan in plans {
            let permit = semaphore.clone().acquire_owned();
            let ctx = context.clone();
            jobs.spawn(async move {
                let _permit = permit.await?;
                fetch_and_normalize_source(plan, ctx, deadline).await
            });
        }

        while let Some(result) = jobs.join_next().await {
            match result {
                Ok(SourceOutcome::Success { source_id, assets }) => {
                    context
                        .index
                        .upsert_assets_batch(&assets)
                        .await?;

                    let ranked = context
                        .ranker
                        .merge_and_filter(&query, &request.filters, &assets);

                    yield SearchEvent::SourceResults {
                        source_id,
                        assets: ranked,
                    };
                }
                Ok(SourceOutcome::NeedsAccess(action)) => {
                    context.pending_actions.upsert(action).await?;
                    yield SearchEvent::SourceStatus {
                        status: SourceStatus::AccessRequired,
                    };
                }
                Ok(SourceOutcome::Failed(error)) => {
                    yield SearchEvent::SourceStatus {
                        status: SourceStatus::Failed(error),
                    };
                }
                Err(join_error) => {
                    yield SearchEvent::SourceStatus {
                        status: SourceStatus::Failed(join_error.into()),
                    };
                }
            }

            if Instant::now() >= deadline {
                jobs.abort_all();
                break;
            }
        }
    })
}
```

单来源调用：

```rust
async fn fetch_and_normalize_source(
    plan: SourcePlan,
    context: AppContext,
    deadline: Instant,
) -> SourceOutcome {
    if context.breakers.is_open(&plan.source_id).await {
        return SourceOutcome::Skipped("circuit_open");
    }

    if plan.access_state == AccessState::LoginRequired {
        return SourceOutcome::NeedsAccess(
            context.access.make_pending_action(&plan).await
        );
    }

    let adaptive = Duration::from_millis(
        plan.source_timeout_ms
            .clamp(2_500, 10_000)
    );
    let effective = adaptive.min(
        deadline.saturating_duration_since(Instant::now())
    );

    let result = timeout(
        effective,
        context.connectors.search(&plan, &context)
    ).await;

    match result {
        Ok(Ok(assets)) => {
            context.breakers.record_success(&plan.source_id).await;
            context.cache.record_query_success(&plan).await;
            SourceOutcome::Success {
                source_id: plan.source_id,
                assets,
            }
        }
        Ok(Err(SourceError::RateLimited { retry_at })) => {
            context.cache.record_rate_limit(&plan, retry_at).await;
            SourceOutcome::Skipped("rate_limited")
        }
        Ok(Err(error)) => {
            context.breakers.record_failure(&plan.source_id).await;
            SourceOutcome::Failed(error)
        }
        Err(_) => {
            context.breakers.record_timeout(&plan.source_id).await;
            SourceOutcome::Failed(SourceError::Timeout)
        }
    }
}
```

## 13. GUI 查询表现

### 13.1 首屏

1. 显示本地结果。
2. 显示“正在联网补充 8/30 个来源”。
3. 已完成来源逐批追加。
4. 到全局截止时间后显示“部分来源超时，可重试”。

### 13.2 状态

每个来源独立显示：

```text
本地命中
正在查询
已更新
缓存结果
需要登录
额度等待
超时
限流
被站点阻断
```

### 13.3 手动覆盖

用户可点击：

- “强制实时搜索”
- “继续查询剩余来源”
- “只使用本地结果”
- “重试超时来源”

## 14. 性能目标

| 操作 | 目标 |
|---|---:|
| 本地 FTS 首屏 | < 150 ms |
| 本地到 UI | < 300 ms |
| 第一个实时来源结果 | 2–3 s 内 |
| 默认实时阶段结束 | 10–12 s |
| 单来源超时 | 默认 6–10 s |
| 并发搜索来源 | 8 |
| 单域名并发 | 1–2 |
| 重复查询请求合并 | 100% |

## 15. 监控指标

每个来源记录：

- 搜索成功率。
- 超时率。
- 平均、p50、p95 延迟。
- 429 次数。
- 结构解析失败次数。
- 许可缺失率。
- 有下载入口比例。
- 结果重复率。
- 缓存命中率。
- 实时补充覆盖率。

当某个来源的 p95 延迟持续上升或连续失败时，应自动降低其查询优先级，而不是继续与健康来源并发。

## 16. 最终建议

首选实现顺序：

1. SQLite 本地资产和 FTS 索引。
2. 来源级查询缓存和 TTL。
3. 8 路并发、逐站超时、流式结果。
4. 熔断、429 和访问待办。
5. 后台 Sitemap/API/RSS 增量同步。
6. 查询后补全来源和来源更新检测。

不要在第一版实现全站同步爬取。先用“本地索引 + 按来源实时补充”得到可接受的首屏速度，再通过稳定来源的增量同步逐步提高缓存覆盖率。
