import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AssetDatabase } from '../database';
import type {
  DownloadedAssetRecord,
  PipelineSettings,
  UnityImportRecord,
  UnityImportRequestResult,
} from './types';

const UNITY_PROJECT_SETTING = 'unity.projectPath';
const PACKAGE_NAME = 'com.modelsearch.importer';

export class UnityPipeline {
  constructor(
    private readonly database: AssetDatabase,
    private readonly appRoot: string,
  ) {}

  async setProjectPath(path: string): Promise<PipelineSettings> {
    const projectVersionPath = join(
      path,
      'ProjectSettings',
      'ProjectVersion.txt',
    );
    const projectVersion = await stat(projectVersionPath).catch(() => null);
    if (!projectVersion?.isFile()) {
      throw new Error('The selected folder is not a valid Unity project.');
    }
    this.database.setSetting(UNITY_PROJECT_SETTING, path);
    const blenderPath = this.database.getSetting<string | null>('blender.path', null);
    return {
      blenderPath,
      blenderAvailable: Boolean(blenderPath && existsSync(blenderPath)),
      blenderVersion: null,
      unityProjectPath: path,
      unityProjectValid: true,
      unityPluginInstalled: existsSync(
        join(path, 'Packages', PACKAGE_NAME, 'package.json'),
      ),
    };
  }

  getProjectPath(): string {
    const projectPath = this.database.getSetting<string | null>(
      UNITY_PROJECT_SETTING,
      null,
    );
    if (!projectPath) {
      throw new Error('Unity project is not configured.');
    }
    if (!existsSync(join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'))) {
      throw new Error('Configured Unity project no longer exists.');
    }
    return projectPath;
  }

  async installPlugin(): Promise<{ target: string }> {
    const projectPath = this.getProjectPath();
    const source = join(this.appRoot, 'unity', PACKAGE_NAME);
    if (!existsSync(join(source, 'package.json'))) {
      throw new Error('Bundled Unity importer package is missing.');
    }
    const target = join(projectPath, 'Packages', PACKAGE_NAME);
    await cp(source, target, { recursive: true, force: true });
    return { target };
  }

  async createImportRequest(
    asset: DownloadedAssetRecord,
  ): Promise<UnityImportRequestResult> {
    const projectPath = this.getProjectPath();
    if (!existsSync(join(projectPath, 'Packages', PACKAGE_NAME, 'package.json'))) {
      throw new Error('Install the Unity importer package first.');
    }

    const processedModel =
      asset.latestInspection?.outputModelPath &&
      existsSync(asset.latestInspection.outputModelPath)
        ? asset.latestInspection.outputModelPath
        : null;
    const preferredModel =
      processedModel ??
      asset.modelFiles.find((file) =>
        /\.(fbx|glb|gltf|obj)$/i.test(file),
      );
    if (!preferredModel) {
      throw new Error('No Unity-compatible model file is available.');
    }
    if (!processedModel && !/\.(fbx|obj)$/i.test(preferredModel)) {
      throw new Error(
        'Process this asset with Blender and export FBX before importing it into Unity.',
      );
    }

    const requestId = randomUUID();
    const request = {
      requestId,
      assetId: asset.assetId,
      sourceId: asset.sourceId,
      sourceDirectory: dirname(preferredModel),
      preferredModel,
      targetDirectory: `Assets/ModelLibrary/${sanitizeSegment(
        asset.sourceId,
      )}/${sanitizeSegment(asset.assetId)}`,
      sourceUrl: asset.sourceUrl,
      licensePath: existsSync(join(asset.downloadDirectory, 'license.json'))
        ? join(asset.downloadDirectory, 'license.json')
        : '',
      scale: 1,
    };
    const inbox = join(projectPath, '.model-library', 'inbox');
    await mkdir(inbox, { recursive: true });
    const inboxPath = join(inbox, `${requestId}.json`);
    await writeFile(inboxPath, JSON.stringify(request, null, 2), 'utf8');
    this.database.saveUnityImport({
      requestId,
      assetId: asset.assetId,
      projectPath,
      status: 'queued',
      request,
    });
    return {
      requestId,
      status: 'queued',
      inboxPath,
    };
  }

  async refreshImportStatus(
    requestId: string,
  ): Promise<UnityImportRecord | null> {
    const importJob = this.database.getUnityImport(requestId);
    if (!importJob) {
      return null;
    }
    const resultPath = join(
      importJob.projectPath,
      '.model-library',
      'outbox',
      `${requestId}.result.json`,
    );
    if (!existsSync(resultPath)) {
      return importJob;
    }
    try {
      const result = JSON.parse(await readFile(resultPath, 'utf8')) as Record<
        string,
        unknown
      >;
      const status =
        typeof result.status === 'string' ? result.status : 'completed';
      this.database.updateUnityImportResult(requestId, status, result);
    } catch (error) {
      this.database.updateUnityImportResult(requestId, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.database.getUnityImport(requestId);
  }
}

function sanitizeSegment(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'asset'
  );
}
