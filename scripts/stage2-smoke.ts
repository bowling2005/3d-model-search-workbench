import { join } from 'node:path';
import { AssetDatabase } from '../core/database';
import { DiscoveryClient } from '../core/discovery/client';
import { AssetDownloadManager } from '../core/discovery/download';
import { DiscoverySidecar } from '../core/discovery/sidecar';

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const sidecar = new DiscoverySidecar({ appRoot });
  const database = new AssetDatabase({
    databasePath: join(appRoot, 'data', 'model-search.db'),
    migrationsDir: join(appRoot, 'database', 'migrations'),
    registryPath: join(appRoot, 'sources.merged.json'),
  });

  try {
    database.seedSources();
    await sidecar.ensureStarted();
    const client = new DiscoveryClient({ sidecar });
    const query = process.env.MODEL_SEARCH_SMOKE_QUERY ?? 'crate';

    let asset = (
      await client.searchProvider({
        query,
        providerId: 'kenney',
        freeOnly: true,
        directOnly: true,
        limit: 10,
        timeoutMs: 12_000,
      })
    ).results.find((result) => result.downloadable);

    if (!asset) {
      asset = (
        await client.searchProvider({
          query,
          providerId: 'threedassets',
          freeOnly: true,
          directOnly: true,
          limit: 10,
          timeoutMs: 12_000,
        })
      ).results.find((result) => result.downloadable);
    }

    if (!asset) {
      throw new Error(`No downloadable smoke-test asset found for "${query}".`);
    }

    const manager = new AssetDownloadManager(database, client, join(appRoot, 'data'));
    const result = await manager.download({ asset }, (event) => {
      if (event.type === 'progress') {
        process.stderr.write(
          `\r${event.assetId}: ${(event.receivedBytes / 1024 / 1024).toFixed(1)} MiB`,
        );
      }
    });
    process.stderr.write('\n');
    console.log(
      JSON.stringify(
        {
          asset: {
            id: asset.id,
            title: asset.title,
            provider: asset.provider,
          },
          download: result,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
    await sidecar.stop();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
