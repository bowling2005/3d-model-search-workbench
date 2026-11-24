import { randomUUID } from 'node:crypto';
import type { AssetDatabase } from '../database';
import type { DiscoveryClient } from './client';
import type {
  DiscoveryAsset,
  ModelSearchEvent,
  ModelSearchRequest,
  ModelSearchSourceStatus,
} from './types';

interface ActiveSearch {
  controller: AbortController;
  startedAt: number;
}

export class ModelSearchCoordinator {
  private readonly active = new Map<string, ActiveSearch>();
  private readonly latencyByProvider = new Map<string, number>();

  constructor(
    private readonly database: AssetDatabase,
    private readonly discovery: DiscoveryClient,
  ) {}

  start(
    request: ModelSearchRequest,
    emit: (event: ModelSearchEvent) => void,
  ): { searchId: string } {
    const searchId = randomUUID();
    const controller = new AbortController();
    this.active.set(searchId, {
      controller,
      startedAt: Date.now(),
    });

    void this.run(searchId, request, controller.signal, emit).finally(() => {
      this.active.delete(searchId);
    });

    return { searchId };
  }

  cancel(searchId: string): boolean {
    const search = this.active.get(searchId);
    if (!search) {
      return false;
    }
    search.controller.abort();
    return true;
  }

  private async run(
    searchId: string,
    request: ModelSearchRequest,
    signal: AbortSignal,
    emit: (event: ModelSearchEvent) => void,
  ): Promise<void> {
    const startedAt = Date.now();
    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    let resultCount = 0;

    try {
      const sources = this.database.getEnabledUpstreamSources();
      emit({
        type: 'started',
        searchId,
        query: request.query,
        totalSources: sources.length,
      });

      const providers = await this.discovery.listProviders();
      const providerById = new Map(providers.map((provider) => [provider.id, provider]));
      const deadline = startedAt + 12_000;
      const directOnly = request.directOnly;
      const freeOnly = request.freeOnly;
      const formats = request.formats.map((format) => format.toLowerCase());
      const limit = Math.min(Math.max(request.resultLimitPerSource ?? 20, 1), 50);

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!signal.aborted) {
          if (Date.now() >= deadline) {
            return;
          }
          const index = cursor++;
          if (index >= sources.length) {
            return;
          }
          const source = sources[index]!;
          const providerId = source.upstreamSourceId;
          if (!providerId) {
            continue;
          }
          const provider = providerById.get(providerId);
          if (!provider || !provider.assetTypes.includes('model')) {
            const status: ModelSearchSourceStatus = {
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              status: 'skipped',
              count: 0,
              tookMs: 0,
              error: !provider ? 'Provider is not available.' : 'Provider has no model assets.',
            };
            emit({
              type: 'source-results',
              searchId,
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              assets: [],
              status,
            });
            continue;
          }
          if (directOnly && !provider.supportsDownload) {
            const status: ModelSearchSourceStatus = {
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              status: 'skipped',
              count: 0,
              tookMs: 0,
              error: 'No direct public downloads.',
            };
            emit({
              type: 'source-results',
              searchId,
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              assets: [],
              status,
            });
            continue;
          }

          emit({
            type: 'source-started',
            searchId,
            sourceId: source.sourceId,
            providerId,
            displayName: source.displayName,
          });

          const sourceStartedAt = Date.now();
          const p95 = this.latencyByProvider.get(providerId) ?? 7_000;
          const sourceTimeout = Math.min(
            Math.max(p95 * 1.8, 3_000),
            Math.max(500, deadline - Date.now()),
          );
          try {
            const response = await this.discovery.searchProvider({
              query: request.query,
              providerId,
              freeOnly,
              directOnly,
              limit,
              timeoutMs: sourceTimeout,
              signal,
            });
            const report = response.providers.find(
              (entry) => entry.provider === providerId,
            );
            const assets = response.results.filter((asset) =>
              matchesLocalFilters(asset, formats, request.maxTriangles),
            );

            for (const asset of assets) {
              try {
                this.database.upsertDiscoveredAsset(asset, source.sourceId);
              } catch (error) {
                console.error(`[search] failed to cache ${asset.id}`, error);
              }
            }

            const status: ModelSearchSourceStatus = {
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              status:
                report?.status === 'link'
                  ? 'skipped'
                  : report?.status === 'timeout'
                    ? 'timeout'
                    : report?.status === 'error'
                      ? 'error'
                      : 'ok',
              count: assets.length,
              tookMs: Date.now() - sourceStartedAt,
              error: report?.error,
              searchUrl: report?.searchUrl,
            };
            this.latencyByProvider.set(providerId, status.tookMs);
            succeeded += status.status === 'ok' ? 1 : 0;
            failed +=
              status.status === 'error' || status.status === 'timeout' ? 1 : 0;
            resultCount += assets.length;
            emit({
              type: 'source-results',
              searchId,
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              assets,
              status,
            });
          } catch (error) {
            if (signal.aborted) {
              cancelled += 1;
              return;
            }
            const status: ModelSearchSourceStatus = {
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              status: isTimeoutError(error) ? 'timeout' : 'error',
              count: 0,
              tookMs: Date.now() - sourceStartedAt,
              error: error instanceof Error ? error.message : String(error),
            };
            failed += 1;
            emit({
              type: 'source-results',
              searchId,
              sourceId: source.sourceId,
              providerId,
              displayName: source.displayName,
              assets: [],
              status,
            });
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(8, Math.max(1, sources.length)) },
          () => worker(),
        ),
      );

      if (signal.aborted) {
        emit({ type: 'cancelled', searchId });
        return;
      }
      emit({
        type: 'completed',
        searchId,
        elapsedMs: Date.now() - startedAt,
        succeeded,
        failed,
        cancelled,
        resultCount,
      });
    } catch (error) {
      if (signal.aborted) {
        emit({ type: 'cancelled', searchId });
      } else {
        emit({
          type: 'failed',
          searchId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function matchesLocalFilters(
  asset: DiscoveryAsset,
  formats: string[],
  maxTriangles?: number,
): boolean {
  if (
    formats.length > 0 &&
    !(asset.formats ?? []).some((format) => formats.includes(format.toLowerCase()))
  ) {
    return false;
  }
  if (
    typeof maxTriangles === 'number' &&
    typeof asset.polyCount === 'number' &&
    asset.polyCount > maxTriangles
  ) {
    return false;
  }
  return true;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      /timed out|timeout/i.test(error.message))
  );
}
