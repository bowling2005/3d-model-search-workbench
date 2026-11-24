import { contextBridge, ipcRenderer } from 'electron';
import type {
  SourceApi,
  SourceSearchInput,
} from '../core/types';
import type {
  DownloadProgressEvent,
  DownloadRequest,
  ModelSearchEvent,
  ModelSearchRequest,
} from '../core/discovery/types';

const api: SourceApi = {
  getBootstrap: () => ipcRenderer.invoke('sources:bootstrap'),
  searchSources: (input: SourceSearchInput) =>
    ipcRenderer.invoke('sources:search', input),
  setSourceEnabled: (sourceId: string, enabled: boolean) =>
    ipcRenderer.invoke('sources:set-enabled', sourceId, enabled),
  getDiscoveryStatus: () => ipcRenderer.invoke('models:discovery-status'),
  getCachedAssets: (input) => ipcRenderer.invoke('models:cached-assets', input),
  startModelSearch: (request: ModelSearchRequest) =>
    ipcRenderer.invoke('models:start-search', request),
  cancelModelSearch: (searchId: string) =>
    ipcRenderer.invoke('models:cancel-search', searchId),
  downloadModel: (request: DownloadRequest) =>
    ipcRenderer.invoke('models:download', request),
  onModelSearchEvent: (listener: (event: ModelSearchEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ModelSearchEvent) =>
      listener(payload);
    ipcRenderer.on('models:search-event', wrapped);
    return () => ipcRenderer.removeListener('models:search-event', wrapped);
  },
  onDownloadProgress: (listener: (event: DownloadProgressEvent) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: DownloadProgressEvent,
    ) => listener(payload);
    ipcRenderer.on('models:download-progress', wrapped);
    return () => ipcRenderer.removeListener('models:download-progress', wrapped);
  },
  getPipelineSettings: () => ipcRenderer.invoke('pipeline:get-settings'),
  chooseBlenderPath: () => ipcRenderer.invoke('pipeline:choose-blender'),
  chooseUnityProject: () => ipcRenderer.invoke('pipeline:choose-unity-project'),
  getDownloadedAssets: () => ipcRenderer.invoke('pipeline:list-assets'),
  inspectAsset: (assetId: string) =>
    ipcRenderer.invoke('pipeline:inspect', assetId),
  processAsset: (assetId: string) =>
    ipcRenderer.invoke('pipeline:process', assetId),
  installUnityPlugin: () => ipcRenderer.invoke('pipeline:install-unity-plugin'),
  importAssetToUnity: (assetId: string) =>
    ipcRenderer.invoke('pipeline:import-unity', assetId),
  getUnityImportStatus: (requestId: string) =>
    ipcRenderer.invoke('pipeline:unity-status', requestId),
  openAssetFolder: (path: string) =>
    ipcRenderer.invoke('pipeline:open-folder', path),
  getAccessOverview: () => ipcRenderer.invoke('access:overview'),
  createAccessProfile: (input) =>
    ipcRenderer.invoke('access:create-profile', input),
  openAccessLogin: (profileId: string) =>
    ipcRenderer.invoke('access:open-login', profileId),
  checkAccessSession: (profileId: string) =>
    ipcRenderer.invoke('access:check-session', profileId),
  clearAccessSession: (profileId: string) =>
    ipcRenderer.invoke('access:clear-session', profileId),
  deleteAccessProfile: (profileId: string) =>
    ipcRenderer.invoke('access:delete-profile', profileId),
  createPendingAccessAction: (input) =>
    ipcRenderer.invoke('access:create-pending', input),
  resolvePendingAccessAction: (actionId: string) =>
    ipcRenderer.invoke('access:resolve-pending', actionId),
  getSourceDiscoveryOverview: () =>
    ipcRenderer.invoke('discovery:overview'),
  discoverSource: (url: string) =>
    ipcRenderer.invoke('discovery:add-url', url),
  scanKnownSources: () =>
    ipcRenderer.invoke('discovery:scan-sources'),
  reprobeSourceCandidate: (candidateId: string) =>
    ipcRenderer.invoke('discovery:reprobe', candidateId),
  approveSourceCandidate: (candidateId: string) =>
    ipcRenderer.invoke('discovery:approve', candidateId),
  rejectSourceCandidate: (candidateId: string) =>
    ipcRenderer.invoke('discovery:reject', candidateId),
  setSourceDiscoveryAutoEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('discovery:auto', enabled),
};

contextBridge.exposeInMainWorld('modelSearch', api);
