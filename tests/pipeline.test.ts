import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetDatabase } from '../core/database';
import { UnityPipeline } from '../core/pipeline/unity';
import type { DiscoveryAsset } from '../core/discovery/types';

const appRoot = process.cwd();

function fixtureAsset(): DiscoveryAsset {
  return {
    id: 'kenney:pipeline-test-crate',
    provider: 'kenney',
    nativeId: 'pipeline-test-crate',
    title: 'Pipeline Test Crate',
    type: 'model',
    tags: ['crate'],
    url: 'https://kenney.nl/assets/pipeline-test-crate',
    author: 'Kenney',
    license: {
      name: 'CC0',
      commercialUse: true,
      attributionRequired: false,
    },
    price: { free: true },
    formats: ['fbx'],
    polyCount: 100,
    downloadable: true,
  };
}

describe('Unity handoff pipeline', () => {
  let tempDir: string;
  let projectDir: string;
  let database: AssetDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'model-search-unity-'));
    projectDir = join(tempDir, 'UnityProject');
    mkdirSync(join(projectDir, 'ProjectSettings'), { recursive: true });
    mkdirSync(join(projectDir, 'Packages'), { recursive: true });
    writeFileSync(
      join(projectDir, 'ProjectSettings', 'ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.42f1\n',
    );
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

  it('installs the package, queues a request, and reads the Unity result', async () => {
    const asset = fixtureAsset();
    const downloadDir = join(tempDir, 'download');
    const sourceDir = join(downloadDir, 'source');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'model.fbx'), 'Kaydara FBX Binary');
    writeFileSync(
      join(downloadDir, 'license.json'),
      JSON.stringify({ license: 'CC0' }),
    );

    database.upsertDiscoveredAsset(asset, 'kenney');
    const jobId = database.createDownloadJob('kenney', asset.id);
    database.updateDownloadJob(jobId, {
      status: 'completed',
      assetId: asset.id,
      downloadDir,
      completed: true,
    });
    database.addAssetFile({
      assetId: asset.id,
      relativePath: 'model.fbx',
      sha256: 'abc',
      sizeBytes: 18,
      fileKind: 'model',
    });

    const pipeline = new UnityPipeline(database, appRoot);
    await pipeline.setProjectPath(projectDir);
    const installed = await pipeline.installPlugin();
    expect(installed.target).toContain('com.modelsearch.importer');

    const downloaded = database.getDownloadedAsset(asset.id);
    expect(downloaded).not.toBeNull();
    const request = await pipeline.createImportRequest(downloaded!);
    expect(request.status).toBe('queued');

    const outbox = join(projectDir, '.model-library', 'outbox');
    mkdirSync(outbox, { recursive: true });
    writeFileSync(
      join(outbox, `${request.requestId}.result.json`),
      JSON.stringify({
        requestId: request.requestId,
        assetId: asset.id,
        status: 'completed',
        importedPath: 'Assets/ModelLibrary/kenney/pipeline-test-crate/model.fbx',
      }),
    );

    const completed = await pipeline.refreshImportStatus(request.requestId);
    expect(completed?.status).toBe('completed');
    expect(completed?.result?.importedPath).toContain('Assets/ModelLibrary');
  });
});
