import { ConflictResolutionTraceEntry } from '@/services/repositories/conflictResolutionTrace';
import {
  assessConflictResolutionTrace,
  ConflictResolutionAssessment,
} from '@/services/repositories/conflictResolutionAssessment';
import {
  classifyConflictChangedContexts,
  type ConflictDomainContext,
} from '@/services/repositories/conflictResolutionDomainPolicy';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';

export type ConflictAuditDecisionSample = Pick<
  ConflictResolutionTraceEntry,
  'path' | 'strategy' | 'winner' | 'reason'
>;

export interface ConflictAuditSummary {
  changedPaths: string[];
  impactedContexts: ConflictDomainContext[];
  policyVersion: string;
  entryCount: number;
  strategyBreakdown: Record<string, number>;
  winnerBreakdown: Record<string, number>;
  reasonBreakdown: Record<string, number>;
  samplePaths: string[];
  sampleDecisions: ConflictAuditDecisionSample[];
  assessment: ConflictResolutionAssessment;
}

export interface ConflictAutoMergeSnapshotRecovery {
  status: 'saved' | 'failed';
  snapshotIds: string[];
  origins: string[];
  expiresAt?: string;
  ttlMs?: number;
}

export interface ConflictAutoMergeAuditDetailsInput {
  changedPaths: string[];
  policyVersion: string;
  traceEntries: ConflictResolutionTraceEntry[];
  conflictId: string;
  snapshotRecovery: ConflictAutoMergeSnapshotRecovery;
  syncContract?: SyncTaskContract;
}

export interface ConflictResolutionTruthSummary {
  truthSource: 'authority_intent_invariants';
  lastWriteWins: false;
  mergedPaths: string[];
  blockedPaths: string[];
  invariantChecks: string[];
  mutation?: {
    mutationId?: string;
    mutationIds?: string[];
    clientId?: string;
    tabId?: string;
  };
}

const countBy = (items: string[]): Record<string, number> =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});

const invariantChecks = [
  'movement_visible_after_merge',
  'no_duplicate_active_patient',
  'movement_tombstone_not_revived',
];

const dedupe = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

const hashIdentifier = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `anon_${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const summarizeMutation = (
  syncContract: SyncTaskContract | undefined
): ConflictResolutionTruthSummary['mutation'] | undefined => {
  if (!syncContract) return undefined;
  return {
    ...(syncContract.mutationId ? { mutationId: syncContract.mutationId } : {}),
    ...(syncContract.mutationIds?.length ? { mutationIds: syncContract.mutationIds } : {}),
    ...(syncContract.clientId ? { clientId: hashIdentifier(syncContract.clientId) } : {}),
    ...(syncContract.tabId ? { tabId: hashIdentifier(syncContract.tabId) } : {}),
  };
};

const buildConflictResolutionTruthSummary = (
  traceEntries: ConflictResolutionTraceEntry[],
  assessment: ConflictResolutionAssessment,
  syncContract: SyncTaskContract | undefined
): ConflictResolutionTruthSummary => {
  const mutation = summarizeMutation(syncContract);
  return {
    truthSource: 'authority_intent_invariants',
    lastWriteWins: false,
    mergedPaths: dedupe(
      traceEntries.filter(entry => entry.winner === 'merged').map(entry => entry.path)
    ).slice(0, 20),
    blockedPaths: assessment.remoteProtectedPaths,
    invariantChecks,
    ...(mutation ? { mutation } : {}),
  };
};

export const buildConflictAuditSummary = (
  changedPaths: string[],
  policyVersion: string,
  traceEntries: ConflictResolutionTraceEntry[]
): ConflictAuditSummary => ({
  changedPaths,
  impactedContexts: classifyConflictChangedContexts(changedPaths),
  policyVersion,
  entryCount: traceEntries.length,
  strategyBreakdown: countBy(traceEntries.map(entry => entry.strategy)),
  winnerBreakdown: countBy(traceEntries.map(entry => entry.winner)),
  reasonBreakdown: countBy(traceEntries.map(entry => entry.reason)),
  samplePaths: Array.from(new Set(traceEntries.map(entry => entry.path))).slice(0, 20),
  sampleDecisions: traceEntries
    .slice(0, 20)
    .map(({ path, strategy, winner, reason }) => ({ path, strategy, winner, reason })),
  assessment: assessConflictResolutionTrace(changedPaths, traceEntries),
});

export const buildConflictAutoMergeAuditDetails = ({
  changedPaths,
  policyVersion,
  traceEntries,
  conflictId,
  snapshotRecovery,
  syncContract,
}: ConflictAutoMergeAuditDetailsInput): ConflictAuditSummary & {
  conflictId: string;
  snapshotRecovery: ConflictAutoMergeSnapshotRecovery;
  conflictResolutionSummary: ConflictResolutionTruthSummary;
} => ({
  ...buildConflictAuditSummary(changedPaths, policyVersion, traceEntries),
  conflictId,
  snapshotRecovery,
  conflictResolutionSummary: buildConflictResolutionTruthSummary(
    traceEntries,
    assessConflictResolutionTrace(changedPaths, traceEntries),
    syncContract
  ),
});
