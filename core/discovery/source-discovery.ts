import { randomUUID } from 'node:crypto';
import type { AssetDatabase } from '../database';
import type {
  SourceCandidateOverview,
  SourceCandidateRecord,
  SourceCandidateStatus,
  SourceDiscoveryResult,
  SourceProbeEvidence,
} from './source-types';

const AUTO_DISCOVERY_SETTING = 'discovery.autoEnabled';
const LAST_SCAN_SETTING = 'discovery.lastScanAt';
const SOCIAL_OR_IGNORED_DOMAINS = [
  'github.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'discord.com',
  'discord.gg',
  'reddit.com',
  'pinterest.com',
  'patreon.com',
  'gumroad.com',
  'paypal.com',
  'cloudflare.com',
  'google.com',
];

export class SourceDiscoveryService {
  constructor(private readonly database: AssetDatabase) {}

  getOverview(): SourceCandidateOverview {
    return {
      candidates: this.database.listSourceCandidates(),
      autoDiscoveryEnabled: this.database.getSetting<boolean>(
        AUTO_DISCOVERY_SETTING,
        false,
      ),
      lastScanAt: this.database.getSetting<string | null>(
        LAST_SCAN_SETTING,
        null,
      ),
    };
  }

  setAutoDiscoveryEnabled(enabled: boolean): void {
    this.database.setSetting(AUTO_DISCOVERY_SETTING, enabled);
  }

  async addManual(
    url: string,
  ): Promise<{ result: SourceDiscoveryResult; candidate: SourceCandidateRecord }> {
    const candidate = await this.probe(url, 'manual', 'manual');
    return {
      result: {
        created: 1,
        probed: 1,
        duplicates: candidate.status === 'duplicate' ? 1 : 0,
        failed: candidate.status === 'error' ? 1 : 0,
      },
      candidate,
    };
  }

  async scanKnownSources(): Promise<SourceDiscoveryResult> {
    const sources = this.database.getEnabledUpstreamSources();
    const discoveredDomains = new Map<string, string>();
    let failed = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < Math.min(sources.length, 16)) {
        const source = sources[cursor++]!;
        try {
          const html = await fetchText(source.homepage, 7_000);
          for (const link of extractLinks(html, source.homepage)) {
            const domain = normalizedDomain(link.url);
            if (
              !domain ||
              this.isKnownOrIgnored(domain) ||
              discoveredDomains.has(domain)
            ) {
              continue;
            }
            if (looksLikeAssetSite(link.url, link.text, domain)) {
              discoveredDomains.set(domain, link.url);
            }
          }
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    let created = 0;
    let probed = 0;
    let duplicates = 0;
    for (const [domain, url] of [...discoveredDomains.entries()].slice(0, 12)) {
      try {
        if (
          this.database
            .listSourceCandidates()
            .some((candidate) => candidate.domain === domain)
        ) {
          duplicates += 1;
          continue;
        }
        const candidate = await this.probe(url, 'known_source_links', 'link_scan');
        created += 1;
        probed += 1;
        if (candidate.status === 'duplicate') {
          duplicates += 1;
        }
      } catch {
        failed += 1;
      }
    }
    this.database.setSetting(LAST_SCAN_SETTING, new Date().toISOString());
    return { created, probed, duplicates, failed };
  }

  async reprobe(candidateId: string): Promise<SourceCandidateRecord> {
    const candidate = this.database
      .listSourceCandidates()
      .find((entry) => entry.candidateId === candidateId);
    if (!candidate) {
      throw new Error('Source candidate was not found.');
    }
    return this.probe(
      candidate.homepage,
      candidate.discoveredFrom,
      candidate.discoveryKind,
    );
  }

  approve(candidateId: string): string {
    return this.database.approveSourceCandidate(candidateId);
  }

  reject(candidateId: string): void {
    this.database.updateSourceCandidateStatus(candidateId, 'rejected');
  }

  async probe(
    inputUrl: string,
    discoveredFrom: string,
    discoveryKind: string,
  ): Promise<SourceCandidateRecord> {
    let url: URL;
    try {
      url = new URL(inputUrl);
    } catch {
      throw new Error('请输入有效的 http 或 https 网址。');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('只允许探测公开的 http/https 网站。');
    }
    const domain = normalizedDomain(url.toString());
    if (!domain) {
      throw new Error('无法识别候选站点域名。');
    }

    let html = '';
    let finalUrl = url.toString();
    let fetchError: string | null = null;
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'ModelSearchWorkbench/0.1 source-discovery',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      finalUrl = response.url || finalUrl;
      html = (await response.text()).slice(0, 2_000_000);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
    }

    const robotsAllowed = fetchError
      ? false
      : await probeRobots(new URL(finalUrl));
    const parsed = parseHomepage(html, finalUrl);
    const known = this.database.isKnownSourceDomain(domain);
    const score = scoreProbe(parsed, robotsAllowed);
    let status: SourceCandidateStatus;
    if (known) {
      status = 'duplicate';
    } else if (fetchError || !robotsAllowed) {
      status = 'quarantined';
    } else if (parsed.loginMentioned || parsed.accessMode === 'login') {
      status = 'access_required';
    } else if (score >= 60) {
      status = 'ready_for_review';
    } else if (score >= 30) {
      status = 'candidate';
    } else {
      status = 'quarantined';
    }
    const probe: SourceProbeEvidence = {
      ...parsed,
      finalUrl,
      robotsAllowed,
      warnings: [
        ...parsed.warnings,
        ...(fetchError ? [`页面读取失败：${fetchError}`] : []),
        ...(known ? ['该域名已经存在于本地来源注册表。'] : []),
      ],
    };
    return this.database.saveSourceCandidate({
      candidateId: randomUUID(),
      domain,
      homepage: finalUrl,
      displayName: parsed.title || domain,
      discoveredFrom,
      discoveryKind,
      status,
      score,
      probe,
      licenseSummary: parsed.licenseSummary,
      formats: parsed.formats,
      accessMode: parsed.accessMode,
    });
  }

  private isKnownOrIgnored(domain: string): boolean {
    if (SOCIAL_OR_IGNORED_DOMAINS.some((ignored) => domain.endsWith(ignored))) {
      return true;
    }
    return this.database.isKnownSourceDomain(domain);
  }
}

export function parseHomepage(html: string, baseUrl: string): SourceProbeEvidence {
  const title = decodeHtml(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '',
  ).slice(0, 160);
  const description = decodeHtml(
    html.match(
      /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i,
    )?.[1] ??
      html.match(
        /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i,
      )?.[1] ??
      '',
  ).slice(0, 500);
  const visibleText = decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).slice(0, 200_000);
  const searchable = `${title} ${description} ${visibleText}`.toLowerCase();
  const formats = [
    ['FBX', /\b(fbx)\b/i],
    ['GLB', /\b(glb)\b/i],
    ['glTF', /\b(gltf)\b/i],
    ['OBJ', /\b(obj)\b/i],
    ['Blend', /\b(blend|blender)\b/i],
    ['USDZ', /\b(usdz?|usdc|usda)\b/i],
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(searchable))
    .map(([format]) => String(format));
  const licenseMatch = searchable.match(
    /(cc0|creative commons zero|cc[ -]?by(?:[ -]?sa)?|royalty free|public domain)/i,
  );
  const modelKeywords = (
    searchable.match(/\b(3d model|3d asset|game asset|low poly|download|mesh|fbx|glb|blender)\b/g) ??
    []
  ).length;
  const links = extractLinks(html, baseUrl);
  const sampleModelLinks = links.filter((link) =>
    /(\/model|\/asset|\/download|\/3d|\.fbx|\.glb|\.obj|\.blend)/i.test(link.url),
  ).length;
  const loginMentioned =
    /\b(sign in|log in|login|register|account required|会员|登录|注册)\b/i.test(
      searchable,
    );
  const javascriptHeavy =
    (html.match(/<script\b/gi)?.length ?? 0) > 20 && visibleText.length < 800;
  const warnings = [];
  if (!formats.length) {
    warnings.push('未在页面中发现明确的模型格式。');
  }
  if (!licenseMatch) {
    warnings.push('未在首页发现明确许可信息。');
  }
  if (javascriptHeavy) {
    warnings.push('页面可能依赖 JavaScript 动态加载。');
  }

  return {
    finalUrl: baseUrl,
    title,
    description,
    robotsAllowed: false,
    licenseSummary: licenseMatch?.[1] ?? null,
    formats,
    modelKeywords,
    sampleModelLinks,
    loginMentioned,
    javascriptHeavy,
    accessMode: loginMentioned ? 'login' : 'public_html',
    warnings,
  };
}

export function scoreProbe(
  probe: SourceProbeEvidence,
  robotsAllowed: boolean,
): number {
  let score = 0;
  score += Math.min(probe.modelKeywords * 4, 24);
  score += Math.min(probe.sampleModelLinks * 3, 21);
  score += Math.min(probe.formats.length * 6, 24);
  if (probe.licenseSummary) {
    score += 18;
  }
  if (robotsAllowed) {
    score += 8;
  }
  if (!probe.javascriptHeavy) {
    score += 5;
  }
  return Math.min(Math.round(score), 100);
}

function extractLinks(
  html: string,
  baseUrl: string,
): Array<{ url: string; text: string }> {
  const output: Array<{ url: string; text: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(decodeHtml(match[1] ?? ''), baseUrl).toString();
      if (!/^https?:\/\//i.test(url)) {
        continue;
      }
      output.push({
        url,
        text: decodeHtml((match[2] ?? '').replace(/<[^>]+>/g, ' ')).slice(0, 200),
      });
    } catch {
      // Ignore malformed links.
    }
  }
  return output;
}

function looksLikeAssetSite(url: string, text: string, domain: string): boolean {
  const value = `${url} ${text} ${domain}`.toLowerCase();
  return /(3d|model|asset|mesh|poly|download|cc0|game.?art)/.test(value);
}

function normalizedDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      Accept: 'text/html',
      'User-Agent': 'ModelSearchWorkbench/0.1 source-discovery',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.text()).slice(0, 2_000_000);
}

async function probeRobots(url: URL): Promise<boolean> {
  try {
    const robotsUrl = new URL('/robots.txt', url);
    const response = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'ModelSearchWorkbench/0.1 source-discovery' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      return true;
    }
    const text = (await response.text()).slice(0, 200_000);
    const groups = text.split(/\n\s*\n/);
    return !groups.some(
      (group) =>
        /user-agent:\s*\*/i.test(group) &&
        /disallow:\s*\/\s*(?:$|\n)/im.test(group),
    );
  } catch {
    return true;
  }
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)));
}
