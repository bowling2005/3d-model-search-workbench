import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RegistrySource, SourceRegistry } from './types';

const aliasSchema = z.object({
  name: z.string(),
  url: z.string(),
  kind: z.string(),
});

const userMetadataSchema = z.object({
  region_language: z.string(),
  license_summary: z.string(),
  formats: z.string(),
  recommended_use: z.string(),
  notes: z.string(),
});

const seedEntrySchema = userMetadataSchema.extend({
  row_id: z.string(),
  name: z.string(),
  url: z.string(),
});

const upstreamSchema = z.object({
  source_id: z.string(),
  access: z.string(),
  added_at: z.string(),
  added_by: z.string(),
});

const sourceSchema = z.object({
  source_id: z.string().min(1),
  display_name: z.string().min(1),
  homepage: z.string().url(),
  domains: z.array(z.string().min(1)).min(1),
  aliases: z.array(aliasSchema).default([]),
  provenance: z.object({
    upstream_3d_asset_server: upstreamSchema.nullable(),
    user_catalog_row_ids: z.array(z.union([z.string(), z.number()])).default([]),
  }),
  user_metadata: userMetadataSchema.nullable().optional().default(null),
  seed_entries: z.array(seedEntrySchema).default([]),
  access: z.object({
    upstream_mode: z.string().nullable(),
    search: z.string(),
    license_metadata: z.string(),
    download: z.string(),
    auth_required: z.string(),
    entitlement_required: z.string(),
    rate_limit: z.string(),
    requires_live_probe: z.boolean(),
  }),
  connector_status: z.string().min(1),
  enabled: z.boolean(),
  notes: z.array(z.string()).default([]),
});

const registrySchema = z.object({
  schema_version: z.string(),
  generated_at: z.string(),
  merge_summary: z.object({
    raw_input_rows: z.number(),
    upstream_sources: z.number(),
    merged_sources: z.number(),
    user_unique_sources: z.number(),
    overlap_source_count: z.number(),
    upstream_only_sources: z.number(),
    user_only_sources: z.number(),
  }),
  sources: z.array(sourceSchema).min(30),
});

export function loadSourceRegistry(path: string): SourceRegistry {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const parsed = registrySchema.parse(raw);

  const normalizedSources: RegistrySource[] = parsed.sources.map((source) => ({
    ...source,
    provenance: {
      ...source.provenance,
      user_catalog_row_ids: source.provenance.user_catalog_row_ids.map(String),
    },
  }));

  const uniqueIds = new Set(normalizedSources.map((source) => source.source_id));
  if (uniqueIds.size !== normalizedSources.length) {
    throw new Error('Source registry contains duplicate source IDs.');
  }

  const uniqueDomains = new Set<string>();
  for (const source of normalizedSources) {
    for (const domain of source.domains) {
      const normalized = domain.toLowerCase();
      if (uniqueDomains.has(normalized)) {
        throw new Error(`Source registry contains duplicate domain: ${normalized}`);
      }
      uniqueDomains.add(normalized);
    }
  }

  return {
    ...parsed,
    sources: normalizedSources,
  };
}
