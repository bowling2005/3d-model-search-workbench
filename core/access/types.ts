export type AccessAuthMode =
  | 'browser_session'
  | 'oauth2'
  | 'api_key'
  | 'password';

export type AccessProfileStatus =
  | 'unconfigured'
  | 'awaiting_login'
  | 'pending_verification'
  | 'ready'
  | 'expired'
  | 'revoked'
  | 'error';

export interface AccessProfileRecord {
  profileId: string;
  sourceId: string;
  displayName: string;
  authMode: AccessAuthMode;
  usernameHint: string | null;
  scopes: string[];
  status: AccessProfileStatus;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  hasSecret: boolean;
  sessionPartition: string;
}

export interface AccessSourceRecord {
  sourceId: string;
  displayName: string;
  homepage: string;
  connectorStatus: string;
  profiles: AccessProfileRecord[];
}

export interface PendingAccessAction {
  actionId: string;
  sourceId: string;
  sourceName: string;
  profileId: string | null;
  kind: string;
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface AccessOverview {
  sources: AccessSourceRecord[];
  pendingActions: PendingAccessAction[];
  encryptionAvailable: boolean;
}

export interface CreateAccessProfileInput {
  sourceId: string;
  displayName: string;
  authMode: AccessAuthMode;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface SessionCheckResult {
  profile: AccessProfileRecord;
  cookiesFound: number;
  message: string;
}
