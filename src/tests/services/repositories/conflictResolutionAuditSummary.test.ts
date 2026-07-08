import { describe, expect, it } from 'vitest';
import {
  buildConflictAuditSummary,
  buildConflictAutoMergeAuditDetails,
} from '@/services/repositories/conflictResolutionAuditSummary';

describe('conflictResolutionAuditSummary', () => {
  it('builds strategy/winner/reason breakdown for trace entries', () => {
    const summary = buildConflictAuditSummary(['beds.R1.pathology'], '2026-03-v3', [
      {
        path: 'beds.R1.pathology',
        strategy: 'scalar_policy',
        winner: 'local',
        reason: 'clinical_local_priority',
      },
      {
        path: 'beds.R1.location',
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'admin_remote_priority',
      },
    ]);

    expect(summary.policyVersion).toBe('2026-03-v3');
    expect(summary.impactedContexts).toEqual(['clinical']);
    expect(summary.entryCount).toBe(2);
    expect(summary.strategyBreakdown.scalar_policy).toBe(2);
    expect(summary.winnerBreakdown.local).toBe(1);
    expect(summary.winnerBreakdown.remote).toBe(1);
    expect(summary.reasonBreakdown.clinical_local_priority).toBe(1);
    expect(summary.reasonBreakdown.admin_remote_priority).toBe(1);
    expect(summary.sampleDecisions).toEqual([
      {
        path: 'beds.R1.pathology',
        strategy: 'scalar_policy',
        winner: 'local',
        reason: 'clinical_local_priority',
      },
      {
        path: 'beds.R1.location',
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'admin_remote_priority',
      },
    ]);
    expect(summary.assessment.riskLevel).toBe('low');
    expect(summary.assessment.reviewRecommended).toBe(false);
  });

  it('flags wildcard merges that preserve remote-protected paths for review', () => {
    const summary = buildConflictAuditSummary(['*'], '2026-03-v3', [
      {
        path: 'beds.R1.pathology',
        strategy: 'scalar_policy',
        winner: 'local',
        reason: 'clinical_local_priority',
      },
      {
        path: 'beds.R1.location',
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'admin_remote_priority',
      },
    ]);

    expect(summary.assessment.riskLevel).toBe('high');
    expect(summary.impactedContexts).toEqual([
      'clinical',
      'staffing',
      'movements',
      'handoff',
      'metadata',
    ]);
    expect(summary.assessment.reviewRecommended).toBe(true);
    expect(summary.assessment.reviewReasons).toContain('remote_protected_fields_preserved');
    expect(summary.assessment.reviewReasons).toContain(
      'wildcard_merge_with_remote_protected_fields'
    );
    expect(summary.assessment.remoteProtectedPaths).toContain('beds.R1.location');
  });

  it('tracks staffing and metadata contexts explicitly in audit summaries', () => {
    const summary = buildConflictAuditSummary(['nursesDayShift', 'schemaVersion'], '2026-03-v3', [
      {
        path: 'nursesDayShift',
        strategy: 'merge_unique_primitive_array',
        winner: 'merged',
        reason: 'staffing_union_prefer_local_order',
      },
      {
        path: 'schemaVersion',
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'metadata_remote_priority',
      },
    ]);

    expect(summary.impactedContexts).toEqual(['staffing', 'metadata']);
    expect(summary.assessment.remoteProtectedPaths).toContain('schemaVersion');
  });

  it('builds conflict auto-merge audit details with recovery evidence', () => {
    const details = buildConflictAutoMergeAuditDetails({
      changedPaths: ['discharges'],
      policyVersion: '2026-03-v3',
      traceEntries: [
        {
          path: 'discharges',
          strategy: 'merge_array_by_id',
          winner: 'merged',
          reason: 'remote_snapshot_priority_preserve_local_movements',
        },
      ],
      conflictId: 'c_2026-07-01_remote_local',
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['cid__remote_premerge', 'cid__incoming_premerge'],
        origins: ['remote_premerge', 'incoming_premerge'],
        ttlMs: 172800000,
      },
      syncContract: {
        mutationId: 'mutation-visible-123',
        clientId: 'client-real-browser-id',
        tabId: 'tab-real-browser-id',
        changedPaths: ['discharges'],
      },
    });

    expect(details).toMatchObject({
      conflictId: 'c_2026-07-01_remote_local',
      changedPaths: ['discharges'],
      entryCount: 1,
      sampleDecisions: [
        expect.objectContaining({
          path: 'discharges',
          winner: 'merged',
        }),
      ],
      snapshotRecovery: expect.objectContaining({
        status: 'saved',
        snapshotIds: ['cid__remote_premerge', 'cid__incoming_premerge'],
      }),
      conflictResolutionSummary: expect.objectContaining({
        truthSource: 'authority_intent_invariants',
        lastWriteWins: false,
        mergedPaths: ['discharges'],
        blockedPaths: [],
        invariantChecks: expect.arrayContaining([
          'movement_visible_after_merge',
          'no_duplicate_active_patient',
          'movement_tombstone_not_revived',
        ]),
        mutation: expect.objectContaining({
          mutationId: 'mutation-visible-123',
          clientId: expect.stringMatching(/^anon_/),
          tabId: expect.stringMatching(/^anon_/),
        }),
      }),
    });
    expect(JSON.stringify(details.conflictResolutionSummary)).not.toContain(
      'client-real-browser-id'
    );
    expect(JSON.stringify(details.conflictResolutionSummary)).not.toContain('tab-real-browser-id');
  });
});
