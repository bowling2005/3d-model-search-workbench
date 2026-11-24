import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetDatabase } from '../core/database';

const appRoot = process.cwd();

describe('Access profile persistence', () => {
  let tempDir: string;
  let database: AssetDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'model-search-access-'));
    database = new AssetDatabase({
      databasePath: join(tempDir, 'test.db'),
      migrationsDir: join(appRoot, 'database', 'migrations'),
      registryPath: join(appRoot, 'sources.merged.json'),
    });
    database.seedSources();
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates isolated profiles and completes source pending actions', () => {
    database.createPendingAccessAction({
      actionId: 'action-1',
      sourceId: 'sketchfab',
      kind: 'verify_access',
      reason: 'Download requires login.',
    });
    expect(database.getAccessOverview().pendingActions).toHaveLength(1);

    const profile = database.createAccessProfile({
      profileId: 'profile-1',
      sourceId: 'sketchfab',
      displayName: 'Sketchfab 主账号',
      authMode: 'browser_session',
      usernameHint: 'u***@example.com',
      status: 'awaiting_login',
      scopes: ['search', 'download'],
    });
    expect(profile.sessionPartition).toContain('model-search-account');

    database.saveAccessSecret('profile-1', 'encrypted-placeholder');
    database.updateAccessProfileStatus('profile-1', 'ready', {
      verified: true,
    });
    database.resolvePendingActionsForSource('sketchfab');

    const updated = database.getAccessProfile('profile-1');
    expect(updated?.status).toBe('ready');
    expect(updated?.hasSecret).toBe(true);
    expect(database.getAccessSecret('profile-1')).toBe(
      'encrypted-placeholder',
    );
    expect(database.getAccessOverview().pendingActions).toHaveLength(0);
  });
});
