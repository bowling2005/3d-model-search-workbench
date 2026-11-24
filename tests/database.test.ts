import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetDatabase } from '../core/database';

const appRoot = process.cwd();

describe('AssetDatabase source foundation', () => {
  let tempDir: string;
  let databasePath: string;
  let database: AssetDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'model-search-workbench-'));
    databasePath = join(tempDir, 'test.db');
    database = new AssetDatabase({
      databasePath,
      migrationsDir: join(appRoot, 'database', 'migrations'),
      registryPath: join(appRoot, 'sources.merged.json'),
    });
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('imports all merged sources and is idempotent', () => {
    expect(database.seedSources()).toBe(89);
    expect(database.seedSources()).toBe(89);

    const bootstrap = database.getBootstrapData();
    expect(bootstrap.stats.total).toBe(89);
    expect(bootstrap.stats.upstream).toBe(27);
    expect(bootstrap.stats.seedOnly).toBe(62);
    expect(new Set(bootstrap.sources.map((source) => source.sourceId)).size).toBe(89);
  });

  it('preserves merged provenance and search metadata', () => {
    database.seedSources();
    const sketchfab = database
      .listSources({ query: 'sketchfab', filter: 'all' })
      .find((source) => source.sourceId === 'sketchfab');

    expect(sketchfab).toBeDefined();
    expect(sketchfab?.upstreamSourceId).toBe('sketchfab');
    expect(sketchfab?.userCatalogRowIds).toContain('23');
    expect(sketchfab?.userMetadata?.recommended_use).toContain('最大模型库');
  });

  it('supports source filters and user-controlled enablement', () => {
    database.seedSources();
    const seed = database.listSources({ query: '', filter: 'seed' });
    expect(seed).toHaveLength(62);

    const updated = database.setSourceEnabled('kenney', false);
    expect(updated?.enabled).toBe(false);

    database.close();
    database = new AssetDatabase({
      databasePath,
      migrationsDir: join(appRoot, 'database', 'migrations'),
      registryPath: join(appRoot, 'sources.merged.json'),
    });
    database.seedSources();

    const reloaded = database
      .listSources({ query: 'kenney', filter: 'all' })
      .find((source) => source.sourceId === 'kenney');
    expect(reloaded?.enabled).toBe(false);
  });
});
