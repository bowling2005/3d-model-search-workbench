export type DiscoveryProviderStatus =
  | 'ok'
  | 'error'
  | 'timeout'
  | 'skipped'
  | 'link';

export interface DiscoveryLicense {
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
}

export interface DiscoveryAsset {
  id: string;
  provider: string;
  nativeId: string;
  title: string;
  description?: string;
  type: string;
  tags: string[];
  categories?: string[];
  url: string;
  thumbnailUrl?: string;
  author?: string;
  license?: DiscoveryLicense;
  price?: {
    free: boolean;
    amount?: number;
    currency?: string;
  };
  formats?: string[];
  resolutions?: string[];
  polyCount?: number;
  animated?: boolean;
  rigged?: boolean;
  downloadable: boolean;
  createdAt?: string;
  score?: number;
}

export interface DiscoveryAssetFile {
  url: string;
  filename: string;
  format: string;
  resolution?: string;
  mapType?: string;
  sizeBytes?: number;
  group?: string;
  includes?: Array<{
    path: string;
    url: string;
    sizeBytes?: number;
  }>;
  requiresAuth?: boolean;
}

export interface DiscoveryAssetDetails extends DiscoveryAsset {
  files: DiscoveryAssetFile[];
}

export interface DiscoveryProvider {
  id: string;
  name: string;
  homepage: string;
  description: string;
  assetTypes: string[];
  access: 'api' | 'scrape' | 'link';
  pricing: 'free' | 'freemium' | 'paid';
  license?: DiscoveryLicense;
  apiKeyEnv?: string;
  supportsDownload: boolean;
  enabled: boolean;
}

export interface ProviderSearchReport {
  provider: string;
  name: string;
  status: DiscoveryProviderStatus;
  count: number;
  total?: number;
  searchUrl?: string;
  error?: string;
  tookMs: number;
}

export interface DiscoverySearchResponse {
  query: string;
  types?: string[];
  results: DiscoveryAsset[];
  providers: ProviderSearchReport[];
}

export interface ModelSearchRequest {
  query: string;
  freeOnly: boolean;
  directOnly: boolean;
  formats: string[];
  maxTriangles?: number;
  resultLimitPerSource?: number;
}

export interface ModelSearchSourceStatus {
  sourceId: string;
  providerId: string;
  displayName: string;
  status:
    | 'queued'
    | 'searching'
    | 'ok'
    | 'skipped'
    | 'timeout'
    | 'error'
    | 'cancelled';
  count: number;
  tookMs: number;
  error?: string;
  searchUrl?: string;
}

export type ModelSearchEvent =
  | {
      type: 'started';
      searchId: string;
      query: string;
      totalSources: number;
    }
  | {
      type: 'source-started';
      searchId: string;
      sourceId: string;
      providerId: string;
      displayName: string;
    }
  | {
      type: 'source-results';
      searchId: string;
      sourceId: string;
      providerId: string;
      displayName: string;
      assets: DiscoveryAsset[];
      status: ModelSearchSourceStatus;
    }
  | {
      type: 'completed';
      searchId: string;
      elapsedMs: number;
      succeeded: number;
      failed: number;
      cancelled: number;
      resultCount: number;
    }
  | {
      type: 'failed';
      searchId: string;
      error: string;
    }
  | {
      type: 'cancelled';
      searchId: string;
    };

export interface DownloadRequest {
  asset: DiscoveryAsset;
  format?: string;
  resolution?: string;
  all?: boolean;
}

export type DownloadProgressEvent =
  | {
      type: 'started';
      jobId: string;
      assetId: string;
    }
  | {
      type: 'progress';
      jobId: string;
      assetId: string;
      receivedBytes: number;
      totalBytes?: number;
    }
  | {
      type: 'completed';
      jobId: string;
      assetId: string;
      directory: string;
      files: string[];
      bytes: number;
    }
  | {
      type: 'failed';
      jobId: string;
      assetId: string;
      error: string;
    };

export interface DownloadResult {
  jobId: string;
  assetId: string;
  directory: string;
  files: string[];
  bytes: number;
}
