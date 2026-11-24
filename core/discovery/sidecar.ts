import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';

export interface DiscoverySidecarOptions {
  appRoot: string;
  nodeExecutable?: string;
  startupTimeoutMs?: number;
}

export class DiscoverySidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private baseUrl: string | null = null;
  private apiKey: string | null = null;
  private readonly logs: string[] = [];

  constructor(private readonly options: DiscoverySidecarOptions) {}

  async ensureStarted(): Promise<void> {
    if (this.child && this.baseUrl) {
      return;
    }
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
  }

  getEndpoint(): { baseUrl: string; apiKey: string } {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('Asset Discovery service is not running.');
    }
    return { baseUrl: this.baseUrl, apiKey: this.apiKey };
  }

  getRecentLogs(): string[] {
    return [...this.logs];
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.baseUrl = null;
    this.apiKey = null;
    if (!child || child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 1500);
    });
  }

  private async start(): Promise<void> {
    const port = await findAvailablePort();
    const apiKey = randomBytes(24).toString('hex');
    const baseUrl = `http://127.0.0.1:${port}`;
    const serviceDir = join(this.options.appRoot, 'services', 'asset-discovery');
    const nodeExecutable =
      this.options.nodeExecutable ??
      process.env.MODEL_SEARCH_NODE_EXECUTABLE ??
      'node';

    const child = spawn(nodeExecutable, ['dist/cli.js', 'serve'], {
      cwd: serviceDir,
      windowsHide: true,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        ASSET_SERVER_API_KEY: apiKey,
        ASSET_SERVER_PUBLIC_URL: baseUrl,
        ASSET_SERVER_HTTP_MCP: 'false',
        ASSET_SERVER_RATE_LIMIT: '0',
        ASSET_SERVER_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
    });

    this.child = child;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;

    const recordLog = (chunk: Buffer): void => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      this.logs.push(...lines);
      if (this.logs.length > 200) {
        this.logs.splice(0, this.logs.length - 200);
      }
    };
    child.stdout.on('data', recordLog);
    child.stderr.on('data', recordLog);
    child.once('exit', (code, signal) => {
      this.logs.push(`sidecar exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      if (this.child === child) {
        this.child = null;
        this.baseUrl = null;
        this.apiKey = null;
      }
    });

    const timeoutMs = this.options.startupTimeoutMs ?? 20_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Asset Discovery service exited during startup.\n${this.logs.slice(-8).join('\n')}`,
        );
      }
      try {
        const response = await fetch(`${baseUrl}/health`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(1200),
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Startup polling is expected to fail until the listener is ready.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    child.kill();
    this.child = null;
    this.baseUrl = null;
    this.apiKey = null;
    throw new Error(
      `Asset Discovery service did not become ready within ${timeoutMs}ms.\n${this.logs.slice(-8).join('\n')}`,
    );
  }
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local port.'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}
