export type SourceCandidateStatus =
  | 'candidate'
  | 'probing'
  | 'ready_for_review'
  | 'access_required'
  | 'duplicate'
  | 'quarantined'
  | 'approved'
  | 'rejected'
  | 'error';

export interface SourceProbeEvidence {
  finalUrl: string;
  title: string;
  description: string;
  robotsAllowed: boolean;
  licenseSummary: string | null;
  formats: string[];
  modelKeywords: number;
  sampleModelLinks: number;
  loginMentioned: boolean;
  javascriptHeavy: boolean;
  accessMode: string;
  warnings: string[];
}

export interface SourceCandidateRecord {
  candidateId: string;
  domain: string;
  homepage: string;
  displayName: string;
  discoveredFrom: string;
  discoveryKind: string;
  status: SourceCandidateStatus;
  score: number;
  probe: SourceProbeEvidence | null;
  licenseSummary: string | null;
  formats: string[];
  accessMode: string | null;
  lastProbeAt: string | null;
  createdAt: string;
}

export interface SourceCandidateOverview {
  candidates: SourceCandidateRecord[];
  autoDiscoveryEnabled: boolean;
  lastScanAt: string | null;
}

export interface SourceDiscoveryResult {
  created: number;
  probed: number;
  duplicates: number;
  failed: number;
}
