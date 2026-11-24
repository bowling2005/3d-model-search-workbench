import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { unzipSync } from 'fflate';
import type { AssetDatabase } from '../database';
import type { DiscoveryClient } from './client';
import type {
  DiscoveryAssetDetails,
  DiscoveryAssetFile,
  DownloadProgressEvent,
  DownloadRequest,
  DownloadResult,
} from './types';

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 10_000;

export class AssetDownloadManager {
  constructor(
    private readonly database: AssetDatabase,
    private readonly discovery: DiscoveryClient,
    private readonly storageRoot: string,
  ) {}

  async download(
    request: DownloadRequest,
    emit: (event: DownloadProgressEvent) => void,
  ): Promise<DownloadResult> {
    const sources = this.database.getEnabledUpstreamSources();
    const source = sources.find(
      (entry) => entry.upstreamSourceId === request.asset.provider,
    );
    if (!source) {
      throw new Error(`No enabled source is registered for ${request.asset.provider}.`);
    }

    const assetId = request.asset.id;
    const jobId = this.database.createDownloadJob(source.sourceId, assetId);
    const stagingRoot = join(this.storageRoot, 'staging', jobId);
    const payloadPath = join(stagingRoot, 'payload');
    this.database.updateDownloadJob(jobId, {
      status: 'downloading',
      assetId,
      stagingPath: stagingRoot,
    });
    emit({ type: 'started', jobId, assetId });

    try {
      const details = await this.discovery.getAsset(assetId);
      this.database.upsertDiscoveredAsset(details, source.sourceId);
      const response = await this.discovery.openDownload(assetId, {
        format: request.format,
        resolution: request.resolution,
        all: request.all,
      });
      if (!response.body) {
        throw new Error('Download response did not include a body.');
      }

      await mkdir(stagingRoot, { recursive: true });
      const totalHeader = Number(response.headers.get('content-length') ?? NaN);
      const totalBytes = Number.isFinite(totalHeader) ? totalHeader : undefined;
      let receivedBytes = 0;
      let lastEmit = 0;
      const handle = await (await import('node:fs/promises')).open(payloadPath, 'w');
      try {
        for await (const chunk of Readable.fromWeb(
          response.body as import('node:stream/web').ReadableStream<Uint8Array>,
        )) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += bytes.byteLength;
          if (receivedBytes > MAX_DOWNLOAD_BYTES) {
            throw new Error('Download exceeded the 512 MiB safety limit.');
          }
          await handle.write(bytes);
          const now = Date.now();
          if (now - lastEmit > 180) {
            emit({
              type: 'progress',
              jobId,
              assetId,
              receivedBytes,
              totalBytes,
            });
            lastEmit = now;
          }
        }
      } finally {
        await handle.close();
      }
      this.database.updateDownloadJob(jobId, {
        status: 'verifying',
        progress: 0.72,
      });

      const payloadHash = await hashFile(payloadPath);
      const versionDirectory = join(
        this.storageRoot,
        'library',
        safeSegment(source.sourceId),
        `${safeSegment(request.asset.nativeId)}-${payloadHash.slice(0, 12)}`,
      );
      const contentDirectory = join(versionDirectory, 'source');
      await mkdir(contentDirectory, { recursive: true });

      const payloadHeader = await readFile(payloadPath);
      const isZip =
        payloadHeader.length >= 4 &&
        payloadHeader[0] === 0x50 &&
        payloadHeader[1] === 0x4b &&
        [0x03, 0x05, 0x07].includes(payloadHeader[2] ?? -1);

      if (isZip) {
        this.database.updateDownloadJob(jobId, {
          status: 'extracting',
          progress: 0.8,
        });
        await extractZipSafely(payloadHeader, contentDirectory);
      } else {
        const filename = chooseFilename(
          details,
          response.headers.get('content-disposition'),
          response.url,
          request.format,
        );
        await copyFile(payloadPath, join(contentDirectory, filename));
      }

      const extractedFiles = await listFiles(contentDirectory);
      if (extractedFiles.length === 0) {
        throw new Error('The downloaded asset did not contain any files.');
      }

      const fileRecords = [];
      for (const absolutePath of extractedFiles) {
        const fileStats = await stat(absolutePath);
        const fileHash = await hashFile(absolutePath);
        const relativePath = toPortablePath(relative(contentDirectory, absolutePath));
        fileRecords.push({
          path: relativePath,
          sha256: fileHash,
          sizeBytes: fileStats.size,
          kind: classifyFile(relativePath),
        });
        this.database.addAssetFile({
          assetId,
          relativePath,
          sha256: fileHash,
          sizeBytes: fileStats.size,
          fileKind: classifyFile(relativePath),
        });
      }

      const manifest = {
        schema_version: '1.0',
        downloaded_at: new Date().toISOString(),
        source_id: source.sourceId,
        asset: details,
        requested: {
          format: request.format ?? null,
          resolution: request.resolution ?? null,
          all: request.all ?? false,
        },
        payload_sha256: payloadHash,
        files: fileRecords,
      };
      await writeFile(
        join(versionDirectory, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      await writeFile(
        join(versionDirectory, 'license.json'),
        JSON.stringify(
          {
            license: details.license ?? null,
            source_url: details.url,
            title: details.title,
            author: details.author ?? null,
            captured_at: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );

      const directoryBytes = fileRecords.reduce(
        (total, file) => total + file.sizeBytes,
        0,
      );
      this.database.updateDownloadJob(jobId, {
        status: 'completed',
        progress: 1,
        downloadDir: versionDirectory,
        completed: true,
      });
      await rm(stagingRoot, { recursive: true, force: true });
      emit({
        type: 'completed',
        jobId,
        assetId,
        directory: versionDirectory,
        files: fileRecords.map((file) => file.path),
        bytes: directoryBytes,
      });
      return {
        jobId,
        assetId,
        directory: versionDirectory,
        files: fileRecords.map((file) => file.path),
        bytes: directoryBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.database.updateDownloadJob(jobId, {
        status: 'failed',
        errorCode: message.slice(0, 500),
      });
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      emit({ type: 'failed', jobId, assetId, error: message });
      throw error;
    }
  }
}

export function safeArchivePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
  return normalized;
}

async function extractZipSafely(
  archive: Uint8Array,
  destination: string,
): Promise<void> {
  const entries = unzipSync(archive);
  const names = Object.keys(entries);
  if (names.length > MAX_EXTRACTED_FILES) {
    throw new Error(`Archive has too many files (${names.length}).`);
  }

  let totalBytes = 0;
  for (const name of names) {
    const safePath = safeArchivePath(name);
    if (!safePath) {
      continue;
    }
    const bytes = entries[name] ?? new Uint8Array();
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error('Extracted archive exceeded the 1 GiB safety limit.');
    }
    const target = resolve(destination, safePath);
    if (!isWithin(destination, target)) {
      throw new Error(`Archive entry escaped the output directory: ${name}`);
    }
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, bytes);
  }
}

function chooseFilename(
  details: DiscoveryAssetDetails,
  disposition: string | null,
  responseUrl: string,
  requestedFormat?: string,
): string {
  const dispositionName = parseContentDisposition(disposition);
  if (dispositionName) {
    return safeFilename(dispositionName);
  }

  try {
    const urlName = basename(new URL(responseUrl).pathname);
    if (urlName && urlName !== '/') {
      return safeFilename(urlName);
    }
  } catch {
    // Fall through to the source metadata.
  }

  const candidate = details.files.find(
    (file) =>
      !file.requiresAuth &&
      (!requestedFormat || file.format === requestedFormat.toLowerCase()),
  );
  if (candidate?.filename) {
    return safeFilename(candidate.filename);
  }
  const format = candidate?.format ?? requestedFormat ?? 'bin';
  return `${safeFilename(details.nativeId)}.${format.replace(/[^a-z0-9]/gi, '')}`;
}

function parseContentDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = value.match(/filename="?([^";]+)"?/i)?.[1];
  const selected = encoded ?? plain;
  if (!selected) {
    return null;
  }
  try {
    return decodeURIComponent(selected);
  } catch {
    return selected;
  }
}

function safeFilename(value: string): string {
  const cleaned = basename(value.replaceAll('\\', '/'))
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  return cleaned || 'asset.bin';
}

function safeSegment(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'asset'
  );
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..')
  );
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        output.push(entryPath);
      }
    }
  }
  await visit(root);
  return output;
}

function toPortablePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function classifyFile(path: string): string {
  const extension = extname(path).slice(1).toLowerCase();
  if (['fbx', 'glb', 'gltf', 'obj', 'blend', 'usd', 'usdz', 'dae', '3ds'].includes(extension)) {
    return 'model';
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'tga', 'exr', 'hdr', 'tif', 'tiff'].includes(extension)) {
    return 'texture';
  }
  if (['mtl', 'bin', 'json'].includes(extension)) {
    return 'companion';
  }
  if (['zip', '7z', 'rar'].includes(extension)) {
    return 'archive';
  }
  return 'other';
}
