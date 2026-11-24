import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetDatabase } from '../core/database';
import {
  parseHomepage,
  scoreProbe,
} from '../core/discovery/source-discovery';
import type { SourceProbeEvidence } from '../core/discovery/source-types';

const appRoot = process.cwd();

describe('Source discovery', () => {
  let tempDir: string;
  let database: AssetDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'model-search-sources-'));
    database = new AssetDatabase({
      databasePath: join(tempDir, 'test.db'),
      migrationsDir: join(appRoot, 'database', 'migrations'),
      registryPath: join(appRoot, 'sources.merged.json'),
    });
    database.seedSources();
  });

  afterEach(() => {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('extracts useful source evidence from a public homepage', () => {
    const html = `
      <html>
        <head>
          <title>Free Low Poly 3D Models</title>
          <meta name="description" content="Download CC0 FBX and GLB game assets." />
        </head>
        <body>
          <a href="/models/crate">Crate FBX</a>
          <a href="/models/tree">Tree GLB</a>
          <a href="/models/rock">Rock OBJ</a>
        </body>
      </html>
    `;
    const probe = parseHomepage(html, 'https://example.com');
    expect(probe.title).toContain('Low Poly');
    expect(probe.formats).toEqual(expect.arrayContaining(['FBX', 'GLB', 'OBJ']));
    expect(probe.licenseSummary).toBeTruthy();
    expect(probe.sampleModelLinks).toBeGreaterThanOrEqual(3);
    expect(scoreProbe(probe, true)).toBeGreaterThanOrEqual(60);
  });

  it('approves discovered candidates into a disabled source record', () => {
    const probe: SourceProbeEvidence = {
      finalUrl: 'https://new-models.example',
      title: 'New Models',
      description: 'Free game models',
      robotsAllowed: true,
      licenseSummary: 'CC0',
      formats: ['FBX', 'GLB'],
      modelKeywords: 8,
      sampleModelLinks: 6,
      loginMentioned: false,
      javascriptHeavy: false,
      accessMode: 'public_html',
      warnings: [],
    };
    const candidate = database.saveSourceCandidate({
      candidateId: 'candidate-1',
      domain: 'new-models.example',
      homepage: probe.finalUrl,
      displayName: 'New Models',
      discoveredFrom: 'manual',
      discoveryKind: 'manual',
      status: 'ready_for_review',
      score: 88,
      probe,
      licenseSummary: 'CC0',
      formats: ['FBX', 'GLB'],
      accessMode: 'public_html',
    });
    expect(candidate.status).toBe('ready_for_review');

    const sourceId = database.approveSourceCandidate(candidate.candidateId);
    const source = database
      .listSources({ query: 'new-models', filter: 'all' })
      .find((entry) => entry.sourceId === sourceId);
    expect(source?.connectorStatus).toBe('candidate_approved');
    expect(source?.enabled).toBe(false);
    expect(
      database
        .listSourceCandidates()
        .find((entry) => entry.candidateId === candidate.candidateId)?.status,
    ).toBe('approved');
  });
});
