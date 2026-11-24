import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetDatabase } from '../database';
import type {
  BlenderInspectionReport,
  BlenderRunResult,
  DownloadedAssetRecord,
  PipelineSettings,
} from './types';

const BLENDER_SETTING = 'blender.path';
const UNITY_PROJECT_SETTING = 'unity.projectPath';
const BLENDER_TIMEOUT_MS = 5 * 60 * 1000;

export class BlenderPipeline {
  constructor(
    private readonly database: AssetDatabase,
    private readonly appRoot: string,
    private readonly dataRoot: string,
  ) {}

  async getSettings(): Promise<PipelineSettings> {
    const blenderPath = await this.resolveBlenderPath();
    const version = blenderPath ? await this.readBlenderVersion(blenderPath) : null;
    const unityPath = this.database.getSetting<string | null>(
      UNITY_PROJECT_SETTING,
      null,
    );
    const unityValid = Boolean(
      unityPath &&
        existsSync(join(unityPath, 'ProjectSettings', 'ProjectVersion.txt')),
    );
    return {
      blenderPath,
      blenderAvailable: Boolean(blenderPath && version),
      blenderVersion: version,
      unityProjectPath: unityPath,
      unityProjectValid: unityValid,
      unityPluginInstalled: Boolean(
        unityValid &&
          existsSync(
            join(unityPath!, 'Packages', 'com.modelsearch.importer', 'package.json'),
          ),
      ),
    };
  }

  async setBlenderPath(path: string): Promise<PipelineSettings> {
    const stats = await stat(path);
    if (!stats.isFile()) {
      throw new Error('The selected Blender path is not a file.');
    }
    const version = await this.readBlenderVersion(path);
    if (!version) {
      throw new Error('The selected file did not respond as a Blender executable.');
    }
    this.database.setSetting(BLENDER_SETTING, path);
    return this.getSettings();
  }

  setUnityProjectPath(path: string): PipelineSettings {
    if (!existsSync(join(path, 'ProjectSettings', 'ProjectVersion.txt'))) {
      throw new Error('The selected folder is not a Unity project.');
    }
    this.database.setSetting(UNITY_PROJECT_SETTING, path);
    const blenderPath = this.database.getSetting<string | null>(
      BLENDER_SETTING,
      null,
    );
    return {
      blenderPath,
      blenderAvailable: Boolean(blenderPath),
      blenderVersion: null,
      unityProjectPath: path,
      unityProjectValid: true,
      unityPluginInstalled: existsSync(
        join(path, 'Packages', 'com.modelsearch.importer', 'package.json'),
      ),
    };
  }

  async run(
    asset: DownloadedAssetRecord,
    mode: 'inspect' | 'process',
  ): Promise<BlenderRunResult> {
    const blenderPath = await this.resolveBlenderPath();
    if (!blenderPath) {
      throw new Error('Blender executable is not configured.');
    }
    const inputFile = asset.modelFiles.find((path) =>
      /\.(fbx|glb|gltf|obj|blend|usd|usda|usdc|usdz|dae|stl)$/i.test(path),
    );
    if (!inputFile) {
      throw new Error('No supported model file is available for this asset.');
    }

    const inspectionId = `${Date.now()}-${mode}`;
    const outputDir = join(
      asset.downloadDirectory,
      'artifacts',
      `${mode}-${inspectionId}`,
    );
    const jobDir = join(this.dataRoot, 'jobs', inspectionId);
    const jobPath = join(jobDir, 'job.json');
    const resultPath = join(outputDir, 'result.json');
    await mkdir(jobDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      jobPath,
      JSON.stringify(
        {
          mode,
          input_file: inputFile,
          output_dir: outputDir,
          result_path: resultPath,
        },
        null,
        2,
      ),
      'utf8',
    );

    const workerPath = join(this.appRoot, 'blender', 'worker.py');
    const execution = await runProcess(
      blenderPath,
      [
        '--background',
        '--factory-startup',
        '--disable-autoexec',
        '--python-exit-code',
        '1',
        '--python',
        workerPath,
        '--',
        jobPath,
      ],
      this.appRoot,
      BLENDER_TIMEOUT_MS,
    );
    let report: BlenderInspectionReport;
    try {
      report = JSON.parse(
        await readFile(resultPath, 'utf8'),
      ) as BlenderInspectionReport;
    } catch {
      const message = [
        `Blender exited with code ${execution.code ?? 'unknown'}.`,
        execution.stderr.slice(-2000),
      ]
        .filter(Boolean)
        .join('\n');
      this.database.saveInspection({
        inspectionId,
        assetId: asset.assetId,
        mode,
        status: 'failed',
        report: { error: message },
        logExcerpt: execution.stderr.slice(-5000),
      });
      throw new Error(message);
    }

    const outputModelPath =
      mode === 'process' && report.ok
        ? join(outputDir, 'processed.fbx')
        : null;
    const status = report.ok ? 'completed' : 'failed';
    this.database.saveInspection({
      inspectionId,
      assetId: asset.assetId,
      mode,
      status,
      blenderVersion: report.blenderVersion,
      report,
      processedDir: mode === 'process' ? outputDir : null,
      outputModelPath,
      logExcerpt: execution.stderr.slice(-5000),
    });
    this.database.setAssetTriangleCount(
      asset.assetId,
      report.ok ? report.triangles : null,
    );
    if (!report.ok) {
      throw new Error(report.error ?? 'Blender processing failed.');
    }
    return {
      inspectionId,
      report,
      processedDir: mode === 'process' ? outputDir : null,
      outputModelPath,
    };
  }

  private async resolveBlenderPath(): Promise<string | null> {
    const configured = this.database.getSetting<string | null>(
      BLENDER_SETTING,
      null,
    );
    if (configured && existsSync(configured)) {
      return configured;
    }
    const environmentPath = process.env.BLENDER_PATH;
    if (environmentPath && existsSync(environmentPath)) {
      return environmentPath;
    }

    const roots = [
      'C:\\Program Files\\Blender Foundation',
      'C:\\Program Files\\Blender Foundation\\Blender',
    ];
    for (const root of roots) {
      if (!existsSync(root)) {
        continue;
      }
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort((left, right) =>
        right.name.localeCompare(left.name, undefined, { numeric: true }),
      )) {
        const candidate = entry.isDirectory()
          ? join(root, entry.name, 'blender.exe')
          : join(root, entry.name);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  private async readBlenderVersion(path: string): Promise<string | null> {
    try {
      const result = await runProcess(path, ['--version'], this.appRoot, 10_000);
      if (result.code !== 0) {
        return null;
      }
      return result.stdout.split(/\r?\n/, 1)[0]?.trim() || null;
    } catch {
      return null;
    }
  }
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Process timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-100_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-100_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
