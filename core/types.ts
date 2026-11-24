import type {
  DiscoveryAsset,
  DownloadProgressEvent,
  DownloadRequest,
  DownloadResult,
  DiscoveryProvider,
  ModelSearchEvent,
  ModelSearchRequest,
} from './discovery/types';
import type {
  BlenderRunResult,
  DownloadedAssetRecord,
  PipelineSettings,
  UnityImportRecord,
  UnityImportRequestResult,
} from './pipeline/types';
import type {
  AccessOverview,
  AccessProfileRecord,
  CreateAccessProfileInput,
  PendingAccessAction,
  SessionCheckResult,
} from './access/types';
import type {
  SourceCandidateOverview,
  SourceCandidateRecord,
  SourceDiscoveryResult,
} from './discovery/source-types';

export type SourceFilter = 'all' | 'enabled' | 'upstream' | 'seed';

export interface SourceAlias {
  name: string;
  url: string;
  kind: string;
}

export interface SourceUserMetadata {
  region_language: string;
  license_summary: string;
  formats: string;
  recommended_use: string;
  notes: string;
}

export interface SeedEntry extends SourceUserMetadata {
  row_id: string;
  name: string;
  url: string;
}

export interface SourceAccess {
  upstream_mode: string | null;
  search: string;
  license_metadata: string;
  download: string;
  auth_required: string;
  entitlement_required: string;
  rate_limit: string;
  requires_live_probe: boolean;
}

export interface SourceRecord {
  sourceId: string;
  displayName: string;
  homepage: string;
  domains: string[];
  aliases: SourceAlias[];
  userCatalogRowIds: string[];
  upstreamSourceId: string | null;
  userMetadata: SourceUserMetadata | null;
  seedEntries: SeedEntry[];
  access: SourceAccess;
  connectorStatus: string;
  enabled: boolean;
}

export interface RegistrySource {
  source_id: string;
  display_name: string;
  homepage: string;
  domains: string[];
  aliases: SourceAlias[];
  provenance: {
    upstream_3d_asset_server: {
      source_id: string;
      access: string;
      added_at: string;
      added_by: string;
    } | null;
    user_catalog_row_ids: string[];
  };
  user_metadata: SourceUserMetadata | null;
  seed_entries: SeedEntry[];
  access: SourceAccess;
  connector_status: string;
  enabled: boolean;
  notes: string[];
}

export interface SourceRegistry {
  schema_version: string;
  generated_at: string;
  merge_summary: {
    raw_input_rows: number;
    upstream_sources: number;
    merged_sources: number;
    user_unique_sources: number;
    overlap_source_count: number;
    upstream_only_sources: number;
    user_only_sources: number;
  };
  sources: RegistrySource[];
}

export interface SourceStats {
  total: number;
  enabled: number;
  upstream: number;
  seedOnly: number;
}

export interface BootstrapData {
  stats: SourceStats;
  sources: SourceRecord[];
  databasePath: string;
  registryPath: string;
  schemaVersion: number;
}

export interface SourceSearchInput {
  query: string;
  filter: SourceFilter;
}

export interface SourceApi {
  getBootstrap(): Promise<BootstrapData>;
  searchSources(input: SourceSearchInput): Promise<SourceRecord[]>;
  setSourceEnabled(sourceId: string, enabled: boolean): Promise<SourceRecord | null>;
  getDiscoveryStatus(): Promise<{
    ready: boolean;
    providers: DiscoveryProvider[];
    error?: string;
  }>;
  getCachedAssets(input: {
    query: string;
    formats: string[];
    maxTriangles?: number;
  }): Promise<DiscoveryAsset[]>;
  startModelSearch(request: ModelSearchRequest): Promise<{ searchId: string }>;
  cancelModelSearch(searchId: string): Promise<boolean>;
  downloadModel(request: DownloadRequest): Promise<DownloadResult>;
  onModelSearchEvent(listener: (event: ModelSearchEvent) => void): () => void;
  onDownloadProgress(listener: (event: DownloadProgressEvent) => void): () => void;
  getPipelineSettings(): Promise<PipelineSettings>;
  chooseBlenderPath(): Promise<PipelineSettings | null>;
  chooseUnityProject(): Promise<PipelineSettings | null>;
  getDownloadedAssets(): Promise<DownloadedAssetRecord[]>;
  inspectAsset(assetId: string): Promise<BlenderRunResult>;
  processAsset(assetId: string): Promise<BlenderRunResult>;
  installUnityPlugin(): Promise<PipelineSettings>;
  importAssetToUnity(assetId: string): Promise<UnityImportRequestResult>;
  getUnityImportStatus(requestId: string): Promise<UnityImportRecord | null>;
  openAssetFolder(path: string): Promise<string>;
  getAccessOverview(): Promise<AccessOverview>;
  createAccessProfile(
    input: CreateAccessProfileInput,
  ): Promise<AccessProfileRecord>;
  openAccessLogin(profileId: string): Promise<{ opened: boolean }>;
  checkAccessSession(profileId: string): Promise<SessionCheckResult>;
  clearAccessSession(profileId: string): Promise<void>;
  deleteAccessProfile(profileId: string): Promise<void>;
  createPendingAccessAction(input: {
    sourceId: string;
    kind: string;
    reason: string;
    profileId?: string | null;
  }): Promise<PendingAccessAction[]>;
  resolvePendingAccessAction(actionId: string): Promise<void>;
  getSourceDiscoveryOverview(): Promise<SourceCandidateOverview>;
  discoverSource(url: string): Promise<{
    result: SourceDiscoveryResult;
    candidate: SourceCandidateRecord;
  }>;
  scanKnownSources(): Promise<SourceDiscoveryResult>;
  reprobeSourceCandidate(candidateId: string): Promise<SourceCandidateRecord>;
  approveSourceCandidate(candidateId: string): Promise<string>;
  rejectSourceCandidate(candidateId: string): Promise<void>;
  setSourceDiscoveryAutoEnabled(enabled: boolean): Promise<void>;
}
