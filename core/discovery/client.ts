import type {
  DiscoveryAssetDetails,
  DiscoveryProvider,
  DiscoverySearchResponse,
} from './types';

export interface DiscoveryEndpoint {
  ensureStarted(): Promise<void>;
  getEndpoint(): {
    baseUrl: string;
    apiKey?: string | null;
  };
}

export class RemoteDiscoveryEndpoint implements DiscoveryEndpoint {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | null = null,
  ) {}

  async ensureStarted(): Promise<void> {}

  getEndpoint(): { baseUrl: string; apiKey: string | null } {
    return {
      baseUrl: this.baseUrl.replace(/\/+$/, ''),
      apiKey: this.apiKey,
    };
  }
}

export interface DiscoveryClientOptions {
  sidecar: DiscoveryEndpoint;
  timeoutMs?: number;
}

export class DiscoveryClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: DiscoveryClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  async listProviders(): Promise<DiscoveryProvider[]> {
    const response = await this.request<{ providers: DiscoveryProvider[] }>(
      '/v1/providers',
      this.timeoutMs,
    );
    return response.providers;
  }

  async searchProvider(input: {
    query: string;
    providerId: string;
    freeOnly: boolean;
    directOnly: boolean;
    limit: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<DiscoverySearchResponse> {
    const params = new URLSearchParams({
      q: input.query,
      type: 'model',
      providers: input.providerId,
      free: String(input.freeOnly),
      downloadable: String(input.directOnly),
      limit: String(input.limit),
    });

    return this.request<DiscoverySearchResponse>(
      `/v1/search?${params.toString()}`,
      Math.min(input.timeoutMs, this.timeoutMs),
      input.signal,
    );
  }

  async getAsset(id: string, signal?: AbortSignal): Promise<DiscoveryAssetDetails> {
    return this.request<DiscoveryAssetDetails>(
      `/v1/assets/${encodeURIComponent(id)}`,
      this.timeoutMs,
      signal,
    );
  }

  async openDownload(
    id: string,
    input: { format?: string; resolution?: string; all?: boolean },
    signal?: AbortSignal,
  ): Promise<Response> {
    await this.options.sidecar.ensureStarted();
    const { baseUrl, apiKey } = this.options.sidecar.getEndpoint();
    const params = new URLSearchParams();
    if (input.format) {
      params.set('format', input.format);
    }
    if (input.resolution) {
      params.set('resolution', input.resolution);
    }
    if (input.all) {
      params.set('all', 'true');
    }
    const suffix = params.size ? `?${params.toString()}` : '';

    let current = `${baseUrl}/v1/assets/${encodeURIComponent(id)}/download${suffix}`;
    let authorization: string | undefined = apiKey
      ? `Bearer ${apiKey}`
      : undefined;
    for (let redirect = 0; redirect <= 5; redirect++) {
      const response = await fetch(current, {
        headers: authorization ? { Authorization: authorization } : undefined,
        redirect: 'manual',
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          throw new Error('Download redirect did not include a Location header.');
        }
        current = new URL(location, current).toString();
        authorization = undefined;
        continue;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `Download request failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }
      return response;
    }

    throw new Error('Download exceeded the redirect limit.');
  }

  private async request<T>(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.options.sidecar.ensureStarted();
    const { baseUrl, apiKey } = this.options.sidecar.getEndpoint();
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: combinedSignal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Discovery request failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }
}
