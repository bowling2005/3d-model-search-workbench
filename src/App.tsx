import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  BootstrapData,
  SourceFilter,
  SourceRecord,
} from '../core/types';
import { SearchView } from './SearchView';
import { AssetLibraryView } from './AssetLibraryView';
import { AccessAccountsView } from './AccessAccountsView';
import { SourceDiscoveryView } from './SourceDiscoveryView';
import packageMetadata from '../package.json';

type IconName =
  | 'grid'
  | 'search'
  | 'download'
  | 'key'
  | 'blender'
  | 'unity'
  | 'settings'
  | 'chevron'
  | 'database'
  | 'check';

type WorkspaceView = 'sources' | 'search' | 'library' | 'access' | 'discovery';

interface NavItem {
  label: string;
  icon: IconName;
  view?: WorkspaceView;
  hint?: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: IconName;
  items: NavItem[];
}

const filters: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'enabled', label: '已启用' },
  { id: 'upstream', label: '已集成' },
  { id: 'seed', label: '待探测' },
];

const navGroups: NavGroup[] = [
  {
    id: 'discover',
    label: '资产发现',
    icon: 'search',
    items: [
      { label: '来源总览', icon: 'grid', view: 'sources' },
      { label: '来源发现', icon: 'database', view: 'discovery', hint: '自动候选' },
      { label: '模型搜索', icon: 'search', view: 'search', hint: '公开来源' },
      { label: '我的资产', icon: 'download', view: 'library', hint: 'Blender → Unity' },
    ],
  },
  {
    id: 'access',
    label: '访问控制',
    icon: 'key',
    items: [
      { label: '访问与账号', icon: 'key', view: 'access', hint: '权限' },
    ],
  },
  {
    id: 'system',
    label: '系统',
    icon: 'settings',
    items: [
      { label: '设置', icon: 'settings', hint: '稍后' },
    ],
  },
];

const iconPaths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8" />
      <path d="m16 7 2 2" />
      <path d="m14 9 2 2" />
    </>
  ),
  blender: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="9" r="2.5" />
      <path d="M8 18c.8-3 2.2-4.5 4-4.5s3.2 1.5 4 4.5" />
    </>
  ),
  unity: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m12 8 4 2.3v4.4L12 17l-4-2.3v-4.4L12 8Z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  chevron: <path d="m8 10 4 4 4-4" />,
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
      <path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

function usePointerTracking<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const normalizedX = x / bounds.width - 0.5;
    const normalizedY = y / bounds.height - 0.5;

    element.style.setProperty('--spot-x', `${x}px`);
    element.style.setProperty('--spot-y', `${y}px`);
    element.style.setProperty('--tilt-x', `${normalizedY * -0.65}deg`);
    element.style.setProperty('--tilt-y', `${normalizedX * 0.65}deg`);
  }, []);

  const onPointerLeave = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.style.setProperty('--tilt-x', '0deg');
    element.style.setProperty('--tilt-y', '0deg');
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}

function TrackingPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { ref, onPointerMove, onPointerLeave } =
    usePointerTracking<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`tracking-panel ${className ?? ''}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}

function statusLabel(source: SourceRecord): string {
  if (source.connectorStatus.startsWith('upstream')) {
    return '已集成';
  }
  if (source.connectorStatus === 'seed_unverified') {
    return '待探测';
  }
  return source.connectorStatus;
}

function SourceBadge({ source }: { source: SourceRecord }) {
  const isUpstream = source.connectorStatus.startsWith('upstream');
  return (
    <span className={`status-badge ${isUpstream ? 'status-badge--ready' : ''}`}>
      <span className="status-dot" />
      {statusLabel(source)}
    </span>
  );
}

function AccordionSidebar({
  enabledCount,
  totalCount,
  currentView,
  onSelectView,
}: {
  enabledCount: number;
  totalCount: number;
  currentView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(['discover']),
  );

  function toggleGroup(groupId: string): void {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <span />
          <span />
        </div>
        <div className="brand-copy">
          <strong>Asset Workbench</strong>
          <span>LOCAL 3D PIPELINE</span>
        </div>
      </div>

      <nav className="side-nav" aria-label="主导航">
        {navGroups.map((group) => {
          const isOpen = expandedGroups.has(group.id);
          return (
            <section className="nav-group" key={group.id}>
              <button
                className={`nav-group-toggle ${isOpen ? 'is-open' : ''}`}
                type="button"
                aria-expanded={isOpen}
                aria-controls={`nav-${group.id}`}
                onClick={() => toggleGroup(group.id)}
              >
                <span className="nav-group-icon">
                  <Icon name={group.icon} size={16} />
                </span>
                <span>{group.label}</span>
                <Icon name="chevron" size={14} />
              </button>
              <div
                id={`nav-${group.id}`}
                className={`nav-group-content ${isOpen ? 'is-open' : ''}`}
              >
                <div className="nav-group-inner">
                  {group.items.map((item) => (
                    <button
                      className={`nav-item ${
                        item.view === currentView ? 'nav-item--active' : ''
                      }`}
                      type="button"
                      key={item.label}
                      disabled={!item.view}
                      aria-current={item.view === currentView ? 'page' : undefined}
                      onClick={() => {
                        if (item.view) {
                          onSelectView(item.view);
                        }
                      }}
                    >
                      <span className="nav-icon">
                        <Icon name={item.icon} size={15} />
                      </span>
                      <span>{item.label}</span>
                      {item.hint && <small>{item.hint}</small>}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="stage-caption">
          <span>当前版本</span>
          <strong>v{packageMetadata.version}</strong>
        </div>
        <div className="progress-track">
          <div style={{ width: '100%' }} />
        </div>
        <div className="sidebar-metrics">
          <span>
            <b>{enabledCount}</b> 启用
          </span>
          <span>
            <b>{totalCount}</b> 收录
          </span>
        </div>
      </div>
    </aside>
  );
}

export function App() {
  const sourceTableBodyRef = useRef<HTMLDivElement>(null);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<WorkspaceView>('sources');
  const [registryRevision, setRegistryRevision] = useState(0);
  const [accessFocusSourceId, setAccessFocusSourceId] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = window.modelSearch;
    if (!api) {
      setError('请通过 Electron 启动应用。浏览器页面无法访问本地数据库。');
      setLoading(false);
      return;
    }

    void api
      .getBootstrap()
      .then((data) => {
        setBootstrap(data);
        setSources(data.sources);
        setSelectedId(data.sources[0]?.sourceId ?? null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const api = window.modelSearch;
    if (!api || !bootstrap) {
      return;
    }

    let cancelled = false;
    void api
      .searchSources({ query: deferredQuery, filter })
      .then((nextSources) => {
        if (!cancelled) {
          setSources(nextSources);
          if (!nextSources.some((source) => source.sourceId === selectedId)) {
            setSelectedId(nextSources[0]?.sourceId ?? null);
          }
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrap, deferredQuery, filter, selectedId]);

  useEffect(() => {
    const api = window.modelSearch;
    if (!api || currentView !== 'sources' || !bootstrap) {
      return;
    }
    let cancelled = false;
    void api.getBootstrap().then((data) => {
      if (cancelled) {
        return;
      }
      setBootstrap(data);
      setSources(data.sources);
      if (!data.sources.some((source) => source.sourceId === selectedId)) {
        setSelectedId(data.sources[0]?.sourceId ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentView, registryRevision]);

  const selected = useMemo(
    () => sources.find((source) => source.sourceId === selectedId) ?? null,
    [selectedId, sources],
  );

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const container = sourceTableBodyRef.current;
    const row = document.getElementById(`source-row-${selectedId}`);
    if (!container || !row) {
      return;
    }

    const containerBounds = container.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.top < containerBounds.top) {
      container.scrollTop += rowBounds.top - containerBounds.top;
    } else if (rowBounds.bottom > containerBounds.bottom) {
      container.scrollTop += rowBounds.bottom - containerBounds.bottom;
    }
    detailScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedId, sources]);

  async function toggleSource(source: SourceRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }

    setBusyId(source.sourceId);
    setError(null);
    try {
      const updated = await api.setSourceEnabled(source.sourceId, !source.enabled);
      if (updated) {
        setSources((current) =>
          current.map((entry) =>
            entry.sourceId === updated.sourceId ? updated : entry,
          ),
        );
        setBootstrap((current) =>
          current
            ? {
                ...current,
                stats: {
                  ...current.stats,
                  enabled: current.stats.enabled + (updated.enabled ? 1 : -1),
                },
              }
            : current,
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  }

  async function configureSourceAccess(
    sourceId: string,
    reason: string,
  ): Promise<void> {
    const api = window.modelSearch;
    if (api) {
      try {
        await api.createPendingAccessAction({
          sourceId,
          kind: 'verify_access',
          reason,
        });
      } catch (reasonUnknown) {
        setError(
          reasonUnknown instanceof Error
            ? reasonUnknown.message
            : String(reasonUnknown),
        );
      }
    }
    setAccessFocusSourceId(sourceId);
    setCurrentView('access');
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <div className="ambient ambient--three" aria-hidden="true" />
      <div className="fine-grid" aria-hidden="true" />

      <AccordionSidebar
        enabledCount={bootstrap?.stats.enabled ?? 0}
        totalCount={bootstrap?.stats.total ?? 0}
        currentView={currentView}
        onSelectView={setCurrentView}
      />

      {currentView === 'search' ? (
        <SearchView
          sources={bootstrap?.sources ?? []}
          onConfigureSource={(sourceId, reason) =>
            void configureSourceAccess(sourceId, reason)
          }
        />
      ) : currentView === 'library' ? (
        <AssetLibraryView onGoSearch={() => setCurrentView('search')} />
      ) : currentView === 'access' ? (
        <AccessAccountsView
          focusSourceId={accessFocusSourceId}
          onFocusHandled={() => setAccessFocusSourceId(null)}
        />
      ) : currentView === 'discovery' ? (
        <SourceDiscoveryView
          onRegistered={() => setRegistryRevision((value) => value + 1)}
        />
      ) : (
        <main className="main-panel">
        <header className="topbar">
          <div className="title-block">
            <p className="eyebrow">SOURCE REGISTRY / 01</p>
            <h1>来源总览</h1>
            <p className="page-subtitle">整理、验证并连接你的 3D 资产来源。</p>
          </div>
          <div className="topbar-actions">
            <div className="runtime-chip">
              <span className="live-dot" />
              本地索引已就绪
            </div>
            <button className="quiet-button" type="button" disabled title="阶段 2 功能">
              <Icon name="search" size={15} />
              全局搜索
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>

        {error && (
          <div className="alert" role="alert">
            <strong>无法完成操作</strong>
            <span>{error}</span>
          </div>
        )}

        <section className="stat-grid" aria-label="来源统计">
          <TrackingPanel className="stat-card stat-card--primary">
            <span className="stat-topline">
              <Icon name="database" size={15} />
              唯一来源
            </span>
            <strong>{bootstrap?.stats.total ?? '—'}</strong>
            <small>经过域名与别名去重后的站点主体</small>
            <span className="stat-glow" aria-hidden="true" />
          </TrackingPanel>
          <TrackingPanel className="stat-card">
            <span className="stat-topline">已启用</span>
            <strong>{bootstrap?.stats.enabled ?? '—'}</strong>
            <small>参与后续搜索与下载流程</small>
            <span className="stat-glow" aria-hidden="true" />
          </TrackingPanel>
          <TrackingPanel className="stat-card">
            <span className="stat-topline">已集成</span>
            <strong>{bootstrap?.stats.upstream ?? '—'}</strong>
            <small>拥有上游 provider 的公共来源</small>
            <span className="stat-glow" aria-hidden="true" />
          </TrackingPanel>
          <TrackingPanel className="stat-card">
            <span className="stat-topline">待探测</span>
            <strong>{bootstrap?.stats.seedOnly ?? '—'}</strong>
            <small>等待授权和结构验证的种子来源</small>
            <span className="stat-glow" aria-hidden="true" />
          </TrackingPanel>
        </section>

        <section className="workspace">
          <TrackingPanel className="source-panel">
            <div className="panel-head">
              <div>
                <div className="section-kicker">
                  <span className="section-index">01</span>
                  <span>站点注册表</span>
                </div>
                <h2>所有来源</h2>
                <p>集中管理站点、采集能力与访问状态。</p>
              </div>
              <span className="count-label">{sources.length} 条结果</span>
            </div>

            <div className="toolbar">
              <label className="search-box">
                <Icon name="search" size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、域名或别名"
                  aria-label="搜索来源"
                />
                {query && (
                  <button
                    type="button"
                    className="clear-button"
                    onClick={() => setQuery('')}
                    aria-label="清空搜索"
                  >
                    ×
                  </button>
                )}
              </label>
              <div className="filter-group" role="group" aria-label="来源筛选">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? 'filter-chip is-active' : 'filter-chip'}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="source-table" role="table" aria-label="来源列表">
              <div className="table-head" role="row">
                <span>来源</span>
                <span>状态</span>
                <span>许可摘要</span>
                <span className="align-right">启用</span>
              </div>

              <div className="table-body" ref={sourceTableBodyRef}>
                {loading && <div className="empty-state">正在读取本地来源数据库…</div>}
                {!loading && sources.length === 0 && (
                  <div className="empty-state">没有符合条件的来源。</div>
                )}
                {sources.map((source) => (
                  <div
                    role="row"
                    id={`source-row-${source.sourceId}`}
                    key={source.sourceId}
                    className={`source-row ${
                      selectedId === source.sourceId ? 'source-row--selected' : ''
                    }`}
                    tabIndex={0}
                    onClick={() => setSelectedId(source.sourceId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(source.sourceId);
                      }
                    }}
                  >
                    <span className="source-name-cell">
                      <span className="source-monogram">
                        {source.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="source-name-copy">
                        <strong>{source.displayName}</strong>
                        <small>{source.domains.join(' · ')}</small>
                      </span>
                    </span>
                    <span>
                      <SourceBadge source={source} />
                    </span>
                    <span className="license-cell">
                      {source.userMetadata?.license_summary || '等待探测许可信息'}
                    </span>
                    <span className="toggle-cell">
                      <button
                        type="button"
                        className={`switch ${source.enabled ? 'is-on' : ''}`}
                        aria-label={`${source.enabled ? '停用' : '启用'} ${source.displayName}`}
                        aria-pressed={source.enabled}
                        disabled={busyId === source.sourceId}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleSource(source);
                        }}
                      >
                        <span />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </TrackingPanel>

          <TrackingPanel className="detail-panel">
            <div className="detail-scroll" ref={detailScrollRef}>
              {selected ? (
                <>
                <div className="detail-head">
                  <span className="source-monogram source-monogram--large">
                    {selected.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <p className="eyebrow">SOURCE DETAIL</p>
                    <h2>{selected.displayName}</h2>
                  </div>
                </div>

                <div className="detail-status">
                  <SourceBadge source={selected} />
                  <span className={selected.enabled ? 'enabled-label' : 'disabled-label'}>
                    {selected.enabled ? '允许查询' : '暂停查询'}
                  </span>
                </div>

                <div className="detail-hero">
                  <span>{selected.domains[0]}</span>
                  <strong>
                    {selected.userMetadata?.recommended_use || '等待来源探测'}
                  </strong>
                </div>

                <section className="detail-section">
                  <h3>来源信息</h3>
                  <dl>
                    <div>
                      <dt>主页</dt>
                      <dd>{selected.homepage}</dd>
                    </div>
                    <div>
                      <dt>格式</dt>
                      <dd>{selected.userMetadata?.formats || '待探测'}</dd>
                    </div>
                    <div>
                      <dt>地区语言</dt>
                      <dd>{selected.userMetadata?.region_language || '待探测'}</dd>
                    </div>
                    <div>
                      <dt>许可</dt>
                      <dd>{selected.userMetadata?.license_summary || '待探测'}</dd>
                    </div>
                  </dl>
                </section>

                <section className="detail-section">
                  <h3>后续能力</h3>
                  <ul className="capability-list">
                    <li>
                      <span>搜索</span>
                      <b className="pending">待探测</b>
                    </li>
                    <li>
                      <span>许可证据</span>
                      <b className="pending">待探测</b>
                    </li>
                    <li>
                      <span>下载权限</span>
                      <b className="pending">待探测</b>
                    </li>
                    <li>
                      <span>账号要求</span>
                      <b className="pending">待探测</b>
                    </li>
                  </ul>
                </section>

                {selected.aliases.length > 0 && (
                  <section className="detail-section">
                    <h3>合并入口</h3>
                    <div className="alias-list">
                      {selected.aliases.map((alias) => (
                        <span key={`${alias.kind}-${alias.url}`}>{alias.name}</span>
                      ))}
                    </div>
                  </section>
                )}
                </>
              ) : (
                <div className="empty-state">选择一个来源查看详情。</div>
              )}
            </div>
          </TrackingPanel>
        </section>

        <footer className="footer">
          <span>{bootstrap?.databasePath ?? '等待数据库初始化'}</span>
          <span>
            <Icon name="check" size={12} />
            Schema v{bootstrap?.schemaVersion ?? '—'}
          </span>
        </footer>
        </main>
      )}
    </div>
  );
}
