import {
  BrowserWindow,
  safeStorage,
  session,
  type BrowserWindow as ElectronBrowserWindow,
} from 'electron';
import { randomUUID } from 'node:crypto';
import type { AssetDatabase } from '../core/database';
import type {
  AccessAuthMode,
  AccessOverview,
  AccessProfileRecord,
  CreateAccessProfileInput,
  PendingAccessAction,
  SessionCheckResult,
} from '../core/access/types';

export class AccessManager {
  constructor(
    private readonly database: AssetDatabase,
    private readonly getOwnerWindow: () => ElectronBrowserWindow | null,
  ) {}

  getOverview(): AccessOverview {
    return {
      ...this.database.getAccessOverview(),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  async createProfile(
    input: CreateAccessProfileInput,
  ): Promise<AccessProfileRecord> {
    const source = this.database.getSourceAccessInfo(input.sourceId);
    if (!source) {
      throw new Error('Source was not found.');
    }
    const authMode = normalizeAuthMode(input.authMode);
    const profileId = randomUUID();
    const hasInlineSecret = Boolean(
      input.password?.trim() || input.apiKey?.trim(),
    );
    if (hasInlineSecret && !safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows secure credential storage is unavailable.');
    }
    const initialStatus =
      authMode === 'api_key' || authMode === 'password'
        ? 'pending_verification'
        : 'awaiting_login';
    const profile = this.database.createAccessProfile({
      profileId,
      sourceId: input.sourceId,
      displayName:
        input.displayName.trim() || `${source.displayName} 账号`,
      authMode,
      usernameHint: input.username?.trim()
        ? maskUsername(input.username.trim())
        : null,
      status: initialStatus,
      scopes: ['search', 'download'],
    });

    if (input.password?.trim() || input.apiKey?.trim()) {
      const encrypted = safeStorage.encryptString(
        JSON.stringify({
          username: input.username?.trim() ?? '',
          password: input.password ?? '',
          apiKey: input.apiKey?.trim() ?? '',
        }),
      );
      this.database.saveAccessSecret(profileId, encrypted.toString('base64'));
    }
    return this.database.getAccessProfile(profileId)!;
  }

  async openLoginWindow(profileId: string): Promise<{ opened: boolean }> {
    const profile = this.database.getAccessProfile(profileId);
    if (!profile) {
      throw new Error('Access profile was not found.');
    }
    const source = this.database.getSourceAccessInfo(profile.sourceId);
    if (!source) {
      throw new Error('Source was not found.');
    }

    const owner = this.getOwnerWindow();
    const loginWindow = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 760,
      minHeight: 560,
      parent: owner ?? undefined,
      modal: false,
      show: false,
      title: `登录 · ${source.displayName}`,
      backgroundColor: '#05070b',
      webPreferences: {
        partition: profile.sessionPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    loginWindow.once('ready-to-show', () => loginWindow.show());
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: loginWindow,
            webPreferences: {
              partition: profile.sessionPartition,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      return { action: 'deny' };
    });
    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) {
        event.preventDefault();
      }
    });
    loginWindow.once('closed', () => {
      this.database.updateAccessProfileStatus(
        profileId,
        'pending_verification',
      );
    });
    await loginWindow.loadURL(source.homepage);
    return { opened: true };
  }

  async checkSession(profileId: string): Promise<SessionCheckResult> {
    const profile = this.database.getAccessProfile(profileId);
    if (!profile) {
      throw new Error('Access profile was not found.');
    }
    if (
      (profile.authMode === 'api_key' || profile.authMode === 'password') &&
      profile.hasSecret
    ) {
      const status = profile.authMode === 'api_key' ? 'ready' : 'pending_verification';
      this.database.updateAccessProfileStatus(profileId, status, {
        verified: status === 'ready',
      });
      if (status === 'ready') {
        this.database.resolvePendingActionsForSource(profile.sourceId);
      }
      return {
        profile: this.database.getAccessProfile(profileId)!,
        cookiesFound: 0,
        message:
          status === 'ready'
            ? 'API 凭据已保存。'
            : '账号密码已保存；该站点仍需专用登录适配器完成验证。',
      };
    }

    const accountSession = session.fromPartition(profile.sessionPartition);
    const cookies = await accountSession.cookies.get({});
    const status = cookies.length > 0 ? 'ready' : 'expired';
    this.database.updateAccessProfileStatus(profileId, status, {
      verified: status === 'ready',
    });
    if (status === 'ready') {
      this.database.resolvePendingActionsForSource(profile.sourceId);
    }
    return {
      profile: this.database.getAccessProfile(profileId)!,
      cookiesFound: cookies.length,
      message:
        status === 'ready'
          ? '隔离浏览器的登录会话已保存。'
          : '没有检测到站点会话，请打开登录窗口重新登录。',
    };
  }

  async clearSession(profileId: string): Promise<void> {
    const profile = this.database.getAccessProfile(profileId);
    if (!profile) {
      throw new Error('Access profile was not found.');
    }
    await session
      .fromPartition(profile.sessionPartition)
      .clearStorageData();
    this.database.updateAccessProfileStatus(profileId, 'expired');
  }

  async deleteProfile(profileId: string): Promise<void> {
    const profile = this.database.getAccessProfile(profileId);
    if (!profile) {
      return;
    }
    await session
      .fromPartition(profile.sessionPartition)
      .clearStorageData()
      .catch(() => undefined);
    this.database.deleteAccessProfile(profileId);
  }

  createPending(input: {
    sourceId: string;
    kind: string;
    reason: string;
    profileId?: string | null;
  }): PendingAccessAction[] {
    if (!this.database.getSourceAccessInfo(input.sourceId)) {
      throw new Error('Source was not found.');
    }
    this.database.createPendingAccessAction({
      actionId: randomUUID(),
      sourceId: input.sourceId,
      profileId: input.profileId,
      kind: input.kind,
      reason: input.reason,
    });
    return this.getOverview().pendingActions;
  }

  resolvePending(actionId: string): void {
    this.database.resolvePendingAccessAction(actionId);
  }
}

function normalizeAuthMode(value: AccessAuthMode): AccessAuthMode {
  return ['browser_session', 'oauth2', 'api_key', 'password'].includes(value)
    ? value
    : 'browser_session';
}

function maskUsername(username: string): string {
  const emailAt = username.indexOf('@');
  if (emailAt > 0) {
    return `${username.slice(0, 1)}***${username.slice(emailAt)}`;
  }
  return `${username.slice(0, 2)}***`;
}
