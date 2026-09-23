export interface SpecialtyDecisionMeta {
  schemaVersion: 3;
  episodeId: string;
  decisionId: string;
  recordDate: string;
  source: 'manual' | 'rule' | 'manual_ai';
  actorUid: string;
  decidedAt: string;
  rule?: { id: string; revision: number; catalogRevision: number };
  ai?: { requestId: string; model: string; promptVersion: string };
}

export interface SpecialtyIntent {
  kind: 'manual' | 'accept_ai';
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  episodeId: string;
  value: string;
  expectedDecisionId: string | null;
  requestId?: string;
}

export type SpecialtyManualIntent = SpecialtyIntent;
