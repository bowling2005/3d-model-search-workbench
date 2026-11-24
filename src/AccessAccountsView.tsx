import { useEffect, useMemo, useState } from 'react';
import type {
  AccessAuthMode,
  AccessOverview,
  AccessProfileRecord,
  AccessSourceRecord,
  PendingAccessAction,
} from '../core/access/types';

interface AccessAccountsViewProps {
  focusSourceId: string | null;
  onFocusHandled: () => void;
}

const authModeLabels: Record<AccessAuthMode, string> = {
  browser_session: '浏览器登录',
  oauth2: 'OAuth 授权',
  api_key: 'API Key',
  password: '账号密码',
};

function statusLabel(status: AccessProfileRecord['status']): string {
  switch (status) {
    case 'ready':
      return '可用';
    case 'awaiting_login':
      return '等待登录';
    case 'pending_verification':
      return '待验证';
    case 'expired':
      return '会话过期';
    case 'revoked':
      return '已撤销';
    case 'error':
      return '错误';
    case 'unconfigured':
    default:
      return '未配置';
  }
}

export function AccessAccountsView({
  focusSourceId,
  onFocusHandled,
}: AccessAccountsViewProps) {
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    authMode: 'browser_session' as AccessAuthMode,
    username: '',
    password: '',
    apiKey: '',
  });

  const selectedSource =
    overview?.sources.find((source) => source.sourceId === selectedSourceId) ??
    overview?.sources[0] ??
    null;
  const pendingForSource = useMemo(
    () =>
      overview?.pendingActions.filter(
        (action) => action.sourceId === selectedSource?.sourceId,
      ) ?? [],
    [overview?.pendingActions, selectedSource?.sourceId],
  );

  async function refresh(): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      throw new Error('请通过 Electron 启动应用。');
    }
    const next = await api.getAccessOverview();
    setOverview(next);
    setSelectedSourceId((current) => {
      if (focusSourceId && next.sources.some((source) => source.sourceId === focusSourceId)) {
        return focusSourceId;
      }
      if (current && next.sources.some((source) => source.sourceId === current)) {
        return current;
      }
      return next.sources[0]?.sourceId ?? null;
    });
  }

  useEffect(() => {
    void refresh()
      .then(() => {
        if (focusSourceId) {
          setShowForm(true);
          onFocusHandled();
        }
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [focusSourceId]);

  async function createProfile(): Promise<void> {
    const api = window.modelSearch;
    if (!api || !selectedSource) {
      return;
    }
    setBusy('create');
    setError(null);
    setMessage(null);
    try {
      await api.createAccessProfile({
        sourceId: selectedSource.sourceId,
        displayName:
          form.displayName.trim() || `${selectedSource.displayName} 账号`,
        authMode: form.authMode,
        username: form.username,
        password: form.password,
        apiKey: form.apiKey,
      });
      setForm({
        displayName: '',
        authMode: 'browser_session',
        username: '',
        password: '',
        apiKey: '',
      });
      setShowForm(false);
      await refresh();
      setMessage('账号配置已保存。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function openLogin(profile: AccessProfileRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(profile.profileId);
    setError(null);
    try {
      await api.openAccessLogin(profile.profileId);
      setMessage('登录窗口已打开。完成登录、二次验证或验证码后关闭窗口，再点击“验证会话”。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function verifySession(profile: AccessProfileRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(profile.profileId);
    setError(null);
    try {
      const result = await api.checkAccessSession(profile.profileId);
      await refresh();
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function clearSession(profile: AccessProfileRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    setBusy(profile.profileId);
    try {
      await api.clearAccessSession(profile.profileId);
      await refresh();
      setMessage('本地站点会话已清除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function deleteProfile(profile: AccessProfileRecord): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    const confirmed = window.confirm(
      `删除“${profile.displayName}”？本地保存的凭据和浏览器会话会一并删除。`,
    );
    if (!confirmed) {
      return;
    }
    setBusy(profile.profileId);
    try {
      await api.deleteAccessProfile(profile.profileId);
      await refresh();
      setMessage('账号档案已删除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function resolvePending(action: PendingAccessAction): Promise<void> {
    const api = window.modelSearch;
    if (!api) {
      return;
    }
    await api.resolvePendingAccessAction(action.actionId);
    await refresh();
  }

  return (
    <main className="main-panel access-main">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">ACCESS & CREDENTIALS / 04</p>
          <h1>访问与账号</h1>
          <p className="page-subtitle">
            管理站点账号、隔离登录会话和待处理授权任务。
          </p>
        </div>
        <div className="topbar-actions">
          <div className={`runtime-chip ${overview?.encryptionAvailable ? '' : 'is-warning'}`}>
            <span className="live-dot" />
            {overview?.encryptionAvailable ? 'Windows 安全存储可用' : '安全存储不可用'}
          </div>
          <div className="runtime-chip runtime-chip--quiet">
            {overview?.pendingActions.length ?? 0} 个待办
          </div>
        </div>
      </header>

      {error && (
        <div className="alert" role="alert">
          <strong>访问流程</strong>
          <span>{error}</span>
        </div>
      )}
      {message && <div className="pipeline-message">{message}</div>}

      <section className="access-workspace">
        <div className="access-source-list glass-panel">
          <div className="library-list-head">
            <span>来源</span>
            <small>{overview?.sources.length ?? 0}</small>
          </div>
          <div className="library-list-scroll">
            {overview?.sources.map((source) => (
              <button
                type="button"
                key={source.sourceId}
                className={`access-source-row ${
                  selectedSource?.sourceId === source.sourceId ? 'is-selected' : ''
                }`}
                onClick={() => setSelectedSourceId(source.sourceId)}
              >
                <span className="source-monogram">
                  {source.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{source.displayName}</strong>
                  <small>{source.homepage.replace(/^https?:\/\//, '')}</small>
                </span>
                <b>{source.profiles.length > 0 ? `${source.profiles.length} 账号` : '未配置'}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="access-detail glass-panel">
          {selectedSource ? (
            <>
              <div className="access-detail-head">
                <div>
                  <p className="eyebrow">SOURCE ACCESS</p>
                  <h2>{selectedSource.displayName}</h2>
                  <span>{selectedSource.homepage}</span>
                </div>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => setShowForm((current) => !current)}
                >
                  {showForm ? '收起配置' : '添加账号'}
                </button>
              </div>

              {showForm && (
                <section className="account-form">
                  <div className="account-form-grid">
                    <label>
                      <span>配置名称</span>
                      <input
                        value={form.displayName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                        placeholder={`${selectedSource.displayName} 主账号`}
                      />
                    </label>
                    <label>
                      <span>授权方式</span>
                      <select
                        value={form.authMode}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            authMode: event.target.value as AccessAuthMode,
                          }))
                        }
                      >
                        {Object.entries(authModeLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>用户名 / 邮箱</span>
                      <input
                        value={form.username}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            username: event.target.value,
                          }))
                        }
                        placeholder="可选"
                      />
                    </label>
                    {form.authMode === 'api_key' ? (
                      <label>
                        <span>API Key</span>
                        <input
                          type="password"
                          value={form.apiKey}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              apiKey: event.target.value,
                            }))
                          }
                          placeholder="保存后不可回显"
                        />
                      </label>
                    ) : (
                      <label>
                        <span>密码（可选）</span>
                        <input
                          type="password"
                          value={form.password}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                          placeholder="使用 Windows 安全存储"
                        />
                      </label>
                    )}
                  </div>
                  <div className="account-form-foot">
                    <p>
                      推荐使用浏览器登录。密码和 API Key 由系统加密保存，
                      不写入日志，也不会传给外部搜索服务。
                    </p>
                    <button
                      className="primary-action"
                      type="button"
                      disabled={busy !== null || !overview?.encryptionAvailable}
                      onClick={() => void createProfile()}
                    >
                      {busy === 'create' ? '保存中…' : '保存账号配置'}
                    </button>
                  </div>
                </section>
              )}

              <section className="account-profiles">
                <h3>账号档案</h3>
                {selectedSource.profiles.length === 0 && (
                  <div className="account-empty">
                    该来源暂无账号。浏览器登录会话会与其它来源隔离。
                  </div>
                )}
                {selectedSource.profiles.map((profile) => (
                  <article className="account-card" key={profile.profileId}>
                    <div className="account-card-head">
                      <span className="source-monogram">
                        {profile.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{profile.displayName}</strong>
                        <small>
                          {profile.usernameHint ?? '未记录用户名'} · {authModeLabels[profile.authMode]}
                        </small>
                      </div>
                      <span className={`account-status account-status--${profile.status}`}>
                        {statusLabel(profile.status)}
                      </span>
                    </div>
                    <div className="account-security-line">
                      <span>{profile.hasSecret ? '凭据已加密保存' : '未保存密码或 API Key'}</span>
                      <span>{profile.lastVerifiedAt ? `验证于 ${formatDate(profile.lastVerifiedAt)}` : '尚未验证'}</span>
                    </div>
                    <div className="account-actions">
                      <button type="button" onClick={() => void openLogin(profile)}>
                        打开登录窗口
                      </button>
                      <button type="button" onClick={() => void verifySession(profile)}>
                        验证会话
                      </button>
                      <button type="button" onClick={() => void clearSession(profile)}>
                        清除会话
                      </button>
                      <button className="danger-text" type="button" onClick={() => void deleteProfile(profile)}>
                        删除账号
                      </button>
                    </div>
                  </article>
                ))}
              </section>

              {pendingForSource.length > 0 && (
                <section className="access-pending">
                  <h3>来源待办</h3>
                  {pendingForSource.map((action) => (
                    <div className="pending-row" key={action.actionId}>
                      <span>
                        <strong>{action.kind === 'verify_access' ? '配置访问' : action.kind}</strong>
                        <small>{action.reason ?? '需要用户操作'}</small>
                      </span>
                      <button type="button" onClick={() => void resolvePending(action)}>
                        标记完成
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <div className="empty-state">选择一个来源配置账号。</div>
          )}
        </div>
      </section>

      <footer className="footer">
        <span>Credentials remain on this device · Isolated browser sessions</span>
        <span>{overview?.pendingActions.length ?? 0} pending</span>
      </footer>
    </main>
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
