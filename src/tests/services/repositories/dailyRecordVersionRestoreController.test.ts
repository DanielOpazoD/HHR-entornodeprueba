import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/firestore/dailyRecordConflictSnapshotService', () => ({
  getConflictVersionSnapshot: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
}));
vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictVersionRestored: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: vi.fn(),
}));

import { getConflictVersionSnapshot } from '@/services/storage/firestore/dailyRecordConflictSnapshotService';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { logRepositoryConflictVersionRestored } from '@/services/repositories/ports/repositoryAuditPort';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { restoreDailyRecordVersion } from '@/services/repositories/dailyRecordVersionRestoreController';

describe('restoreDailyRecordVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atomically restores the snapshot over the current version and audits it', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 'cid__remote_premerge',
      origin: 'remote_premerge',
      conflictId: 'cid',
      record: { date: '2026-06-26', beds: { R1: { patientName: 'Remoto' } } } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      date: '2026-06-26',
      lastUpdated: '2026-06-26T12:00:00.000Z',
    } as never);

    const result = await restoreDailyRecordVersion('2026-06-26', 'cid__remote_premerge', {
      source: 'clinical_conflict_center',
      scope: 'census',
      reason: 'manual_preserve_selected_truth',
      selectedVersionLabel: 'Versión en la nube',
      modules: [{ key: 'census', label: 'Censo diario' }],
      patientContexts: [{ patientName: 'Remoto', bedName: 'R1', bedId: 'R1' }],
      changedFields: [],
    });

    expect(result).toEqual({ status: 'restored' });
    // Atomic full-save with the CURRENT version as base (CAS-safe, non-destructive).
    expect(saveRecordToFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-26', beds: { R1: { patientName: 'Remoto' } } }),
      '2026-06-26T12:00:00.000Z'
    );
    expect(logRepositoryConflictVersionRestored).toHaveBeenCalledWith('2026-06-26', {
      snapshotId: 'cid__remote_premerge',
      origin: 'remote_premerge',
      conflictId: 'cid',
      reviewContext: expect.objectContaining({
        source: 'clinical_conflict_center',
        scope: 'census',
        selectedVersionLabel: 'Versión en la nube',
      }),
    });
  });

  it('returns not_found and writes nothing when the snapshot is missing', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue(null);

    const result = await restoreDailyRecordVersion('2026-06-26', 'missing');

    expect(result).toEqual({ status: 'not_found' });
    expect(saveRecordToFirestore).not.toHaveBeenCalled();
    expect(logRepositoryConflictVersionRestored).not.toHaveBeenCalled();
  });

  it('fails closed when the audit fails: aborts before saving (no unaudited overwrite)', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 's1',
      origin: 'incoming_premerge',
      record: { date: '2026-06-26', beds: {} } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      date: '2026-06-26',
      lastUpdated: '2026-06-26T12:00:00.000Z',
    } as never);
    vi.mocked(logRepositoryConflictVersionRestored).mockRejectedValueOnce(new Error('audit down'));

    await expect(restoreDailyRecordVersion('2026-06-26', 's1')).rejects.toThrow('audit down');
    // The live record is never overwritten when the restore cannot be audited.
    expect(saveRecordToFirestore).not.toHaveBeenCalled();
  });

  it('blocks restore before audit/save when the selected snapshot would remove a current movement', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 's1',
      origin: 'remote_premerge',
      record: {
        date: '2026-06-26',
        beds: { R1: { patientName: 'Snapshot Antiguo', rut: '11.111.111-1' } },
        discharges: [],
      } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      date: '2026-06-26',
      lastUpdated: '2026-06-26T18:00:00.000Z',
      beds: { R1: { patientName: 'Snapshot Antiguo', rut: '11.111.111-1' } },
      discharges: [
        {
          id: 'd-1',
          bedName: 'R2',
          bedId: 'R2',
          bedType: 'Cama',
          patientName: 'Alta Posterior',
          rut: '22.222.222-2',
          diagnosis: 'Alta posterior',
          time: '15:00',
          status: 'Vivo',
        },
      ],
    } as never);

    const result = await restoreDailyRecordVersion('2026-06-26', 's1');

    expect(result).toMatchObject({
      status: 'blocked',
      impactAnalysis: {
        risk: 'high',
        blockingImpactCount: 1,
        impactedModules: ['movements'],
      },
    });
    expect(logRepositoryConflictVersionRestored).not.toHaveBeenCalled();
    expect(saveRecordToFirestore).not.toHaveBeenCalled();
  });

  it('allows a review-required restore but records restore impact in the audit context', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 's1',
      origin: 'incoming_premerge',
      conflictId: 'cid',
      record: {
        date: '2026-06-26',
        beds: {
          R1: {
            patientName: 'Paciente Handoff',
            rut: '33.333.333-3',
            handoffNoteDayShift: '',
          },
        },
        discharges: [],
      } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      date: '2026-06-26',
      lastUpdated: '2026-06-26T18:00:00.000Z',
      beds: {
        R1: {
          patientName: 'Paciente Handoff',
          rut: '33.333.333-3',
          handoffNoteDayShift: 'Nota posterior de enfermeria',
        },
      },
      discharges: [],
    } as never);

    const result = await restoreDailyRecordVersion('2026-06-26', 's1', {
      source: 'clinical_conflict_center',
      scope: 'nursing_handoff',
      reason: 'manual_preserve_selected_truth',
      selectedVersionLabel: 'Versión local',
      modules: [{ key: 'nursing_handoff', label: 'Entrega enfermería' }],
      patientContexts: [{ patientName: 'Paciente Handoff', rut: '33.333.333-3', bedId: 'R1' }],
      changedFields: [],
    });

    expect(result).toEqual({ status: 'restored' });
    expect(logRepositoryConflictVersionRestored).toHaveBeenCalledWith('2026-06-26', {
      snapshotId: 's1',
      origin: 'incoming_premerge',
      conflictId: 'cid',
      reviewContext: expect.objectContaining({
        scope: 'nursing_handoff',
        restoreImpact: expect.objectContaining({
          risk: 'medium',
          status: 'review_required',
          blockingImpactCount: 0,
          impactedModules: ['nursing_handoff'],
          currentRevision: '2026-06-26T18:00:00.000Z',
        }),
      }),
    });
    expect(saveRecordToFirestore).toHaveBeenCalled();
  });

  it('marks restore impact as truncated when the audit payload only includes a sample', async () => {
    const currentBeds = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => {
        const bedId = `R${index + 1}`;
        return [
          bedId,
          {
            bedId,
            bedName: bedId,
            patientName: `Paciente Handoff ${index + 1}`,
            rut: `44.444.44${index}-${index}`,
            handoffNoteDayShift: `Nota posterior ${index + 1}`,
          },
        ];
      })
    );
    const selectedBeds = Object.fromEntries(
      Object.entries(currentBeds).map(([bedId, patient]) => [
        bedId,
        { ...patient, handoffNoteDayShift: '' },
      ])
    );

    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 's-many-impacts',
      origin: 'incoming_premerge',
      conflictId: 'cid-many-impacts',
      record: {
        date: '2026-06-26',
        beds: selectedBeds,
        discharges: [],
        lastUpdated: '2026-06-26T10:00:00.000Z',
      } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue({
      date: '2026-06-26',
      lastUpdated: '2026-06-26T18:00:00.000Z',
      beds: currentBeds,
      discharges: [],
    } as never);

    const result = await restoreDailyRecordVersion('2026-06-26', 's-many-impacts', {
      source: 'clinical_conflict_center',
      scope: 'nursing_handoff',
      reason: 'manual_preserve_selected_truth',
      selectedVersionLabel: 'Versión local',
      modules: [{ key: 'nursing_handoff', label: 'Entrega enfermería' }],
      patientContexts: [],
      changedFields: [],
    });

    expect(result).toEqual({ status: 'restored' });
    expect(logRepositoryConflictVersionRestored).toHaveBeenCalledWith('2026-06-26', {
      snapshotId: 's-many-impacts',
      origin: 'incoming_premerge',
      conflictId: 'cid-many-impacts',
      reviewContext: expect.objectContaining({
        restoreImpact: expect.objectContaining({
          impactCount: 13,
          impactsTruncated: true,
          impacts: expect.arrayContaining([
            expect.objectContaining({ kind: 'nursing_handoff_loss' }),
          ]),
        }),
      }),
    });
    const auditDetails = vi.mocked(logRepositoryConflictVersionRestored).mock.calls[0]?.[1];
    expect(auditDetails.reviewContext?.restoreImpact?.impacts).toHaveLength(12);
  });

  it('surfaces telemetry and rethrows when the save fails after a successful audit', async () => {
    vi.mocked(getConflictVersionSnapshot).mockResolvedValue({
      id: 's1',
      origin: 'remote_premerge',
      record: { date: '2026-06-26', beds: {} } as never,
    });
    vi.mocked(getRecordFromFirestore).mockResolvedValue(null);
    vi.mocked(saveRecordToFirestore).mockRejectedValueOnce(new Error('save down'));

    await expect(restoreDailyRecordVersion('2026-06-26', 's1')).rejects.toThrow('save down');
    // The audit already landed but the save failed — observable for reconciliation.
    expect(recordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'firestore',
      'restore_daily_record_version_save',
      expect.any(Error),
      expect.objectContaining({ code: 'firestore_conflict_restore_save_failed_post_audit' })
    );
  });
});
