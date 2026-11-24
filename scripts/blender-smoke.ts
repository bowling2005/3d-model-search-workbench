import { join } from 'node:path';
import { AssetDatabase } from '../core/database';
import { BlenderPipeline } from '../core/pipeline/blender';

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const database = new AssetDatabase({
    databasePath: join(appRoot, 'data', 'model-search.db'),
    migrationsDir: join(appRoot, 'database', 'migrations'),
    registryPath: join(appRoot, 'sources.merged.json'),
  });
  try {
    database.seedSources();
    const asset = database.getDownloadedAssets()[0];
    if (!asset) {
      throw new Error('No downloaded asset is available for the Blender smoke test.');
    }
    const pipeline = new BlenderPipeline(
      database,
      appRoot,
      join(appRoot, 'data'),
    );
    const inspected = await pipeline.run(asset, 'inspect');
    const processed = await pipeline.run(asset, 'process');
    console.log(
      JSON.stringify(
        {
          asset: asset.assetId,
          inspected,
          processed,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
