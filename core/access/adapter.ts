/**
 * Site-specific authenticated download integration point.
 *
 * The generic Access Manager owns profiles, encrypted credentials, isolated
 * browser sessions, pending actions and session checks. A future adapter uses
 * a scoped session handle to perform the site's actual authenticated download.
 * Secrets are intentionally absent from this interface.
 */
export interface AuthenticatedAccessAdapter {
  readonly sourceId: string;
  readonly loginUrl: string;

  checkPermission(input: {
    sessionHandle: string;
    assetUrl: string;
  }): Promise<{
    allowed: boolean;
    reason?: string;
    requiresClaim?: boolean;
    quotaRemaining?: number;
  }>;

  resolveDownload(input: {
    sessionHandle: string;
    assetUrl: string;
  }): Promise<{
    url: string;
    filename?: string;
    expiresAt?: string;
  }>;
}
