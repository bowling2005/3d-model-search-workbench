export interface PipelineSettings {
  blenderPath: string | null;
  blenderAvailable: boolean;
  blenderVersion: string | null;
  unityProjectPath: string | null;
  unityProjectValid: boolean;
  unityPluginInstalled: boolean;
}

export interface BlenderInspectionReport {
  ok: boolean;
  error?: string;
  blenderVersion: string;
  objects: number;
  meshes: number;
  vertices: number;
  triangles: number;
  polygons: number;
  uvLayers: number;
  materials: number;
  textures: number;
  armatures: number;
  animations: number;
  shapeKeys: number;
  bounds: [number, number, number];
  issues: {
    nonManifoldEdges: number;
    boundaryEdges: number;
    looseVertices: number;
    degenerateFaces: number;
    duplicateFaces: number;
  };
  warnings: string[];
}

export interface InspectionRecord {
  inspectionId: string;
  mode: 'inspect' | 'process';
  status: string;
  blenderVersion: string | null;
  report: BlenderInspectionReport | null;
  processedDir: string | null;
  outputModelPath: string | null;
  logExcerpt: string | null;
  createdAt: string;
}

export interface UnityImportRecord {
  requestId: string;
  status: string;
  projectPath: string;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadedAssetRecord {
  assetId: string;
  title: string;
  author: string | null;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  thumbnailUrl: string | null;
  assetType: string;
  formats: string[];
  tags: string[];
  licenseName: string | null;
  licenseUrl: string | null;
  licenseCommercial: boolean | null;
  licenseAttribution: boolean | null;
  knownTriangleCount: number | null;
  downloadDirectory: string;
  sourceDirectory: string;
  modelFiles: string[];
  files: Array<{
    path: string;
    relativePath: string;
    sha256: string;
    sizeBytes: number;
    kind: string;
  }>;
  latestInspection: InspectionRecord | null;
  latestUnityImport: UnityImportRecord | null;
}

export interface BlenderRunResult {
  inspectionId: string;
  report: BlenderInspectionReport;
  processedDir: string | null;
  outputModelPath: string | null;
}

export interface UnityImportRequestResult {
  requestId: string;
  status: string;
  inboxPath: string;
}
