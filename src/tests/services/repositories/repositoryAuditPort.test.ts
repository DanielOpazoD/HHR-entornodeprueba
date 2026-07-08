import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditMocks = vi.hoisted(() => ({
  executeWriteAuditEvent: vi.fn(),
  getCurrentUserEmail: vi.fn(() => 'doctor@hospital.cl'),
}));

vi.mock('@/application/audit/writeAuditEventUseCase', () => ({
  executeWriteAuditEvent: auditMocks.executeWriteAuditEvent,
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: auditMocks.getCurrentUserEmail,
}));

import {
  logRepositoryConflictAutoMerged,
  logRepositoryConflictVersionRestored,
  setRepositoryConflictLogger,
} from '@/services/repositories/ports/repositoryAuditPort';

describe('repositoryAuditPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditMocks.executeWriteAuditEvent.mockResolvedValue({ status: 'success', data: null });
    setRepositoryConflictLogger(null);
  });

  it('uses injected logger when available', async () => {
    const logger = vi.fn().mockResolvedValue(undefined);
    setRepositoryConflictLogger(logger);

    await logRepositoryConflictAutoMerged('2026-02-19', {
      changedPaths: ['*'],
      policyVersion: '2026-02-v2',
      entryCount: 1,
      strategyBreakdown: { scalar_policy: 1 },
      winnerBreakdown: { local: 1 },
      reasonBreakdown: { default_local_priority: 1 },
      samplePaths: ['beds.R1.pathology'],
      assessment: {
        riskLevel: 'low',
        reviewRecommended: false,
        reviewReasons: [],
        localDominantPaths: ['beds.R1.pathology'],
        remoteProtectedPaths: [],
      },
    });

    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('writes conflict auto-merge events through the modern audit use case', async () => {
    const details = {
      changedPaths: ['beds.R1.pathology'],
      policyVersion: '2026-02-v2',
      entryCount: 1,
      strategyBreakdown: { scalar_policy: 1 },
      winnerBreakdown: { local: 1 },
      reasonBreakdown: { default_local_priority: 1 },
      samplePaths: ['beds.R1.pathology'],
      assessment: {
        riskLevel: 'low' as const,
        reviewRecommended: false,
        reviewReasons: [],
        localDominantPaths: ['beds.R1.pathology'],
        remoteProtectedPaths: [],
      },
    };

    await logRepositoryConflictAutoMerged('2026-02-19', details);

    expect(auditMocks.executeWriteAuditEvent).toHaveBeenCalledWith({
      userId: 'doctor@hospital.cl',
      action: 'CONFLICT_AUTO_MERGED',
      entityType: 'dailyRecord',
      entityId: '2026-02-19',
      details,
      recordDate: '2026-02-19',
    });
  });

  it('throws when the auto-merge audit outcome is not successful (no longer silently dropped)', async () => {
    auditMocks.executeWriteAuditEvent.mockResolvedValueOnce({
      status: 'failed',
      data: null,
      issues: [{ kind: 'unknown', message: 'audit write failed' }],
    });

    await expect(
      logRepositoryConflictAutoMerged('2026-02-19', {
        changedPaths: ['beds.R1.pathology'],
        policyVersion: '2026-02-v2',
        entryCount: 1,
        strategyBreakdown: { scalar_policy: 1 },
        winnerBreakdown: { local: 1 },
        reasonBreakdown: { default_local_priority: 1 },
        samplePaths: ['beds.R1.pathology'],
        assessment: {
          riskLevel: 'low' as const,
          reviewRecommended: false,
          reviewReasons: [],
          localDominantPaths: ['beds.R1.pathology'],
          remoteProtectedPaths: [],
        },
      })
    ).rejects.toThrow('audit write failed');
  });

  it('writes conflict version restore events through the modern audit use case', async () => {
    await logRepositoryConflictVersionRestored('2026-02-19', {
      snapshotId: 'cid__remote_premerge',
      origin: 'remote_premerge',
      conflictId: 'cid',
      reviewContext: {
        source: 'clinical_conflict_center',
        scope: 'nursing_handoff',
        reason: 'manual_preserve_selected_truth',
        selectedVersionLabel: 'Versión en la nube',
        modules: [{ key: 'nursing_handoff', label: 'Entrega enfermería' }],
        patientContexts: [
          { patientName: 'Pierre Jean', rut: '25DF52626', bedName: 'H1', bedId: 'H1' },
        ],
        changedFields: [
          {
            path: 'beds.H1.handoffNoteDayShift',
            module: 'nursing_handoff',
            label: 'Nota enfermería turno largo',
            before: 'A',
            after: 'B',
            bedId: 'H1',
          },
        ],
      },
    });

    expect(auditMocks.executeWriteAuditEvent).toHaveBeenCalledWith({
      userId: 'doctor@hospital.cl',
      action: 'CONFLICT_VERSION_RESTORED',
      entityType: 'dailyRecord',
      entityId: '2026-02-19',
      details: {
        snapshotId: 'cid__remote_premerge',
        origin: 'remote_premerge',
        conflictId: 'cid',
        reviewContext: expect.objectContaining({
          source: 'clinical_conflict_center',
          scope: 'nursing_handoff',
          selectedVersionLabel: 'Versión en la nube',
        }),
      },
      recordDate: '2026-02-19',
    });
  });

  it('throws when the restore audit outcome is not successful (fail-closed signal)', async () => {
    auditMocks.executeWriteAuditEvent.mockResolvedValueOnce({
      status: 'failed',
      data: null,
      issues: [{ kind: 'anonymous_clinical_audit_rejection', message: 'Actor anónimo' }],
    });

    await expect(
      logRepositoryConflictVersionRestored('2026-02-19', {
        snapshotId: 's1',
        origin: 'incoming_premerge',
      })
    ).rejects.toThrow('Actor anónimo');
  });
});
