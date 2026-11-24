import { useEffect, useMemo, useState } from 'react';
import type { SourceRecord } from '../core/types';
import type {
  DiscoveryAsset,
  DownloadProgressEvent,
  ModelSearchEvent,
  ModelSearchSourceStatus,
} from '../core/discovery/types';

interface SearchViewProps {
  sources: SourceRecord[];
  onConfigureSource: (sourceId: string, reason: string) => void;
}

type DownloadState = 'idle' | 'downloading' | 'completed' | 'failed';

interface DownloadStateRecord {
  state: DownloadState;
  progress: number;
  message?: string;
  directory?: string;
}

const quickQueries = ['chair', 'tree', 'crate', 'character'];

function sourceStatusLabel(status: ModelSearchSourceStatus['status']): string {
  switch (status) {
    case 'queued':
      return '等待';
    case 'searching':
      return '查询中';
    case 'ok':
      return '完成';
    case 'skipped':
      return '跳过';
    case 'timeout':
      return '超时';
    case 'cancelled':
      return '已取消';
    case 'error':
    default:
      return '失败';
  }
}

function formatPolyCount(value?: number): string {
  if (typeof value !== 'number') {
    return '面数未知';
  }
  return `${value.toLocaleString('zh-CN')} tris`;
}

function SearchGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function SearchView({ sources, onConfigureSource }: SearchViewProps) {
  const searchableSources = useMemo(
    () => sources.filter((source) => source.enabled && source.upstreamSourceId),
    [sources],
  );
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('any');
  const [maxTriangles, setMaxTriangles] = useState('20000');
  const [directOnly, setDirectOnly] = useState(true);
  const [freeOnly, setFreeOnly] = useState(true);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [assets, setAssets] = useState<DiscoveryAsset[]>([]);
  const [sourceStatuses, setSourceStatuses] = useState<
    Map<string, ModelSearchSourceStatus>
  >(new Map());
  const [downloads, setDownloads] = useState<Record<string, DownloadStateRecord>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceReady, setServiceReady] = useState<boolean | null>(null);

  useEffect(() => {
    const api = window.modelSearch;
    if (!api) {
      setError('请通过 Electron 启动应用。');
      return;
    }

    let disposed = false;
    void api.getDiscoveryStatus().then((status) => {
      if (!disposed) {
        setServiceReady(status.ready);
        if (!status.ready && status.error) {
          setError(status.error);
        }
      }
    });

    const unsubscribeSearch = api.onModelSearchEvent((event) => {
      if (disposed) {
        return;
      }
      handleSearchEvent(event);
    });
    const unsubscribeDownload = api.onDownloadProgress((event) => {
      if (!disposed) {
        handleDownloadProgress(event);
      }
    });
    return () => {
      disposed = true;
      unsubscribeSearch();
      unsubscribeDownload();
    };
  }, [searchableSources]);

  function handleSearchEvent(event: ModelSearchEvent): void {
    if (event.type === 'started') {
      setRunning(true);
      setError(null);
      setSummary(null);
      setSourceStatuses(
        new Map(
          searchableSources.map((source) => [
            source.sourceId,
            {
              sourceId: source.sourceId,
              providerId: source.upstreamSourceId ?? source.sourceId,
              displayName: source.displayName,
              status: 'queued',
              count: 0,
              tookMs: 0,
            } satisfies ModelSearchSourceStatus,
          ]),
        ),
      );
      return;
    }

    if (event.type === 'source-started') {
      setSourceStatuses((current) => {
        const next = new Map(current);
        const previous = next.get(event.sourceId);
        next.set(event.sourceId, {
          sourceId: event.sourceId,
          providerId: event.providerId,
          displayName: event.displayName,
          status: 'searching',
          count: 0,
          tookMs: previous?.tookMs ?? 0,
        });
        return next;
      });
      return;
    }

    if (event.type === 'source-results') {
      setSourceStatuses((current) => {
        const next = new Map(current);
        next.set(event.sourceId, event.status);
        return next;
      });
      setAssets((current) => {
        const byId = new Map(current.map((asset) => [asset.id, asset]));
        for (const asset of event.assets) {
          byId.set(asset.id, asset);
        }
        return [...byId.values()].sort(
          (left, right) => (right.score ?? 0) - (left.score ?? 0),
        );
      });
      return;
    }

    if (event.type === 'completed') {
      setRunning(false);
      setSummary(
        `完成 ${event.succeeded} 个来源，${event.failed} 个失败，${event.resultCount} 个结果，用时 ${(event.elapsedMs / 1000).toFixed(1)} 秒`,
      );
      return;
    }

    if (event.type === 'failed') {
      setRunning(false);
      setError(event.error);
      return;
    }

    if (event.type === 'cancelled') {
      setRunning(false);
      setSummary('搜索已取消，保留已返回的结果。');
    }
  }

  function handleDownloadProgress(event: DownloadProgressEvent): void {
    setDownloads((current) => {
      const next = { ...current };
      if (event.type === 'started') {
        next[event.assetId] = {
          state: 'downloading',
          progress: 0,
          message: '正在下载…',
        };
      } else if (event.type === 'progress') {
        next[event.assetId] = {
          state: 'downloading',
          progress:
            event.totalBytes && event.totalBytes > 0
              ? Math.min(event.receivedBytes / event.totalBytes, 0.95)
              : 0.2,
          message: `${formatBytes(event.receivedBytes)} 已接收`,
        };
      } else if (event.type === 'completed') {
        next[event.assetId] = {
          state: 'completed',
          progress: 1,
          message: `已保存 ${event.files.length} 个文件`,
          directory: event.directory,
        };
      } else {
        next[event.assetId] = {
          state: 'failed',
          progress: 0,
          message: event.error,
        };
      }
      return next;
    });
  }

  async function startSearch(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !query.trim()) {
      return;
    }
    setError(null);
    const selectedFormats = format === 'any' ? [] : [format];
    const triangleLimit = maxTriangles ? Number(maxTriangles) : undefined;
    setAssets([]);
    setSummary('正在读取本地缓存…');
    try {
      const cached = await api.getCachedAssets({
        query: query.trim(),
        formats: selectedFormats,
        maxTriangles: triangleLimit,
      });
      if (cached.length > 0) {
        setAssets(cached);
        setSummary(`本地缓存 ${cached.length} 个结果，正在刷新来源…`);
      }
      const result = await api.startModelSearch({
        query: query.trim(),
        freeOnly,
        directOnly,
        formats: selectedFormats,
        maxTriangles: triangleLimit,
        resultLimitPerSource: 20,
      });
      setSearchId(result.searchId);
      setRunning(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function cancelSearch(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !searchId) {
      return;
    }
    await api.cancelModelSearch(searchId);
  }

  async function downloadAsset(asset: DiscoveryAsset): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setDownloads((current) => ({
      ...current,
      [asset.id]: {
        state: 'downloading',
        progress: 0,
        message: '准备下载…',
      },
    }));
    try {
      const matchingFormat =
        format !== 'any' && asset.formats?.includes(format)
          ? format
          : asset.formats?.[0];
      await api.downloadModel({
        asset,
        format: matchingFormat,
      });
    } catch (reason) {
      setDownloads((current) => ({
        ...current,
        [asset.id]: {
          state: 'failed',
          progress: 0,
          message: reason instanceof Error ? reason.message : String(reason),
        },
      }));
    }
  }

  const statusValues = [...sourceStatuses.values()];
  const activeCount = statusValues.filter(
    (status) => status.status === 'searching' || status.status === 'queued',
  ).length;

  return (
    <main className="main-panel search-main">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">PUBLIC SOURCE SEARCH / 02</p>
          <h1>模型搜索</h1>
          <p className="page-subtitle">
            搜索已启用的公共来源，并直接保存到本地资产库。
          </p>
        </div>
        <div className="topbar-actions">
          <div className={`runtime-chip ${serviceReady === false ? 'is-warning' : ''}`}>
            <span className="live-dot" />
            {serviceReady === null
              ? '正在连接来源服务'
              : serviceReady
                ? '公共来源服务已就绪'
                : '来源服务不可用'}
          </div>
          <div className="runtime-chip runtime-chip--quiet">
            {searchableSources.length} 个可用来源
          </div>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          <strong>搜索服务</strong>
          <span>{error}</span>
        </div>
      )}

      <section className="search-console glass-panel">
        <form
          className="search-console-form"
          onSubmit={(event) => {
            event.preventDefault();
            void startSearch();
          }}
        >
          <label className="search-query">
            <SearchGlyph />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入模型名称，例如：low poly wooden crate"
              autoFocus
            />
          </label>
          <button
            className={`primary-action ${running ? 'is-running' : ''}`}
            type={running ? 'button' : 'submit'}
            onClick={running ? () => void cancelSearch() : undefined}
          >
            {running ? '停止搜索' : '开始搜索'}
          </button>
        </form>

        <div className="search-options">
          <div className="quick-queries">
            <span>试试</span>
            {quickQueries.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setQuery(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <label className="select-control">
            <span>格式</span>
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              <option value="any">全部</option>
              <option value="glb">GLB</option>
              <option value="gltf">glTF</option>
              <option value="fbx">FBX</option>
              <option value="obj">OBJ</option>
            </select>
          </label>

          <label className="select-control">
            <span>面数上限</span>
            <input
              type="number"
              min="100"
              step="100"
              value={maxTriangles}
              onChange={(event) => setMaxTriangles(event.target.value)}
            />
          </label>

          <label className="compact-check">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(event) => setFreeOnly(event.target.checked)}
            />
            仅免费
          </label>

          <label className="compact-check">
            <input
              type="checkbox"
              checked={directOnly}
              onChange={(event) => setDirectOnly(event.target.checked)}
            />
            可直接下载
          </label>
        </div>
      </section>

      <section className="source-status-strip" aria-label="来源查询状态">
        <div className="source-status-head">
          <span>来源状态</span>
          <b>{running ? `${activeCount} 个进行中` : summary ?? '等待搜索'}</b>
        </div>
        <div className="source-status-scroll">
          {statusValues.map((status) => (
            <button
              key={status.sourceId}
              className={`source-pill source-pill--${status.status}`}
              type="button"
              title={
                status.status === 'skipped'
                  ? `${status.error ?? '来源需要配置访问'}（点击配置账号）`
                  : status.error
              }
              disabled={status.status !== 'skipped'}
              onClick={() =>
                onConfigureSource(
                  status.sourceId,
                  status.error ?? '该来源需要配置账号或浏览器会话。',
                )
              }
            >
              <i />
              {status.displayName}
              <small>
                {sourceStatusLabel(status.status)}
                {status.status === 'skipped' ? ' · 配置' : ''}
              </small>
            </button>
          ))}
          {statusValues.length === 0 && (
            <span className="source-pill source-pill--idle">
              启用来源后即可开始搜索
            </span>
          )}
        </div>
      </section>

      <section className="search-results">
        <div className="search-results-head">
          <div>
            <p className="eyebrow">RESULTS</p>
            <h2>{assets.length > 0 ? `${assets.length} 个模型结果` : '等待搜索'}</h2>
          </div>
          {running && <span className="searching-indicator">结果流式返回中</span>}
        </div>

        {assets.length === 0 ? (
          <div className="results-empty glass-panel">
            <div className="empty-orbit">
              <SearchGlyph />
            </div>
            <strong>从一个具体物体开始</strong>
            <span>搜索会并行查询已启用公共来源，并逐站返回结果。</span>
          </div>
        ) : (
          <div className="asset-grid">
            {assets.map((asset) => {
              const download = downloads[asset.id];
              return (
                <article className="asset-card glass-panel" key={asset.id}>
                  <div className="asset-thumb">
                    {asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span>3D</span>
                    )}
                    <span className="asset-source">{asset.provider}</span>
                  </div>
                  <div className="asset-card-body">
                    <div className="asset-title-row">
                      <h3>{asset.title}</h3>
                      <span className="asset-score">
                        {Math.round((asset.score ?? 0) * 100)}
                      </span>
                    </div>
                    <p>{asset.author ?? '未知作者'}</p>
                    <div className="asset-meta">
                      <span>{asset.license?.name ?? '许可未知'}</span>
                      <span>{formatPolyCount(asset.polyCount)}</span>
                    </div>
                    <div className="asset-formats">
                      {(asset.formats ?? []).slice(0, 4).map((item) => (
                        <span key={item}>{item.toUpperCase()}</span>
                      ))}
                    </div>
                    <button
                      className={`download-action ${
                        download?.state === 'completed' ? 'is-complete' : ''
                      }`}
                      type="button"
                      disabled={
                        !asset.downloadable ||
                        download?.state === 'downloading' ||
                        download?.state === 'completed'
                      }
                      onClick={() => void downloadAsset(asset)}
                    >
                      <DownloadGlyph />
                      {download?.state === 'downloading'
                        ? download.message
                        : download?.state === 'completed'
                          ? '已下载'
                          : download?.state === 'failed'
                            ? '重试下载'
                            : '下载到本地'}
                    </button>
                    {download?.state === 'downloading' && (
                      <div className="download-progress">
                        <span style={{ width: `${Math.max(download.progress * 100, 4)}%` }} />
                      </div>
                    )}
                    {download?.message && download.state !== 'downloading' && (
                      <p className="download-message">{download.message}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer className="footer">
        <span>Public sources only · Downloads stay on this device</span>
        <span>{summary ?? 'Stage 2'}</span>
      </footer>
    </main>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
