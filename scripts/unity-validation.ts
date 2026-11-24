import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssetDatabase } from '../core/database';
import { UnityPipeline } from '../core/pipeline/unity';

async function main(): Promise<void> {
  const appRoot = process.cwd();
  const projectPath = process.env.UNITY_PROJECT_PATH;
  if (!projectPath) {
    throw new Error(
      'Set UNITY_PROJECT_PATH to a disposable Unity project before running this validation.',
    );
  }
  const unityEditor =
    process.env.UNITY_EDITOR_PATH ??
    'C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.42f1c1\\Editor\\Unity.exe';
  if (!existsSync(unityEditor)) {
    throw new Error(`Unity editor was not found at ${unityEditor}`);
  }

  const database = new AssetDatabase({
    databasePath: join(appRoot, 'data', 'model-search.db'),
    migrationsDir: join(appRoot, 'database', 'migrations'),
    registryPath: join(appRoot, 'sources.merged.json'),
  });
  try {
    database.seedSources();
    const asset =
      database
        .getDownloadedAssets()
        .find((entry) => entry.latestInspection?.outputModelPath) ??
      database.getDownloadedAssets()[0];
    if (!asset) {
      throw new Error('No downloaded asset is available.');
    }

    const pipeline = new UnityPipeline(database, appRoot);
    await pipeline.setProjectPath(projectPath);
    await pipeline.installPlugin();
    const request = await pipeline.createImportRequest(asset);
    console.log(
      `Queued Unity import ${request.requestId} for ${asset.assetId}`,
    );

    const logPath = join(appRoot, 'data', 'island-unity-validation.log');
    const exitCode = await runUnity(unityEditor, [
      '-batchmode',
      '-nographics',
      '-quit',
      '-projectPath',
      projectPath,
      '-executeMethod',
      'ModelSearch.Editor.ModelSearchBatchValidator.Run',
      '-logFile',
      logPath,
    ]);
    if (exitCode !== 0) {
      const log = await readFile(logPath, 'utf8').catch(() => '');
      throw new Error(
        `Unity validation exited with code ${exitCode}.\n${log.slice(-6000)}`,
      );
    }

    const validationPath = join(
      projectPath,
      '.model-library',
      'outbox',
      'island-validation.json',
    );
    const validation = JSON.parse(await readFile(validationPath, 'utf8'));
    await pipeline.refreshImportStatus(request.requestId);
    const scenePath = join(projectPath, String(validation.scenePath));
    if (!existsSync(scenePath)) {
      throw new Error(`Unity reported a scene but it was not found: ${scenePath}`);
    }
    console.log(
      JSON.stringify(
        {
          request,
          validation,
          scenePath,
        },
        null,
        2,
      ),
    );
  } finally {
    database.close();
  }
}

function runUnity(executable: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Unity validation timed out after 8 minutes.'));
    }, 8 * 60 * 1000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
