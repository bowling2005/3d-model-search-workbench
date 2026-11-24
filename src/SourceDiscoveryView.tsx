import { useEffect, useMemo, useState } from 'react';
import type {
  SourceCandidateOverview,
  SourceCandidateRecord,
  SourceCandidateStatus,
} from '../core/discovery/source-types';

interface SourceDiscoveryViewProps {
  onRegistered: () => void;
}

const statusLabels: Record<SourceCandidateStatus, string> = {
  candidate: '候选',
  probing: '探测中',
  ready_for_review: '待审核',
  access_required: '需要授权',
  duplicate: '重复',
  quarantined: '隔离',
  approved: '已加入',
  rejected: '已排除',
  error: '错误',
};

export function SourceDiscoveryView({ onRegistered }: SourceDiscoveryViewProps) {
  const [overview, setOverview] = useState<SourceCandidateOverview | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleCandidates = useMemo(
    () =>
      overview?.candidates.filter(
        (candidate) =>
          !['approved', 'rejected'].includes(candidate.status),
      ) ?? [],
    [overview?.candidates],
  );
  const selected =
    overview?.candidates.find((candidate) => candidate.candidateId === selectedId) ??
    visibleCandidates[0] ??
    null;

  async function refresh(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      throw new Error('请通过 Electron 启动应用。');
    }
    const next = await api.getSourceDiscoveryOverview();
    setOverview(next);
    setSelectedId((current) =>
      current && next.candidates.some((candidate) => candidate.candidateId === current)
        ? current
        : next.candidates.find(
            (candidate) => !['approved', 'rejected'].includes(candidate.status),
          )?.candidateId ?? null,
    );
  }

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);

  async function addUrl(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !url.trim()) {
      return;
    }
    setBusy('add');
    setError(null);
    try {
      const response = await api.discoverSource(url.trim());
      setUrl('');
      await refresh();
      setSelectedId(response.candidate.candidateId);
      setMessage(`候选站点已探测：${response.candidate.displayName}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function scanSources(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy('scan');
    setError(null);
    try {
      const result = await api.scanKnownSources();
      await refresh();
      setMessage(
        `扫描完成：发现 ${result.created} 个候选，跳过 ${result.duplicates} 个重复，失败 ${result.failed} 个。`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function reprobe(candidate: SourceCandidateRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(candidate.candidateId);
    try {
      await api.reprobeSourceCandidate(candidate.candidateId);
      await refresh();
      setMessage('候选站点已重新探测。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function approve(candidate: SourceCandidateRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(candidate.candidateId);
    try {
      const sourceId = await api.approveSourceCandidate(candidate.candidateId);
      await refresh();
      onRegistered();
      setMessage(`已加入来源库：${sourceId}。来源默认停用，完成适配后再启用。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function reject(candidate: SourceCandidateRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(candidate.candidateId);
    try {
      await api.rejectSourceCandidate(candidate.candidateId);
      await refresh();
      setMessage('候选站点已排除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAuto(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !overview) {
      return;
    }
    await api.setSourceDiscoveryAutoEnabled(!overview.autoDiscoveryEnabled);
    await refresh();
  }

  return (
    <main className="main-panel discovery-main">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">SOURCE DISCOVERY / 05</p>
          <h1>来源发现</h1>
          <p className="page-subtitle">
            从现有来源外链和手动网址中发现候选站点，探测后交由人工审核。
          </p>
        </div>
        <div className="topbar-actions">
          <button
            className={`runtime-chip ${overview?.autoDiscoveryEnabled ? '' : 'runtime-chip--quiet'}`}
            type="button"
            onClick={() => void toggleAuto()}
          >
            <span className="live-dot" />
            自动发现 {overview?.autoDiscoveryEnabled ? '已开启' : '已关闭'}
          </button>
          <button
            className="quiet-button"
            type="button"
            onClick={() => void scanSources()}
            disabled={busy !== null}
          >
            {busy === 'scan' ? '扫描来源中…' : '扫描现有来源外链'}
          </button>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          <strong>来源发现</strong>
          <span>{error}</span>
        </div>
      )}
      {message && <div className="pipeline-message">{message}</div>}

      <section className="discovery-add glass-panel">
        <label>
          <span>候选站点网址</span>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/free-3d-models"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void addUrl();
              }
            }}
          />
        </label>
        <button
          className="primary-action"
          type="button"
          disabled={busy !== null || !url.trim()}
          onClick={() => void addUrl()}
        >
          {busy === 'add' ? '探测中…' : '添加并探测'}
        </button>
        <div className="discovery-policy">
          <strong>隔离优先</strong>
          <span>新站点只会保存元数据和公开页面证据，不会自动下载模型。</span>
        </div>
      </section>

      <section className="discovery-workspace">
        <div className="candidate-list glass-panel">
          <div className="library-list-head">
            <span>候选站点</span>
            <small>{visibleCandidates.length}</small>
          </div>
          <div className="library-list-scroll">
            {visibleCandidates.map((candidate) => (
              <button
                className={`candidate-row ${
                  selected?.candidateId === candidate.candidateId ? 'is-selected' : ''
                }`}
                type="button"
                key={candidate.candidateId}
                onClick={() => setSelectedId(candidate.candidateId)}
              >
                <span className="candidate-score">{Math.round(candidate.score)}</span>
                <span>
                  <strong>{candidate.displayName}</strong>
                  <small>{candidate.domain}</small>
                </span>
                <span className={`candidate-status status-${candidate.status}`}>
                  {statusLabels[candidate.status]}
                </span>
              </button>
            ))}
            {visibleCandidates.length === 0 && (
              <div className="account-empty">暂无候选。可以添加网址或扫描现有来源外链。</div>
            )}
          </div>
        </div>

        <div className="candidate-detail glass-panel">
          {selected ? (
            <>
              <div className="candidate-head">
                <div>
                  <p className="eyebrow">CANDIDATE SOURCE</p>
                  <h2>{selected.displayName}</h2>
                  <span className="candidate-homepage">{selected.homepage}</span>
                </div>
                <span className="candidate-score candidate-score--large">
                  {Math.round(selected.score)}
                </span>
              </div>
              <div className="candidate-summary">
                <span className={`candidate-status status-${selected.status}`}>
                  {statusLabels[selected.status]}
                </span>
                <span>{selected.discoveryKind}</span>
                <span>{selected.formats.join(' / ') || '格式未确认'}</span>
                <span>{selected.licenseSummary ?? '许可未确认'}</span>
              </div>
              {selected.probe && (
                <>
                  <p className="candidate-description">
                    {selected.probe.description || '首页没有提供可读描述。'}
                  </p>
                  <div className="candidate-metrics">
                    <Metric label="模型关键词" value={selected.probe.modelKeywords} />
                    <Metric label="样例模型链接" value={selected.probe.sampleModelLinks} />
                    <Metric label="格式" value={selected.probe.formats.length} />
                    <Metric label="Robots" value={selected.probe.robotsAllowed ? 1 : 0} />
                  </div>
                  {selected.probe.warnings.length > 0 && (
                    <div className="inspection-warnings">
                      {selected.probe.warnings.map((warning) => (
                        <span key={warning}>{warning}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="candidate-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={
                    busy !== null ||
                    ['duplicate', 'approved', 'rejected'].includes(selected.status)
                  }
                  onClick={() => void approve(selected)}
                >
                  加入来源库
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void reprobe(selected)}
                >
                  重新探测
                </button>
                <button
                  className="secondary-action danger-text"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void reject(selected)}
                >
                  排除候选
                </button>
                <span>
                  加入后默认停用，需要完成来源配方和访问验证。
                </span>
              </div>
            </>
          ) : (
            <div className="empty-state">选择一个候选站点查看探测证据。</div>
          )}
        </div>
      </section>

      <footer className="footer">
        <span>公开页面探测 · 新来源默认隔离</span>
        <span>{overview?.lastScanAt ? `上次扫描 ${formatDate(overview.lastScanAt)}` : '尚未扫描'}</span>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric metric--compact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
