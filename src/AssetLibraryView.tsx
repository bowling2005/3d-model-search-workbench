import { useEffect, useState } from 'react';
import type {
  DownloadedAssetRecord,
  PipelineSettings,
  UnityImportRecord,
} from '../core/pipeline/types';

interface AssetLibraryViewProps {
  onGoSearch: () => void;
}

type BusyAction = 'inspect' | 'process' | 'unity' | 'plugin' | null;

function PipelineGlyph({ kind }: { kind: 'blender' | 'unity' | 'folder' }) {
  if (kind === 'unity') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m12 8 4 2.3v4.4L12 17l-4-2.3v-4.4L12 8Z" />
      </svg>
    );
  }
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="9" r="2.5" />
      <path d="M8 18c.8-3 2.2-4.5 4-4.5s3.2 1.5 4 4.5" />
    </svg>
  );
}

export function AssetLibraryView({ onGoSearch }: AssetLibraryViewProps) {
  const [settings, setSettings] = useState<PipelineSettings | null>(null);
  const [assets, setAssets] = useState<DownloadedAssetRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected =
    assets.find((asset) => asset.assetId === selectedId) ?? assets[0] ?? null;

  async function refresh(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      setError('请通过 Electron 启动应用。');
      return;
    }
    const [nextSettings, nextAssets] = await Promise.all([
      api.getPipelineSettings(),
      api.getDownloadedAssets(),
    ]);
    setSettings(nextSettings);
    setAssets(nextAssets);
    if (!nextAssets.some((asset) => asset.assetId === selectedId)) {
      setSelectedId(nextAssets[0]?.assetId ?? null);
    }
  }

  useEffect(() => {
    void refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);

  useEffect(() => {
    const requestId = selected?.latestUnityImport?.requestId;
    const status = selected?.latestUnityImport?.status;
    const api = window.modelSearch;
    if (!api || !requestId || !status || !['queued', 'processing'].includes(status)) {
      return;
    }
    const timer = window.setInterval(() => {
      void api.getUnityImportStatus(requestId).then(async (record) => {
        if (record && record.status !== status) {
          await refresh();
        }
      });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [selected?.latestUnityImport?.requestId, selected?.latestUnityImport?.status]);

  async function chooseBlender(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy('plugin');
    try {
      const next = await api.chooseBlenderPath();
      if (next) {
        setSettings(next);
        setMessage(next.blenderAvailable ? `Blender 已连接：${next.blenderVersion}` : 'Blender 配置未通过验证。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function chooseUnity(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy('plugin');
    try {
      const next = await api.chooseUnityProject();
      if (next) {
        setSettings(next);
        setMessage('Unity 项目已连接。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function installUnityPlugin(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy('plugin');
    setError(null);
    try {
      const next = await api.installUnityPlugin();
      setSettings(next);
      setMessage('Unity 导入插件已安装。切回 Unity 后等待脚本编译完成。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function inspectSelected(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !selected) {
      return;
    }
    setBusy('inspect');
    setError(null);
    setMessage('Blender 正在后台核验模型…');
    try {
      const result = await api.inspectAsset(selected.assetId);
      await refresh();
      setMessage(
        `核验完成：${result.report.triangles.toLocaleString('zh-CN')} 三角面，${result.report.meshes} 个网格。`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function processSelected(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !selected) {
      return;
    }
    setBusy('process');
    setError(null);
    setMessage('Blender 正在应用安全清理并导出 FBX…');
    try {
      const result = await api.processAsset(selected.assetId);
      await refresh();
      setMessage(
        result.outputModelPath
          ? `处理完成：已导出 ${result.outputModelPath}`
          : '处理完成。',
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function importToUnity(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !selected) {
      return;
    }
    setBusy('unity');
    setError(null);
    try {
      const result = await api.importAssetToUnity(selected.assetId);
      await refresh();
      setMessage(`导入请求已交给 Unity：${result.requestId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function openFolder(path: string): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    const response = await api.openAssetFolder(path);
    if (response) {
      setError(response);
    }
  }

  const report = selected?.latestInspection?.report ?? null;
  const unity = selected?.latestUnityImport ?? null;

  return (
    <main className="main-panel library-main">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">ASSET LIBRARY / 03</p>
          <h1>下载资产</h1>
          <p className="page-subtitle">核验模型、处理格式，并交给 Unity 导入。</p>
        </div>
        <div className="topbar-actions">
          <div className="runtime-chip runtime-chip--quiet">
            {assets.length} 个本地资产
          </div>
          <button className="quiet-button" type="button" onClick={onGoSearch}>
            继续搜索
          </button>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          <strong>处理失败</strong>
          <span>{error}</span>
        </div>
      )}
      {message && <div className="pipeline-message">{message}</div>}

      <section className="pipeline-settings glass-panel">
        <div className="pipeline-setting">
          <span className="pipeline-setting-icon"><PipelineGlyph kind="blender" /></span>
          <div>
            <strong>Blender</strong>
            <small>
              {settings?.blenderAvailable
                ? settings.blenderVersion
                : '未检测到可用的 Blender'}
            </small>
          </div>
          <button type="button" onClick={() => void chooseBlender()} disabled={busy !== null}>
            选择路径
          </button>
        </div>
        <div className="pipeline-setting">
          <span className="pipeline-setting-icon"><PipelineGlyph kind="unity" /></span>
          <div>
            <strong>Unity 项目</strong>
            <small>{settings?.unityProjectPath ?? '请选择 Unity 项目'}</small>
          </div>
          <button type="button" onClick={() => void chooseUnity()} disabled={busy !== null}>
            选择项目
          </button>
        </div>
        <div className="pipeline-setting">
          <span className="pipeline-setting-icon"><PipelineGlyph kind="unity" /></span>
          <div>
            <strong>Unity 插件</strong>
            <small>
              {settings?.unityPluginInstalled ? '已安装' : '尚未安装到项目'}
            </small>
          </div>
          <button
            type="button"
            onClick={() => void installUnityPlugin()}
            disabled={busy !== null || !settings?.unityProjectValid}
          >
            {settings?.unityPluginInstalled ? '重新安装' : '安装插件'}
          </button>
        </div>
      </section>

      {assets.length === 0 ? (
        <section className="results-empty glass-panel library-empty">
          <div className="empty-orbit"><PipelineGlyph kind="folder" /></div>
          <strong>还没有下载资产</strong>
          <span>先在“模型搜索”中下载一个模型，再回来进行 Blender 和 Unity 处理。</span>
          <button className="primary-action" type="button" onClick={onGoSearch}>
            去搜索模型
          </button>
        </section>
      ) : (
        <section className="library-workspace">
          <div className="library-list glass-panel">
            <div className="library-list-head">
              <span>本地资产</span>
              <small>{assets.length}</small>
            </div>
            <div className="library-list-scroll">
              {assets.map((asset) => (
                <button
                  className={`library-row ${
                    selected?.assetId === asset.assetId ? 'is-selected' : ''
                  }`}
                  type="button"
                  key={asset.assetId}
                  onClick={() => setSelectedId(asset.assetId)}
                >
                  <span className="library-thumb">
                    {asset.thumbnailUrl ? (
                      <img src={asset.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      '3D'
                    )}
                  </span>
                  <span className="library-row-copy">
                    <strong>{asset.title}</strong>
                    <small>{asset.sourceName} · {asset.licenseName ?? '许可未知'}</small>
                  </span>
                  <span className={`library-state state-${asset.latestInspection?.status ?? 'new'}`}>
                    {asset.latestInspection?.status === 'completed'
                      ? '已核验'
                      : asset.latestInspection?.status === 'failed'
                        ? '需重试'
                        : '已下载'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <div className="library-detail glass-panel">
              <div className="library-hero">
                <div className="library-hero-image">
                  {selected.thumbnailUrl ? (
                    <img src={selected.thumbnailUrl} alt="" />
                  ) : (
                    '3D'
                  )}
                </div>
                <div>
                  <p className="eyebrow">LOCAL ASSET</p>
                  <h2>{selected.title}</h2>
                  <p>{selected.sourceName} · {selected.author ?? '未知作者'}</p>
                  <div className="asset-formats">
                    {selected.formats.map((format) => (
                      <span key={format}>{format.toUpperCase()}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="library-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={busy !== null || !settings?.blenderAvailable}
                  onClick={() => void inspectSelected()}
                >
                  {busy === 'inspect' ? 'Blender 核验中…' : '核验面数与拓扑'}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={busy !== null || !settings?.blenderAvailable}
                  onClick={() => void processSelected()}
                >
                  {busy === 'process' ? '处理中…' : '清理并导出 FBX'}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={busy !== null || !selected}
                  onClick={() => void openFolder(selected.downloadDirectory)}
                >
                  <PipelineGlyph kind="folder" />
                  打开文件夹
                </button>
              </div>

              <div className="pipeline-flow">
                <PipelineStep
                  index="01"
                  title="已下载"
                  detail={`${selected.files.length} 个文件`}
                  done
                />
                <PipelineStep
                  index="02"
                  title="Blender"
                  detail={
                    report
                      ? `${report.triangles.toLocaleString('zh-CN')} tris`
                      : '尚未核验'
                  }
                  done={selected.latestInspection?.status === 'completed'}
                />
                <PipelineStep
                  index="03"
                  title="Unity"
                  detail={unityStatusText(unity)}
                  done={unity?.status === 'completed'}
                />
              </div>

              {report && (
                <section className="inspection-panel">
                  <div className="inspection-head">
                    <h3>Blender 核验结果</h3>
                    <span>{selected.latestInspection?.blenderVersion}</span>
                  </div>
                  <div className="inspection-metrics">
                    <Metric label="三角面" value={report.triangles.toLocaleString('zh-CN')} />
                    <Metric label="多边形" value={report.polygons.toLocaleString('zh-CN')} />
                    <Metric label="顶点" value={report.vertices.toLocaleString('zh-CN')} />
                    <Metric label="材质" value={String(report.materials)} />
                    <Metric label="贴图" value={String(report.textures)} />
                    <Metric label="对象" value={String(report.objects)} />
                  </div>
                  <div className="topology-grid">
                    <Metric label="非流形边" value={String(report.issues.nonManifoldEdges)} compact />
                    <Metric label="边界边" value={String(report.issues.boundaryEdges)} compact />
                    <Metric label="松散点" value={String(report.issues.looseVertices)} compact />
                    <Metric label="退化面" value={String(report.issues.degenerateFaces)} compact />
                    <Metric label="重复面" value={String(report.issues.duplicateFaces)} compact />
                  </div>
                  {report.warnings.length > 0 && (
                    <div className="inspection-warnings">
                      {report.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                    </div>
                  )}
                </section>
              )}

              <section className="unity-panel">
                <div>
                  <h3>Unity 导入</h3>
                  <p>
                    {selected.latestInspection?.outputModelPath
                      ? '将导入 Blender 处理后的 FBX。'
                      : selected.formats.some((format) => ['fbx', 'obj'].includes(format))
                        ? '尚未处理，可直接导入原始 FBX/OBJ。'
                        : '请先执行“清理并导出 FBX”。'}
                  </p>
                </div>
                <button
                  className="primary-action"
                  type="button"
                  disabled={
                    busy !== null ||
                    !settings?.unityPluginInstalled ||
                    (!selected.latestInspection?.outputModelPath &&
                      !selected.formats.some((format) =>
                        ['fbx', 'obj'].includes(format),
                      )) ||
                    ['queued', 'processing'].includes(unity?.status ?? '')
                  }
                  onClick={() => void importToUnity()}
                >
                  {busy === 'unity'
                    ? '提交中…'
                    : unity?.status === 'completed'
                      ? '重新导入'
                      : '导入 Unity'}
                </button>
                <div className={`unity-result unity-result--${unity?.status ?? 'idle'}`}>
                  <strong>{unityStatusText(unity)}</strong>
                  {unity?.result && (
                    <span>{String(unity.result.importedPath ?? unity.result.message ?? '')}</span>
                  )}
                </div>
              </section>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>{selected?.downloadDirectory ?? 'Local asset library'}</span>
        <span>Blender → Unity</span>
      </footer>
    </main>
  );
}

function PipelineStep({
  index,
  title,
  detail,
  done,
}: {
  index: string;
  title: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <div className={`pipeline-step ${done ? 'is-done' : ''}`}>
      <span>{index}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Metric({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`metric ${compact ? 'metric--compact' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function unityStatusText(record: UnityImportRecord | null): string {
  if (!record) {
    return '等待 Unity';
  }
  switch (record.status) {
    case 'completed':
      return '已导入';
    case 'failed':
      return '导入失败';
    case 'processing':
      return 'Unity 处理中';
    case 'queued':
      return '等待 Unity 编辑器';
    default:
      return record.status;
  }
}
