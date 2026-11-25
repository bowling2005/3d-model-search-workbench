import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type OpenDialogOptions,
} from 'electron';
import { join } from 'node:path';
import { AssetDatabase } from '../core/database';
import { AssetDownloadManager } from '../core/discovery/download';
import {
  DiscoveryClient,
  RemoteDiscoveryEndpoint,
  type DiscoveryEndpoint,
} from '../core/discovery/client';
import { ModelSearchCoordinator } from '../core/discovery/search';
import { DiscoverySidecar } from '../core/discovery/sidecar';
import { BlenderPipeline } from '../core/pipeline/blender';
import { UnityPipeline } from '../core/pipeline/unity';
import { AccessManager } from './access-manager';
import type { CreateAccessProfileInput } from '../core/access/types';
import { SourceDiscoveryService } from '../core/discovery/source-discovery';
import type { SourceFilter, SourceSearchInput } from '../core/types';
import type {
  DownloadRequest,
  ModelSearchRequest,
} from '../core/discovery/types';

let mainWindow: BrowserWindow | null = null;
let database: AssetDatabase | null = null;
let discoverySidecar: DiscoverySidecar | null = null;
let discoveryEndpoint: DiscoveryEndpoint | null = null;
let searchCoordinator: ModelSearchCoordinator | null = null;
let downloadManager: AssetDownloadManager | null = null;
let blenderPipeline: BlenderPipeline | null = null;
let unityPipeline: UnityPipeline | null = null;
let accessManager: AccessManager | null = null;
let sourceDiscoveryService: SourceDiscoveryService | null = null;
let discoveryTimer: NodeJS.Timeout | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#05070b',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  const devUrl = process.env.MODEL_SEARCH_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
  }
}

function initializeDatabase(): AssetDatabase {
  const appRoot = app.getAppPath();
  const resourceRoot = getResourceRoot();
  const storageRoot = getStorageRoot();
  const databasePath =
    process.env.MODEL_SEARCH_DB_PATH ??
    join(storageRoot, 'model-search.db');
  const migrationsDir = join(resourceRoot, 'database', 'migrations');
  const registryPath =
    process.env.MODEL_SEARCH_REGISTRY_PATH ??
    join(resourceRoot, 'sources.merged.json');

  const instance = new AssetDatabase({
    databasePath,
    migrationsDir,
    registryPath,
  });
  const imported = instance.seedSources();
  console.info(`[database] ready at ${databasePath}; seeded ${imported} sources`);
  return instance;
}

function initializeDiscovery(databaseInstance: AssetDatabase): void {
  const appRoot = app.getAppPath();
  const resourceRoot = getResourceRoot();
  const storageRoot = getStorageRoot();
  blenderPipeline = new BlenderPipeline(databaseInstance, resourceRoot, storageRoot);
  unityPipeline = new UnityPipeline(databaseInstance, resourceRoot);
  accessManager = new AccessManager(databaseInstance, () => mainWindow);
  sourceDiscoveryService = new SourceDiscoveryService(databaseInstance);
  const configuredMode = process.env.MODEL_SEARCH_DISCOVERY_MODE;
  const useLocal = configuredMode
    ? configuredMode === 'local'
    : !app.isPackaged;
  if (useLocal) {
    discoverySidecar = new DiscoverySidecar({ appRoot });
    discoveryEndpoint = discoverySidecar;
  } else {
    discoveryEndpoint = new RemoteDiscoveryEndpoint(
      process.env.MODEL_SEARCH_DISCOVERY_URL ?? 'https://3d.shep.bot',
      process.env.MODEL_SEARCH_DISCOVERY_API_KEY ?? null,
    );
  }
  const client = new DiscoveryClient({ sidecar: discoveryEndpoint });
  searchCoordinator = new ModelSearchCoordinator(databaseInstance, client);
  downloadManager = new AssetDownloadManager(
    databaseInstance,
    client,
    storageRoot,
  );

  void discoveryEndpoint.ensureStarted().catch((error: unknown) => {
    console.error('[discovery] sidecar startup failed', error);
  });
}

function getResourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function getStorageRoot(): string {
  return (
    process.env.MODEL_SEARCH_DATA_DIR ??
    (app.isPackaged
      ? join(app.getPath('userData'), 'data')
      : join(app.getAppPath(), 'data'))
  );
}

function scheduleSourceDiscovery(): void {
  const check = (): void => {
    if (!sourceDiscoveryService) {
      return;
    }
    const overview = sourceDiscoveryService.getOverview();
    if (!overview.autoDiscoveryEnabled) {
      return;
    }
    const lastScan = overview.lastScanAt
      ? new Date(overview.lastScanAt).valueOf()
      : 0;
    if (Date.now() - lastScan < 24 * 60 * 60 * 1000) {
      return;
    }
    void sourceDiscoveryService.scanKnownSources().catch((error: unknown) => {
      console.error('[discovery] automatic source scan failed', error);
    });
  };
  setTimeout(check, 60_000);
  discoveryTimer = setInterval(check, 60 * 60 * 1000);
}

function registerIpcHandlers(): void {
  ipcMain.handle('sources:bootstrap', () => {
    if (!database) {
      throw new Error('Database is not initialized.');
    }
    return database.getBootstrapData();
  });

  ipcMain.handle('sources:search', (_event, payload: unknown) => {
    if (!database) {
      throw new Error('Database is not initialized.');
    }

    const input = payload as Partial<SourceSearchInput> | null;
    const allowedFilters = new Set<SourceFilter>([
      'all',
      'enabled',
      'upstream',
      'seed',
    ]);
    const filter =
      input?.filter && allowedFilters.has(input.filter) ? input.filter : 'all';

    return database.listSources({
      query: typeof input?.query === 'string' ? input.query.slice(0, 200) : '',
      filter,
    });
  });

  ipcMain.handle(
    'sources:set-enabled',
    (_event, sourceId: unknown, enabled: unknown) => {
      if (!database) {
        throw new Error('Database is not initialized.');
      }
      if (typeof sourceId !== 'string' || typeof enabled !== 'boolean') {
        throw new Error('Invalid source enable request.');
      }
      return database.setSourceEnabled(sourceId, enabled);
    },
  );

  ipcMain.handle('models:discovery-status', async () => {
    if (!discoveryEndpoint) {
      return {
        ready: false,
        providers: [],
        error: 'Discovery service is not initialized.',
      };
    }
    try {
      await discoveryEndpoint.ensureStarted();
      const client = new DiscoveryClient({ sidecar: discoveryEndpoint });
      return {
        ready: true,
        providers: await client.listProviders(),
      };
    } catch (error) {
      return {
        ready: false,
        providers: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'models:cached-assets',
    (
      _event,
      payload: { query?: unknown; formats?: unknown; maxTriangles?: unknown },
    ) => {
      if (!database) {
        throw new Error('Database is not initialized.');
      }
      const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
      if (!query) {
        return [];
      }
      return database.searchCachedAssets(query.slice(0, 200), {
        formats: Array.isArray(payload.formats)
          ? payload.formats.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
        maxTriangles:
          typeof payload.maxTriangles === 'number' && payload.maxTriangles > 0
            ? Math.floor(payload.maxTriangles)
            : undefined,
      });
    },
  );

  ipcMain.handle(
    'models:start-search',
    (event, payload: ModelSearchRequest) => {
      if (!searchCoordinator) {
        throw new Error('Search service is not initialized.');
      }
      const request = normalizeSearchRequest(payload);
      return searchCoordinator.start(request, (searchEvent) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('models:search-event', searchEvent);
        }
      });
    },
  );

  ipcMain.handle('models:cancel-search', (_event, searchId: unknown) => {
    if (!searchCoordinator || typeof searchId !== 'string') {
      return false;
    }
    return searchCoordinator.cancel(searchId);
  });

  ipcMain.handle('models:download', async (event, payload: DownloadRequest) => {
    if (!downloadManager) {
      throw new Error('Download service is not initialized.');
    }
    const request = normalizeDownloadRequest(payload);
    return downloadManager.download(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('models:download-progress', progress);
      }
    });
  });

  ipcMain.handle('pipeline:get-settings', async () => {
    if (!blenderPipeline) {
      throw new Error('Blender pipeline is not initialized.');
    }
    return blenderPipeline.getSettings();
  });

  ipcMain.handle('pipeline:choose-blender', async () => {
    if (!blenderPipeline) {
      throw new Error('Blender pipeline is not initialized.');
    }
    const options: OpenDialogOptions = {
      title: '选择 Blender 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'Blender', extensions: ['exe'] }],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    await blenderPipeline.setBlenderPath(result.filePaths[0]);
    return blenderPipeline.getSettings();
  });

  ipcMain.handle('pipeline:choose-unity-project', async () => {
    if (!blenderPipeline || !unityPipeline) {
      throw new Error('Unity pipeline is not initialized.');
    }
    const options: OpenDialogOptions = {
      title: '选择 Unity 项目',
      properties: ['openDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    await unityPipeline.setProjectPath(result.filePaths[0]);
    return blenderPipeline.getSettings();
  });

  ipcMain.handle('pipeline:list-assets', () => {
    if (!database) {
      throw new Error('Database is not initialized.');
    }
    return database.getDownloadedAssets();
  });

  ipcMain.handle('pipeline:inspect', async (_event, assetId: unknown) => {
    if (!database || !blenderPipeline || typeof assetId !== 'string') {
      throw new Error('Invalid Blender inspection request.');
    }
    const asset = database.getDownloadedAsset(assetId);
    if (!asset) {
      throw new Error('Downloaded asset was not found.');
    }
    return blenderPipeline.run(asset, 'inspect');
  });

  ipcMain.handle('pipeline:process', async (_event, assetId: unknown) => {
    if (!database || !blenderPipeline || typeof assetId !== 'string') {
      throw new Error('Invalid Blender processing request.');
    }
    const asset = database.getDownloadedAsset(assetId);
    if (!asset) {
      throw new Error('Downloaded asset was not found.');
    }
    return blenderPipeline.run(asset, 'process');
  });

  ipcMain.handle('pipeline:install-unity-plugin', async () => {
    if (!blenderPipeline || !unityPipeline) {
      throw new Error('Unity pipeline is not initialized.');
    }
    await unityPipeline.installPlugin();
    return blenderPipeline.getSettings();
  });

  ipcMain.handle('pipeline:import-unity', async (_event, assetId: unknown) => {
    if (!database || !unityPipeline || typeof assetId !== 'string') {
      throw new Error('Invalid Unity import request.');
    }
    const asset = database.getDownloadedAsset(assetId);
    if (!asset) {
      throw new Error('Downloaded asset was not found.');
    }
    return unityPipeline.createImportRequest(asset);
  });

  ipcMain.handle('pipeline:unity-status', async (_event, requestId: unknown) => {
    if (!unityPipeline || typeof requestId !== 'string') {
      return null;
    }
    return unityPipeline.refreshImportStatus(requestId);
  });

  ipcMain.handle('pipeline:open-folder', async (_event, path: unknown) => {
    if (typeof path !== 'string') {
      throw new Error('Invalid folder path.');
    }
    return shell.openPath(path);
  });

  ipcMain.handle('access:overview', () => {
    if (!accessManager) {
      throw new Error('Access manager is not initialized.');
    }
    return accessManager.getOverview();
  });

  ipcMain.handle(
    'access:create-profile',
    async (_event, payload: CreateAccessProfileInput) => {
      if (!accessManager) {
        throw new Error('Access manager is not initialized.');
      }
      if (
        !payload ||
        typeof payload.sourceId !== 'string' ||
        typeof payload.displayName !== 'string' ||
        typeof payload.authMode !== 'string'
      ) {
        throw new Error('Invalid account profile.');
      }
      return accessManager.createProfile({
        sourceId: payload.sourceId,
        displayName: payload.displayName.slice(0, 80),
        authMode: payload.authMode,
        username:
          typeof payload.username === 'string'
            ? payload.username.slice(0, 200)
            : '',
        password:
          typeof payload.password === 'string' ? payload.password : '',
        apiKey: typeof payload.apiKey === 'string' ? payload.apiKey : '',
      });
    },
  );

  ipcMain.handle('access:open-login', async (_event, profileId: unknown) => {
    if (!accessManager || typeof profileId !== 'string') {
      throw new Error('Invalid login request.');
    }
    return accessManager.openLoginWindow(profileId);
  });

  ipcMain.handle('access:check-session', async (_event, profileId: unknown) => {
    if (!accessManager || typeof profileId !== 'string') {
      throw new Error('Invalid session check.');
    }
    return accessManager.checkSession(profileId);
  });

  ipcMain.handle('access:clear-session', async (_event, profileId: unknown) => {
    if (!accessManager || typeof profileId !== 'string') {
      throw new Error('Invalid session clear request.');
    }
    await accessManager.clearSession(profileId);
  });

  ipcMain.handle('access:delete-profile', async (_event, profileId: unknown) => {
    if (!accessManager || typeof profileId !== 'string') {
      throw new Error('Invalid profile delete request.');
    }
    await accessManager.deleteProfile(profileId);
  });

  ipcMain.handle(
    'access:create-pending',
    (
      _event,
      payload: {
        sourceId?: unknown;
        kind?: unknown;
        reason?: unknown;
        profileId?: unknown;
      },
    ) => {
      if (!accessManager) {
        throw new Error('Access manager is not initialized.');
      }
      if (typeof payload?.sourceId !== 'string') {
        throw new Error('Invalid pending access request.');
      }
      return accessManager.createPending({
        sourceId: payload.sourceId,
        kind:
          typeof payload.kind === 'string' ? payload.kind.slice(0, 60) : 'verify_access',
        reason:
          typeof payload.reason === 'string'
            ? payload.reason.slice(0, 400)
            : '需要用户配置站点访问。',
        profileId:
          typeof payload.profileId === 'string' ? payload.profileId : null,
      });
    },
  );

  ipcMain.handle('access:resolve-pending', (_event, actionId: unknown) => {
    if (!accessManager || typeof actionId !== 'string') {
      throw new Error('Invalid pending access action.');
    }
    accessManager.resolvePending(actionId);
  });

  ipcMain.handle('discovery:overview', () => {
    if (!sourceDiscoveryService) {
      throw new Error('Source discovery is not initialized.');
    }
    return sourceDiscoveryService.getOverview();
  });

  ipcMain.handle('discovery:add-url', async (_event, url: unknown) => {
    if (!sourceDiscoveryService || typeof url !== 'string') {
      throw new Error('Invalid source URL.');
    }
    return sourceDiscoveryService.addManual(url.trim());
  });

  ipcMain.handle('discovery:scan-sources', async () => {
    if (!sourceDiscoveryService) {
      throw new Error('Source discovery is not initialized.');
    }
    return sourceDiscoveryService.scanKnownSources();
  });

  ipcMain.handle('discovery:reprobe', async (_event, candidateId: unknown) => {
    if (!sourceDiscoveryService || typeof candidateId !== 'string') {
      throw new Error('Invalid source candidate.');
    }
    return sourceDiscoveryService.reprobe(candidateId);
  });

  ipcMain.handle('discovery:approve', (_event, candidateId: unknown) => {
    if (!sourceDiscoveryService || typeof candidateId !== 'string') {
      throw new Error('Invalid source candidate.');
    }
    return sourceDiscoveryService.approve(candidateId);
  });

  ipcMain.handle('discovery:reject', (_event, candidateId: unknown) => {
    if (!sourceDiscoveryService || typeof candidateId !== 'string') {
      throw new Error('Invalid source candidate.');
    }
    sourceDiscoveryService.reject(candidateId);
  });

  ipcMain.handle('discovery:auto', (_event, enabled: unknown) => {
    if (!sourceDiscoveryService || typeof enabled !== 'boolean') {
      throw new Error('Invalid auto-discovery setting.');
    }
    sourceDiscoveryService.setAutoDiscoveryEnabled(enabled);
  });
}

function normalizeSearchRequest(payload: ModelSearchRequest): ModelSearchRequest {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
  if (!query) {
    throw new Error('Search query cannot be empty.');
  }
  return {
    query: query.slice(0, 200),
    freeOnly: payload.freeOnly !== false,
    directOnly: payload.directOnly !== false,
    formats: Array.isArray(payload.formats)
      ? payload.formats.filter((value): value is string => typeof value === 'string')
      : [],
    maxTriangles:
      typeof payload.maxTriangles === 'number' && payload.maxTriangles > 0
        ? Math.floor(payload.maxTriangles)
        : undefined,
    resultLimitPerSource:
      typeof payload.resultLimitPerSource === 'number'
        ? Math.min(Math.max(Math.floor(payload.resultLimitPerSource), 1), 50)
        : 20,
  };
}

function normalizeDownloadRequest(payload: DownloadRequest): DownloadRequest {
  if (!payload?.asset?.id || typeof payload.asset.id !== 'string') {
    throw new Error('A downloadable asset is required.');
  }
  return {
    asset: payload.asset,
    format:
      typeof payload.format === 'string'
        ? payload.format.toLowerCase().slice(0, 20)
        : undefined,
    resolution:
      typeof payload.resolution === 'string'
        ? payload.resolution.toLowerCase().slice(0, 12)
        : undefined,
    all: payload.all === true,
  };
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(null);
    database = initializeDatabase();
    initializeDiscovery(database);
    registerIpcHandlers();
    createWindow();
    scheduleSourceDiscovery();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
  void discoverySidecar?.stop();
  discoverySidecar = null;
  discoveryEndpoint = null;
  searchCoordinator = null;
  downloadManager = null;
  blenderPipeline = null;
  unityPipeline = null;
  accessManager = null;
  sourceDiscoveryService = null;
  database?.close();
  database = null;
});
