import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AssetDatabase } from '../core/database';

const appRoot = process.cwd();
const databasePath =
  process.env.MODEL_SEARCH_DB_PATH ?? join(appRoot, 'data', 'model-search.db');

mkdirSync(dirname(databasePath), { recursive: true });

const database = new AssetDatabase({
  databasePath,
  migrationsDir: join(appRoot, 'database', 'migrations'),
  registryPath: process.env.MODEL_SEARCH_REGISTRY_PATH ?? join(appRoot, 'sources.merged.json'),
});

try {
  const imported = database.seedSources();
  const bootstrap = database.getBootstrapData();
  console.log(
    JSON.stringify(
      {
        databasePath,
        imported,
        stats: bootstrap.stats,
        schemaVersion: bootstrap.schemaVersion,
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
