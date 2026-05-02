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
});
