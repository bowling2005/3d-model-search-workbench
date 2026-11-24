import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetDatabase } from '../core/database';
import type { DiscoveryClient } from '../core/discovery/client';
import { safeArchivePath } from '../core/discovery/download';
import { ModelSearchCoordinator } from '../core/discovery/search';
import type {
  DiscoveryAsset,
  ModelSearchEvent,
} from '../core/discovery/types';

const appRoot = process.cwd();

const fixtures: Record<string, DiscoveryAsset> = {
  kenney: {
    id: 'kenney:wooden-crate',
    provider: 'kenney',
    nativeId: 'wooden-crate',
    title: 'Wooden Crate',
    type: 'model',
    tags: ['crate', 'wood'],
    categories: ['props'],
    url: 'https://kenney.nl/assets/wooden-crate',
    thumbnailUrl: 'https://example.com/crate.webp',
    author: 'Kenney',
    license: {
      name: 'CC0',
      commercialUse: true,
      attributionRequired: false,
    },
    price: { free: true },
    formats: ['fbx', 'glb'],
    polyCount: 900,
    downloadable: true,
    score: 0.94,
  },
  polyhaven: {
    id: 'polyhaven:wooden_crate_01',
    provider: 'polyhaven',
    nativeId: 'wooden_crate_01',
    title: 'Wooden Crate 01',
    type: 'model',
    tags: ['crate', 'wood', 'pbr'],
    categories: ['prop'],
    url: 'https://polyhaven.com/a/wooden_crate_01',
    author: 'Poly Haven',
    license: {
      name: 'CC0',
      commercialUse: true,
      attributionRequired: false,
    },
    price: { free: true },
    formats: ['fbx', 'glb'],
    polyCount: 3200,
    downloadable: true,
    score: 0.88,
  },
};

describe('Stage 2 discovery orchestration', () => {
  let tempDir: string;
  let database: AssetDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'model-search-discovery-'));
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

  it('runs enabled providers concurrently and caches returned assets', async () => {
    const upstreamSources = database.getEnabledUpstreamSources();
    for (const source of upstreamSources) {
      database.setSourceEnabled(source.sourceId, false);
    }
    database.setSourceEnabled('kenney', true);
    database.setSourceEnabled('polyhaven', true);

    const client = {
      listProviders: async () => [
        {
          id: 'kenney',
          name: 'Kenney',
          homepage: 'https://kenney.nl',
          description: '',
          assetTypes: ['model'],
          access: 'scrape',
          pricing: 'free',
          supportsDownload: true,
          enabled: true,
        },
        {
          id: 'polyhaven',
          name: 'Poly Haven',
          homepage: 'https://polyhaven.com',
          description: '',
          assetTypes: ['model'],
          access: 'api',
          pricing: 'free',
          supportsDownload: true,
          enabled: true,
        },
      ],
      searchProvider: async ({ providerId }: { providerId: string }) => ({
        query: 'crate',
        types: ['model'],
        results: [fixtures[providerId]!],
        providers: [
          {
            provider: providerId,
            name: providerId,
            status: 'ok',
            count: 1,
            tookMs: 5,
          },
        ],
      }),
    } as unknown as DiscoveryClient;

    const coordinator = new ModelSearchCoordinator(database, client);
    const events: ModelSearchEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('search timed out')), 5000);
      coordinator.start(
        {
          query: 'crate',
          freeOnly: true,
          directOnly: true,
          formats: [],
          maxTriangles: 5000,
        },
        (event) => {
          events.push(event);
          if (event.type === 'completed') {
            clearTimeout(timer);
            resolve();
          }
          if (event.type === 'failed') {
            clearTimeout(timer);
            reject(new Error(event.error));
          }
        },
      );
    });

    const resultEvents = events.filter(
      (event) => event.type === 'source-results',
    );
    expect(resultEvents).toHaveLength(2);
    expect(database.countAssets()).toBe(2);
    expect(database.searchCachedAssets('crate')).toHaveLength(2);
    expect(
      database.searchCachedAssets('crate', { formats: ['fbx'] }),
    ).toHaveLength(2);
    expect(
      database.searchCachedAssets('crate', { maxTriangles: 1000 }),
    ).toHaveLength(1);
  });

  it('rejects unsafe archive paths', () => {
    expect(safeArchivePath('model/textures/base.png')).toBe(
      'model/textures/base.png',
    );
    expect(() => safeArchivePath('../escape.glb')).toThrow(
      'Unsafe archive path',
    );
    expect(() => safeArchivePath('C:\\Windows\\evil.dll')).toThrow(
      'Unsafe archive path',
    );
    expect(() => safeArchivePath('/absolute/file.glb')).toThrow(
      'Unsafe archive path',
    );
  });
});
