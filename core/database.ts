import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { DiscoveryAsset } from './discovery/types';
import type {
  DownloadedAssetRecord,
  InspectionRecord,
  UnityImportRecord,
} from './pipeline/types';
import type {
  AccessAuthMode,
  AccessOverview,
  AccessProfileRecord,
  AccessProfileStatus,
  AccessSourceRecord,
  PendingAccessAction,
} from './access/types';
import type {
  SourceCandidateRecord,
  SourceCandidateStatus,
  SourceProbeEvidence,
} from './discovery/source-types';
import { loadSourceRegistry } from './registry';
import type {
  BootstrapData,
  RegistrySource,
  SourceAccess,
  SourceAlias,
  SourceFilter,
  SourceRecord,
  SourceSearchInput,
  SourceStats,
  SourceUserMetadata,
  SeedEntry,
} from './types';

interface DatabaseOptions {
  databasePath: string;
  migrationsDir: string;
  registryPath: string;
}

interface SourceRow {
  source_id: string;
  display_name: string;
  homepage: string;
  domains_json: string;
  aliases_json: string;
  provenance_json: string;
  user_metadata_json: string | null;
  seed_entries_json: string;
  upstream_access: string | null;
  connector_status: string;
  enabled: number;
  upstream_source_id: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toSourceRecord(row: SourceRow): SourceRecord {
  const provenance = parseJson<{
    user_catalog_row_ids?: Array<string | number>;
    upstream_3d_asset_server?: { source_id?: string } | null;
  }>(row.provenance_json, {});

  return {
    sourceId: row.source_id,
    displayName: row.display_name,
    homepage: row.homepage,
    domains: parseJson<string[]>(row.domains_json, []),
    aliases: parseJson<SourceAlias[]>(row.aliases_json, []),
    userCatalogRowIds: (provenance.user_catalog_row_ids ?? []).map(String),
    upstreamSourceId:
      row.upstream_source_id ??
      provenance.upstream_3d_asset_server?.source_id ??
      null,
    userMetadata: parseJson<SourceUserMetadata | null>(row.user_metadata_json, null),
    seedEntries: parseJson<SeedEntry[]>(row.seed_entries_json, []),
    access: {
      upstream_mode: row.upstream_access,
      search: 'unverified',
      license_metadata: 'unverified',
      download: 'unverified',
      auth_required: 'unverified',
      entitlement_required: 'unverified',
      rate_limit: 'unverified',
      requires_live_probe: true,
    } satisfies SourceAccess,
    connectorStatus: row.connector_status,
    enabled: row.enabled === 1,
  };
}

export class AssetDatabase {
  private readonly db: DatabaseSync;

  constructor(private readonly options: DatabaseOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true });
    this.db = new DatabaseSync(options.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.applyMigrations();
  }

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = this.db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    const migrationFiles = readdirSync(this.options.migrationsDir)
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    for (const file of migrationFiles) {
      const version = Number(file.split('_', 1)[0]);
      if (applied.has(version)) {
        continue;
      }

      const sql = readFileSync(join(this.options.migrationsDir, file), 'utf8');
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
        this.db.exec('COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK;');
        throw new Error(`Failed to apply migration ${file}`, { cause: error });
      }
    }
  }

  seedSources(): number {
    const registry = loadSourceRegistry(this.options.registryPath);
    const upsert = this.db.prepare(`
      INSERT INTO sources (
        source_id,
        display_name,
        homepage,
        domains_json,
        aliases_json,
        provenance_json,
        user_metadata_json,
        seed_entries_json,
        upstream_source_id,
        upstream_access,
        connector_status,
        enabled,
        notes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        display_name = excluded.display_name,
        homepage = excluded.homepage,
        domains_json = excluded.domains_json,
        aliases_json = excluded.aliases_json,
        provenance_json = excluded.provenance_json,
        user_metadata_json = excluded.user_metadata_json,
        seed_entries_json = excluded.seed_entries_json,
        upstream_source_id = excluded.upstream_source_id,
        upstream_access = excluded.upstream_access,
        connector_status = excluded.connector_status,
        notes_json = excluded.notes_json,
        updated_at = CURRENT_TIMESTAMP
    `);
    const deleteSearch = this.db.prepare('DELETE FROM source_search WHERE source_id = ?');
    const insertSearch = this.db.prepare(`
      INSERT INTO source_search (source_id, display_name, domains, aliases)
      VALUES (?, ?, ?, ?)
    `);

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const source of registry.sources) {
        upsert.run(
          source.source_id,
          source.display_name,
          source.homepage,
          JSON.stringify(source.domains),
          JSON.stringify(source.aliases),
          JSON.stringify(source.provenance),
          source.user_metadata ? JSON.stringify(source.user_metadata) : null,
          JSON.stringify(source.seed_entries),
          source.provenance.upstream_3d_asset_server?.source_id ?? null,
          source.access.upstream_mode,
          source.connector_status,
          source.enabled ? 1 : 0,
          JSON.stringify(source.notes),
        );

        deleteSearch.run(source.source_id);
        insertSearch.run(
          source.source_id,
          source.display_name,
          source.domains.join(' '),
          [
            ...source.aliases.map((alias) => `${alias.name} ${alias.url}`),
            ...source.seed_entries.map((seed) => `${seed.name} ${seed.url}`),
          ].join(' '),
        );
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }

    return registry.sources.length;
  }

  getBootstrapData(): BootstrapData {
    const stats = this.getStats();
    const sources = this.listSources({ query: '', filter: 'all' });
    const schemaRow = this.db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null };

    return {
      stats,
      sources,
      databasePath: this.options.databasePath,
      registryPath: this.options.registryPath,
      schemaVersion: Number(schemaRow.version ?? 0),
    };
  }

  getStats(): SourceStats {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
          SUM(CASE WHEN connector_status LIKE 'upstream%' THEN 1 ELSE 0 END) AS upstream,
          SUM(CASE WHEN connector_status = 'seed_unverified' THEN 1 ELSE 0 END) AS seed_only
        FROM sources
      `)
      .get() as {
        total: number;
        enabled: number | null;
        upstream: number | null;
        seed_only: number | null;
      };

    return {
      total: Number(row.total),
      enabled: Number(row.enabled ?? 0),
      upstream: Number(row.upstream ?? 0),
      seedOnly: Number(row.seed_only ?? 0),
    };
  }

  listSources(input: SourceSearchInput): SourceRecord[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    const query = input.query.trim();

    if (query) {
      const escaped = query.replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escaped}%`;
      clauses.push(`
        (
          display_name LIKE ? ESCAPE '\\'
          OR homepage LIKE ? ESCAPE '\\'
          OR domains_json LIKE ? ESCAPE '\\'
          OR aliases_json LIKE ? ESCAPE '\\'
        )
      `);
      values.push(pattern, pattern, pattern, pattern);
    }

    const filterClause = this.filterClause(input.filter);
    if (filterClause) {
      clauses.push(filterClause);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`
        SELECT
          source_id,
          display_name,
          homepage,
          domains_json,
          aliases_json,
          provenance_json,
          user_metadata_json,
          seed_entries_json,
          upstream_access,
          connector_status,
          enabled,
          upstream_source_id
        FROM sources
        ${where}
        ORDER BY enabled DESC, display_name COLLATE NOCASE ASC
        LIMIT 250
      `)
      .all(...values) as unknown as SourceRow[];

    return rows.map(toSourceRecord);
  }

  setSourceEnabled(sourceId: string, enabled: boolean): SourceRecord | null {
    this.db
      .prepare(`
        UPDATE sources
        SET enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ?
      `)
      .run(enabled ? 1 : 0, sourceId);

    const row = this.db
      .prepare(`
        SELECT
          source_id,
          display_name,
          homepage,
          domains_json,
          aliases_json,
          provenance_json,
          user_metadata_json,
          seed_entries_json,
          upstream_access,
          connector_status,
          enabled,
          upstream_source_id
        FROM sources
        WHERE source_id = ?
      `)
      .get(sourceId) as unknown as SourceRow | undefined;

    return row ? toSourceRecord(row) : null;
  }

  getEnabledUpstreamSources(): SourceRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          source_id,
          display_name,
          homepage,
          domains_json,
          aliases_json,
          provenance_json,
          user_metadata_json,
          seed_entries_json,
          upstream_access,
          connector_status,
          enabled,
          upstream_source_id
        FROM sources
        WHERE enabled = 1 AND upstream_source_id IS NOT NULL
        ORDER BY display_name COLLATE NOCASE ASC
      `)
      .all() as unknown as SourceRow[];

    return rows.map(toSourceRecord);
  }

  upsertDiscoveredAsset(asset: DiscoveryAsset, sourceId: string): void {
    const licenseEvidenceId = createHash('sha256')
      .update(asset.id)
      .digest('hex');
    const now = new Date().toISOString();
    const metadata = JSON.stringify({
      description: asset.description ?? null,
      categories: asset.categories ?? [],
      resolutions: asset.resolutions ?? [],
      animated: asset.animated ?? false,
      rigged: asset.rigged ?? false,
      raw: asset,
    });

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(`
          INSERT INTO assets (
            asset_id,
            source_id,
            source_asset_id,
            title,
            author,
            source_url,
            thumbnail_url,
            asset_type,
            formats_json,
            style_tags_json,
            verified_triangle_count,
            metadata_json,
            license_name,
            license_url,
            license_commercial,
            license_attribution,
            downloadable,
            last_seen_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(asset_id) DO UPDATE SET
            source_id = excluded.source_id,
            source_asset_id = excluded.source_asset_id,
            title = excluded.title,
            author = excluded.author,
            source_url = excluded.source_url,
            thumbnail_url = excluded.thumbnail_url,
            asset_type = excluded.asset_type,
            formats_json = excluded.formats_json,
            style_tags_json = excluded.style_tags_json,
            verified_triangle_count = excluded.verified_triangle_count,
            metadata_json = excluded.metadata_json,
            license_name = excluded.license_name,
            license_url = excluded.license_url,
            license_commercial = excluded.license_commercial,
            license_attribution = excluded.license_attribution,
            downloadable = excluded.downloadable,
            last_seen_at = excluded.last_seen_at,
            updated_at = CURRENT_TIMESTAMP
        `)
        .run(
          asset.id,
          sourceId,
          asset.nativeId,
          asset.title,
          asset.author ?? null,
          asset.url,
          asset.thumbnailUrl ?? null,
          asset.type,
          JSON.stringify(asset.formats ?? []),
          JSON.stringify(asset.tags ?? []),
          asset.polyCount ?? null,
          metadata,
          asset.license?.name ?? null,
          asset.license?.url ?? null,
          asset.license?.commercialUse === undefined
            ? null
            : asset.license.commercialUse
              ? 1
              : 0,
          asset.license?.attributionRequired === undefined
            ? null
            : asset.license.attributionRequired
              ? 1
              : 0,
          asset.downloadable ? 1 : 0,
          now,
        );

      this.db
        .prepare(`
          INSERT INTO license_evidence (
            evidence_id,
            asset_id,
            license_id,
            license_url,
            commercial_allowed,
            attribution_required,
            captured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(evidence_id) DO UPDATE SET
            license_id = excluded.license_id,
            license_url = excluded.license_url,
            commercial_allowed = excluded.commercial_allowed,
            attribution_required = excluded.attribution_required,
            captured_at = excluded.captured_at
        `)
        .run(
          licenseEvidenceId,
          asset.id,
          asset.license?.name ?? null,
          asset.license?.url ?? null,
          asset.license?.commercialUse === undefined
            ? null
            : asset.license.commercialUse
              ? 1
              : 0,
          asset.license?.attributionRequired === undefined
            ? null
            : asset.license.attributionRequired
              ? 1
              : 0,
          now,
        );

      this.db
        .prepare('DELETE FROM asset_search WHERE asset_id = ?')
        .run(asset.id);
      this.db
        .prepare(`
          INSERT INTO asset_search (asset_id, title, author, tags, categories)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          asset.id,
          asset.title,
          asset.author ?? '',
          (asset.tags ?? []).join(' '),
          (asset.categories ?? []).join(' '),
        );
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  createDownloadJob(sourceId: string, sourceAssetId: string): string {
    const jobId = randomUUID();
    this.db
      .prepare(`
        INSERT INTO download_jobs (
          job_id,
          source_id,
          source_asset_id,
          status,
          progress,
          checkpoint_json
        ) VALUES (?, ?, ?, 'queued', 0, '{}')
      `)
      .run(jobId, sourceId, sourceAssetId);
    return jobId;
  }

  updateDownloadJob(
    jobId: string,
    values: {
      status: string;
      assetId?: string;
      progress?: number;
      stagingPath?: string;
      downloadDir?: string;
      errorCode?: string | null;
      completed?: boolean;
    },
  ): void {
    this.db
      .prepare(`
        UPDATE download_jobs SET
          status = ?,
          asset_id = COALESCE(?, asset_id),
          progress = COALESCE(?, progress),
          staging_path = COALESCE(?, staging_path),
          download_dir = COALESCE(?, download_dir),
          error_code = ?,
          completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ?
      `)
      .run(
        values.status,
        values.assetId ?? null,
        values.progress ?? null,
        values.stagingPath ?? null,
        values.downloadDir ?? null,
        values.errorCode ?? null,
        values.completed ? 1 : 0,
        jobId,
      );
  }

  addAssetFile(input: {
    assetId: string;
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    fileKind: string;
  }): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO asset_files (
          file_id,
          asset_id,
          relative_path,
          sha256,
          size_bytes,
          file_kind
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        `${input.assetId}:${input.relativePath}`,
        input.assetId,
        input.relativePath,
        input.sha256,
        input.sizeBytes,
        input.fileKind,
      );
  }

  countAssets(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM assets')
      .get() as { count: number };
    return Number(row.count);
  }

  searchCachedAssets(
    query: string,
    options: { formats?: string[]; maxTriangles?: number; limit?: number } = {},
  ): DiscoveryAsset[] {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 12);
    if (terms.length === 0) {
      return [];
    }
    const matchQuery = terms
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(' AND ');
    const rows = this.db
      .prepare(`
        SELECT a.metadata_json
        FROM asset_search
        JOIN assets a ON a.asset_id = asset_search.asset_id
        WHERE asset_search MATCH ?
          AND a.asset_type = 'model'
        ORDER BY rank
        LIMIT ?
      `)
      .all(matchQuery, Math.min(Math.max(options.limit ?? 120, 1), 250)) as Array<{
      metadata_json: string;
    }>;

    const formats = (options.formats ?? []).map((format) => format.toLowerCase());
    return rows
      .map((row) => parseJson<{ raw?: DiscoveryAsset }>(row.metadata_json, {}).raw)
      .filter((asset): asset is DiscoveryAsset => Boolean(asset))
      .filter(
        (asset) =>
          formats.length === 0 ||
          (asset.formats ?? []).some((format) =>
            formats.includes(format.toLowerCase()),
          ),
      )
      .filter(
        (asset) =>
          typeof options.maxTriangles !== 'number' ||
          typeof asset.polyCount !== 'number' ||
          asset.polyCount <= options.maxTriangles,
      );
  }

  getDownloadedAssets(): DownloadedAssetRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          a.asset_id,
          a.title,
          a.author,
          a.source_id,
          a.source_url,
          a.thumbnail_url,
          a.asset_type,
          a.formats_json,
          a.style_tags_json,
          a.verified_triangle_count,
          a.license_name,
          a.license_url,
          a.license_commercial,
          a.license_attribution,
          s.display_name AS source_name,
          (
            SELECT d.download_dir
            FROM download_jobs d
            WHERE d.asset_id = a.asset_id AND d.status = 'completed'
            ORDER BY d.completed_at DESC
            LIMIT 1
          ) AS download_dir
        FROM assets a
        JOIN sources s ON s.source_id = a.source_id
        WHERE EXISTS (
          SELECT 1 FROM asset_files f WHERE f.asset_id = a.asset_id
        )
        ORDER BY a.updated_at DESC
      `)
      .all() as Array<{
      asset_id: string;
      title: string;
      author: string | null;
      source_id: string;
      source_url: string;
      thumbnail_url: string | null;
      asset_type: string;
      formats_json: string;
      style_tags_json: string;
      verified_triangle_count: number | null;
      license_name: string | null;
      license_url: string | null;
      license_commercial: number | null;
      license_attribution: number | null;
      source_name: string;
      download_dir: string | null;
    }>;

    return rows.map((row) => {
      const downloadDirectory = row.download_dir ?? '';
      const sourceDirectory = downloadDirectory
        ? join(downloadDirectory, 'source')
        : '';
      const fileRows = this.db
        .prepare(`
          SELECT relative_path, sha256, size_bytes, file_kind
          FROM asset_files
          WHERE asset_id = ?
          ORDER BY relative_path
        `)
        .all(row.asset_id) as Array<{
        relative_path: string;
        sha256: string;
        size_bytes: number;
        file_kind: string;
      }>;
      const files = fileRows.map((file) => ({
        path: join(sourceDirectory, file.relative_path),
        relativePath: file.relative_path,
        sha256: file.sha256,
        sizeBytes: Number(file.size_bytes),
        kind: file.file_kind,
      }));
      const modelFiles = files
        .filter((file) => file.kind === 'model')
        .map((file) => file.path);
      const inspection = this.getLatestInspection(row.asset_id);
      const unityImport = this.getLatestUnityImport(row.asset_id);

      return {
        assetId: row.asset_id,
        title: row.title,
        author: row.author,
        sourceId: row.source_id,
        sourceName: row.source_name,
        sourceUrl: row.source_url,
        thumbnailUrl: row.thumbnail_url,
        assetType: row.asset_type,
        formats: parseJson<string[]>(row.formats_json, []),
        tags: parseJson<string[]>(row.style_tags_json, []),
        licenseName: row.license_name,
        licenseUrl: row.license_url,
        licenseCommercial:
          row.license_commercial === null ? null : row.license_commercial === 1,
        licenseAttribution:
          row.license_attribution === null ? null : row.license_attribution === 1,
        knownTriangleCount: row.verified_triangle_count,
        downloadDirectory,
        sourceDirectory,
        modelFiles,
        files,
        latestInspection: inspection,
        latestUnityImport: unityImport,
      } satisfies DownloadedAssetRecord;
    });
  }

  getDownloadedAsset(assetId: string): DownloadedAssetRecord | null {
    return this.getDownloadedAssets().find((asset) => asset.assetId === assetId) ?? null;
  }

  saveInspection(input: {
    inspectionId: string;
    assetId: string;
    mode: string;
    status: string;
    blenderVersion?: string | null;
    report: unknown;
    processedDir?: string | null;
    outputModelPath?: string | null;
    logExcerpt?: string | null;
  }): void {
    this.db
      .prepare(`
        INSERT INTO asset_inspections (
          inspection_id,
          asset_id,
          mode,
          status,
          blender_version,
          report_json,
          processed_dir,
          output_model_path,
          log_excerpt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(inspection_id) DO UPDATE SET
          status = excluded.status,
          blender_version = excluded.blender_version,
          report_json = excluded.report_json,
          processed_dir = excluded.processed_dir,
          output_model_path = excluded.output_model_path,
          log_excerpt = excluded.log_excerpt
      `)
      .run(
        input.inspectionId,
        input.assetId,
        input.mode,
        input.status,
        input.blenderVersion ?? null,
        JSON.stringify(input.report),
        input.processedDir ?? null,
        input.outputModelPath ?? null,
        input.logExcerpt ?? null,
      );
  }

  setAssetTriangleCount(assetId: string, triangles: number | null): void {
    this.db
      .prepare(`
        UPDATE assets
        SET verified_triangle_count = ?, updated_at = CURRENT_TIMESTAMP
        WHERE asset_id = ?
      `)
      .run(triangles, assetId);
  }

  getLatestInspection(assetId: string): InspectionRecord | null {
    const row = this.db
      .prepare(`
        SELECT *
        FROM asset_inspections
        WHERE asset_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(assetId) as
      | {
          inspection_id: string;
          mode: string;
          status: string;
          blender_version: string | null;
          report_json: string;
          processed_dir: string | null;
          output_model_path: string | null;
          log_excerpt: string | null;
          created_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      inspectionId: row.inspection_id,
      mode: row.mode === 'process' ? 'process' : 'inspect',
      status: row.status,
      blenderVersion: row.blender_version,
      report: parseJson(row.report_json, null),
      processedDir: row.processed_dir,
      outputModelPath: row.output_model_path,
      logExcerpt: row.log_excerpt,
      createdAt: row.created_at,
    };
  }

  saveUnityImport(input: {
    requestId: string;
    assetId: string;
    projectPath: string;
    status: string;
    request: unknown;
  }): void {
    this.db
      .prepare(`
        INSERT INTO unity_import_jobs (
          request_id,
          asset_id,
          project_path,
          status,
          request_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(request_id) DO UPDATE SET
          status = excluded.status,
          request_json = excluded.request_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.requestId,
        input.assetId,
        input.projectPath,
        input.status,
        JSON.stringify(input.request),
      );
  }

  updateUnityImportResult(
    requestId: string,
    status: string,
    result: unknown,
  ): void {
    this.db
      .prepare(`
        UPDATE unity_import_jobs
        SET status = ?, result_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = ?
      `)
      .run(status, JSON.stringify(result), requestId);
  }

  getUnityImport(requestId: string): UnityImportRecord | null {
    const row = this.db
      .prepare(`
        SELECT *
        FROM unity_import_jobs
        WHERE request_id = ?
      `)
      .get(requestId) as
      | {
          request_id: string;
          status: string;
          project_path: string;
          result_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      requestId: row.request_id,
      status: row.status,
      projectPath: row.project_path,
      result: parseJson<Record<string, unknown> | null>(row.result_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getLatestUnityImport(assetId: string): UnityImportRecord | null {
    const row = this.db
      .prepare(`
        SELECT *
        FROM unity_import_jobs
        WHERE asset_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(assetId) as
      | {
          request_id: string;
          status: string;
          project_path: string;
          result_json: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      requestId: row.request_id,
      status: row.status,
      projectPath: row.project_path,
      result: parseJson<Record<string, unknown> | null>(row.result_json, null),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(`
        INSERT INTO app_settings (key, value_json)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(key, JSON.stringify(value));
  }

  getAccessOverview(): Omit<AccessOverview, 'encryptionAvailable'> {
    const sourceRows = this.db
      .prepare(`
        SELECT source_id, display_name, homepage, connector_status
        FROM sources
        WHERE enabled = 1 AND upstream_source_id IS NOT NULL
        ORDER BY display_name COLLATE NOCASE ASC
      `)
      .all() as Array<{
      source_id: string;
      display_name: string;
      homepage: string;
      connector_status: string;
    }>;
    const sources: AccessSourceRecord[] = sourceRows.map((source) => ({
      sourceId: source.source_id,
      displayName: source.display_name,
      homepage: source.homepage,
      connectorStatus: source.connector_status,
      profiles: this.listAccessProfiles(source.source_id),
    }));
    const pendingRows = this.db
      .prepare(`
        SELECT
          p.action_id,
          p.source_id,
          s.display_name AS source_name,
          p.profile_id,
          p.kind,
          p.status,
          p.reason,
          p.created_at
        FROM pending_actions p
        JOIN sources s ON s.source_id = p.source_id
        WHERE p.status = 'pending'
        ORDER BY p.created_at DESC
      `)
      .all() as Array<{
      action_id: string;
      source_id: string;
      source_name: string;
      profile_id: string | null;
      kind: string;
      status: string;
      reason: string | null;
      created_at: string;
    }>;
    const pendingActions: PendingAccessAction[] = pendingRows.map((row) => ({
      actionId: row.action_id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      profileId: row.profile_id,
      kind: row.kind,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
    }));
    return { sources, pendingActions };
  }

  listAccessProfiles(sourceId: string): AccessProfileRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          p.profile_id,
          p.source_id,
          p.display_name,
          p.auth_mode,
          p.username_hint,
          p.scopes_json,
          p.status,
          p.last_verified_at,
          p.expires_at,
          CASE WHEN s.profile_id IS NULL THEN 0 ELSE 1 END AS has_secret
        FROM access_profiles p
        LEFT JOIN access_secrets s ON s.profile_id = p.profile_id
        WHERE p.source_id = ?
        ORDER BY p.created_at ASC
      `)
      .all(sourceId) as Array<{
      profile_id: string;
      source_id: string;
      display_name: string;
      auth_mode: string;
      username_hint: string | null;
      scopes_json: string;
      status: string;
      last_verified_at: string | null;
      expires_at: string | null;
      has_secret: number;
    }>;
    return rows.map((row) => ({
      profileId: row.profile_id,
      sourceId: row.source_id,
      displayName: row.display_name,
      authMode: normalizeAuthMode(row.auth_mode),
      usernameHint: row.username_hint,
      scopes: parseJson<string[]>(row.scopes_json, []),
      status: normalizeProfileStatus(row.status),
      lastVerifiedAt: row.last_verified_at,
      expiresAt: row.expires_at,
      hasSecret: row.has_secret === 1,
      sessionPartition: sessionPartition(row.source_id, row.profile_id),
    }));
  }

  getAccessProfile(profileId: string): AccessProfileRecord | null {
    const row = this.db
      .prepare('SELECT source_id FROM access_profiles WHERE profile_id = ?')
      .get(profileId) as { source_id: string } | undefined;
    return row
      ? this.listAccessProfiles(row.source_id).find(
          (profile) => profile.profileId === profileId,
        ) ?? null
      : null;
  }

  getSourceAccessInfo(sourceId: string): {
    sourceId: string;
    displayName: string;
    homepage: string;
  } | null {
    const row = this.db
      .prepare(`
        SELECT source_id, display_name, homepage
        FROM sources
        WHERE source_id = ?
      `)
      .get(sourceId) as
      | { source_id: string; display_name: string; homepage: string }
      | undefined;
    return row
      ? {
          sourceId: row.source_id,
          displayName: row.display_name,
          homepage: row.homepage,
        }
      : null;
  }

  createAccessProfile(input: {
    profileId: string;
    sourceId: string;
    displayName: string;
    authMode: AccessAuthMode;
    usernameHint: string | null;
    status: AccessProfileStatus;
    scopes?: string[];
  }): AccessProfileRecord {
    this.db
      .prepare(`
        INSERT INTO access_profiles (
          profile_id,
          source_id,
          display_name,
          auth_mode,
          username_hint,
          credential_ref,
          scopes_json,
          status,
          last_verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        input.profileId,
        input.sourceId,
        input.displayName,
        input.authMode,
        input.usernameHint,
        `safeStorage://access/${input.profileId}`,
        JSON.stringify(input.scopes ?? []),
        input.status,
      );
    return this.getAccessProfile(input.profileId)!;
  }

  saveAccessSecret(profileId: string, ciphertext: string): void {
    this.db
      .prepare(`
        INSERT INTO access_secrets (profile_id, ciphertext, encoding)
        VALUES (?, ?, 'base64')
        ON CONFLICT(profile_id) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          encoding = excluded.encoding,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(profileId, ciphertext);
  }

  getAccessSecret(profileId: string): string | null {
    const row = this.db
      .prepare('SELECT ciphertext FROM access_secrets WHERE profile_id = ?')
      .get(profileId) as { ciphertext: string } | undefined;
    return row?.ciphertext ?? null;
  }

  updateAccessProfileStatus(
    profileId: string,
    status: AccessProfileStatus,
    values: { verified?: boolean; expiresAt?: string | null } = {},
  ): void {
    this.db
      .prepare(`
        UPDATE access_profiles
        SET
          status = ?,
          last_verified_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE last_verified_at END,
          last_checked_at = CURRENT_TIMESTAMP,
          expires_at = COALESCE(?, expires_at),
          updated_at = CURRENT_TIMESTAMP
        WHERE profile_id = ?
      `)
      .run(
        status,
        values.verified ? 1 : 0,
        values.expiresAt ?? null,
        profileId,
      );
  }

  deleteAccessProfile(profileId: string): void {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare('DELETE FROM access_secrets WHERE profile_id = ?')
        .run(profileId);
      this.db
        .prepare('DELETE FROM pending_actions WHERE profile_id = ?')
        .run(profileId);
      this.db
        .prepare('DELETE FROM access_profiles WHERE profile_id = ?')
        .run(profileId);
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  createPendingAccessAction(input: {
    actionId: string;
    sourceId: string;
    profileId?: string | null;
    kind: string;
    reason: string;
  }): void {
    const existing = this.db
      .prepare(`
        SELECT action_id
        FROM pending_actions
        WHERE source_id = ? AND kind = ? AND status = 'pending'
        LIMIT 1
      `)
      .get(input.sourceId, input.kind) as { action_id: string } | undefined;
    if (existing) {
      this.db
        .prepare(`
          UPDATE pending_actions
          SET reason = ?, updated_at = CURRENT_TIMESTAMP
          WHERE action_id = ?
        `)
        .run(input.reason, existing.action_id);
      return;
    }
    this.db
      .prepare(`
        INSERT INTO pending_actions (
          action_id,
          source_id,
          profile_id,
          kind,
          status,
          reason,
          checkpoint_json
        ) VALUES (?, ?, ?, ?, 'pending', ?, '{}')
      `)
      .run(
        input.actionId,
        input.sourceId,
        input.profileId ?? null,
        input.kind,
        input.reason,
      );
  }

  resolvePendingActionsForSource(sourceId: string): void {
    this.db
      .prepare(`
        UPDATE pending_actions
        SET status = 'completed', updated_at = CURRENT_TIMESTAMP
        WHERE source_id = ? AND status = 'pending'
      `)
      .run(sourceId);
  }

  resolvePendingAccessAction(actionId: string): void {
    this.db
      .prepare(`
        UPDATE pending_actions
        SET status = 'completed', updated_at = CURRENT_TIMESTAMP
        WHERE action_id = ?
      `)
      .run(actionId);
  }

  listSourceCandidates(): SourceCandidateRecord[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM source_candidates
        ORDER BY
          CASE status
            WHEN 'ready_for_review' THEN 0
            WHEN 'access_required' THEN 1
            WHEN 'candidate' THEN 2
            WHEN 'quarantined' THEN 3
            ELSE 4
          END,
          score DESC,
          created_at DESC
        LIMIT 250
      `)
      .all() as Array<{
      candidate_id: string;
      domain: string;
      homepage: string;
      display_name: string;
      discovered_from: string;
      discovery_kind: string;
      status: string;
      score: number;
      probe_json: string;
      license_summary: string | null;
      formats_json: string;
      access_mode: string | null;
      last_probe_at: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      candidateId: row.candidate_id,
      domain: row.domain,
      homepage: row.homepage,
      displayName: row.display_name,
      discoveredFrom: row.discovered_from,
      discoveryKind: row.discovery_kind,
      status: normalizeCandidateStatus(row.status),
      score: Number(row.score),
      probe: parseJson<SourceProbeEvidence | null>(row.probe_json, null),
      licenseSummary: row.license_summary,
      formats: parseJson<string[]>(row.formats_json, []),
      accessMode: row.access_mode,
      lastProbeAt: row.last_probe_at,
      createdAt: row.created_at,
    }));
  }

  saveSourceCandidate(input: {
    candidateId: string;
    domain: string;
    homepage: string;
    displayName: string;
    discoveredFrom: string;
    discoveryKind: string;
    status: SourceCandidateStatus;
    score: number;
    probe: SourceProbeEvidence;
    licenseSummary: string | null;
    formats: string[];
    accessMode: string | null;
  }): SourceCandidateRecord {
    this.db
      .prepare(`
        INSERT INTO source_candidates (
          candidate_id,
          domain,
          homepage,
          display_name,
          discovered_from,
          discovery_kind,
          status,
          score,
          probe_json,
          license_summary,
          formats_json,
          access_mode,
          last_probe_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(domain) DO UPDATE SET
          homepage = excluded.homepage,
          display_name = excluded.display_name,
          discovered_from = excluded.discovered_from,
          discovery_kind = excluded.discovery_kind,
          status = excluded.status,
          score = excluded.score,
          probe_json = excluded.probe_json,
          license_summary = excluded.license_summary,
          formats_json = excluded.formats_json,
          access_mode = excluded.access_mode,
          last_probe_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.candidateId,
        input.domain,
        input.homepage,
        input.displayName,
        input.discoveredFrom,
        input.discoveryKind,
        input.status,
        input.score,
        JSON.stringify(input.probe),
        input.licenseSummary,
        JSON.stringify(input.formats),
        input.accessMode,
      );
    return this.listSourceCandidates().find(
      (candidate) => candidate.domain === input.domain,
    )!;
  }

  updateSourceCandidateStatus(
    candidateId: string,
    status: SourceCandidateStatus,
  ): void {
    this.db
      .prepare(`
        UPDATE source_candidates
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE candidate_id = ?
      `)
      .run(status, candidateId);
  }

  isKnownSourceDomain(domain: string): boolean {
    const normalized = domain.toLowerCase().replace(/^www\./, '');
    const rows = this.db
      .prepare('SELECT domains_json FROM sources')
      .all() as Array<{ domains_json: string }>;
    return rows.some((row) =>
      parseJson<string[]>(row.domains_json, []).some(
        (known) => known.toLowerCase().replace(/^www\./, '') === normalized,
      ),
    );
  }

  approveSourceCandidate(candidateId: string): string {
    const candidate = this.listSourceCandidates().find(
      (entry) => entry.candidateId === candidateId,
    );
    if (!candidate) {
      throw new Error('Source candidate was not found.');
    }
    const sourceId = sanitizeSourceId(candidate.domain);
    if (this.db.prepare('SELECT 1 FROM sources WHERE source_id = ?').get(sourceId)) {
      throw new Error(`A source with id "${sourceId}" already exists.`);
    }
    const provenance = {
      upstream_3d_asset_server: null,
      user_catalog_row_ids: [],
      discovered_candidate: {
        candidate_id: candidate.candidateId,
        discovered_from: candidate.discoveredFrom,
        discovery_kind: candidate.discoveryKind,
        probe_score: candidate.score,
      },
    };
    const userMetadata = {
      region_language: '',
      license_summary: candidate.licenseSummary ?? '待确认',
      formats: candidate.formats.join('、'),
      recommended_use: '自动发现候选来源，待完成站点适配',
      notes: candidate.probe?.warnings.join('；') ?? '',
    };
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(`
          INSERT INTO sources (
            source_id,
            display_name,
            homepage,
            domains_json,
            aliases_json,
            provenance_json,
            user_metadata_json,
            seed_entries_json,
            upstream_source_id,
            upstream_access,
            connector_status,
            enabled,
            notes_json
          ) VALUES (?, ?, ?, ?, '[]', ?, ?, '[]', NULL, NULL, 'candidate_approved', 0, '[]')
        `)
        .run(
          sourceId,
          candidate.displayName,
          candidate.homepage,
          JSON.stringify([candidate.domain]),
          JSON.stringify(provenance),
          JSON.stringify(userMetadata),
        );
      this.db
        .prepare('DELETE FROM source_search WHERE source_id = ?')
        .run(sourceId);
      this.db
        .prepare(`
          INSERT INTO source_search (source_id, display_name, domains, aliases)
          VALUES (?, ?, ?, '')
        `)
        .run(sourceId, candidate.displayName, candidate.domain);
      this.db
        .prepare(`
          UPDATE source_candidates
          SET status = 'approved', updated_at = CURRENT_TIMESTAMP
          WHERE candidate_id = ?
        `)
        .run(candidateId);
      this.db.exec('COMMIT;');
      return sourceId;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private filterClause(filter: SourceFilter): string {
    switch (filter) {
      case 'enabled':
        return 'enabled = 1';
      case 'upstream':
        return "connector_status LIKE 'upstream%'";
      case 'seed':
        return "connector_status = 'seed_unverified'";
      case 'all':
      default:
        return '';
    }
  }
}

function normalizeAuthMode(value: string): AccessAuthMode {
  return value === 'oauth2' ||
    value === 'api_key' ||
    value === 'password' ||
    value === 'browser_session'
    ? value
    : 'browser_session';
}

function normalizeProfileStatus(value: string): AccessProfileStatus {
  return value === 'awaiting_login' ||
    value === 'pending_verification' ||
    value === 'ready' ||
    value === 'expired' ||
    value === 'revoked' ||
    value === 'error' ||
    value === 'unconfigured'
    ? value
    : 'unconfigured';
}

export function sessionPartition(sourceId: string, profileId: string): string {
  const safe = `${sourceId}-${profileId}`.replace(/[^a-zA-Z0-9-]/g, '-');
  return `persist:model-search-account-${safe}`;
}

function normalizeCandidateStatus(value: string): SourceCandidateStatus {
  return value === 'probing' ||
    value === 'ready_for_review' ||
    value === 'access_required' ||
    value === 'duplicate' ||
    value === 'quarantined' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'error' ||
    value === 'candidate'
    ? value
    : 'candidate';
}

function sanitizeSourceId(domain: string): string {
  return (
    domain
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'discovered-source'
  );
}
