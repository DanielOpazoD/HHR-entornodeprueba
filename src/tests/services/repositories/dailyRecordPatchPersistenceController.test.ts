import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';

const {
  applyPatchesMock,
  normalizeDailyRecordInvariantsMock,
  ensureDailyRecordDateTimestampMock,
  isSpecialistScopedDailyRecordPatchMock,
  touchDailyRecordLastUpdatedMock,
  validateAndSalvageRecordMock,
  addClinicalFhirPatchesForTouchedBedsMock,
  assertAdmissionDatePersistencePolicyMock,
  logErrorMock,
} = vi.hoisted(() => ({
  applyPatchesMock: vi.fn(),
  normalizeDailyRecordInvariantsMock: vi.fn(),
  ensureDailyRecordDateTimestampMock: vi.fn(),
  isSpecialistScopedDailyRecordPatchMock: vi.fn(),
  touchDailyRecordLastUpdatedMock: vi.fn(),
  validateAndSalvageRecordMock: vi.fn(),
  addClinicalFhirPatchesForTouchedBedsMock: vi.fn(),
  assertAdmissionDatePersistencePolicyMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('@/utils/patchUtils', () => ({
  applyPatches: applyPatchesMock,
}));

vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: normalizeDailyRecordInvariantsMock,
}));

vi.mock('@/services/repositories/dailyRecordDomainServices', () => ({
  ensureDailyRecordDateTimestamp: ensureDailyRecordDateTimestampMock,
  isSpecialistScopedDailyRecordPatch: isSpecialistScopedDailyRecordPatchMock,
  touchDailyRecordLastUpdated: touchDailyRecordLastUpdatedMock,
  addClinicalFhirPatchesForTouchedBeds: addClinicalFhirPatchesForTouchedBedsMock,
}));

vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: validateAndSalvageRecordMock,
}));

vi.mock('@/services/repositories/dailyRecordAdmissionDateWritePolicy', () => ({
  assertAdmissionDatePersistencePolicy: assertAdmissionDatePersistencePolicyMock,
}));

vi.mock('@/services/utils/errorService', () => ({
  logError: logErrorMock,
}));

describe('dailyRecordPatchPersistenceController', () => {
  const current = {
    date: '2026-04-19',
    lastUpdated: '2026-04-19T00:00:00.000Z',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
  } as unknown as DailyRecord;

  beforeEach(() => {
    vi.clearAllMocks();
    const patched = { ...current, dateTimestamp: 123 } as DailyRecord;
    applyPatchesMock.mockReturnValue(patched);
    normalizeDailyRecordInvariantsMock.mockReturnValue({
      record: patched,
      patches: { 'beds.R2': { bedId: 'R2' } },
    });
    validateAndSalvageRecordMock.mockImplementation((record: DailyRecord) => record);
    isSpecialistScopedDailyRecordPatchMock.mockReturnValue(false);
  });

  it('merges invariant repairs into the outgoing patch for non-specialist updates', () => {
    const patch: DailyRecordPatch = { 'beds.R1.patientName': 'Paciente Demo' };

    const result = preparePatchedRecordPersistence(current, '2026-04-19', patch);

    expect(result.mergedPatches).toMatchObject({
      'beds.R1.patientName': 'Paciente Demo',
      dateTimestamp: 123,
      'beds.R2': { bedId: 'R2' },
    });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('merges movement-bed consistency repairs into the outgoing patch', () => {
    const patched = {
      ...current,
      beds: {
        R1: {
          bedId: 'R1',
          patientName: 'Paciente Egresado',
          rut: '33.333.333-3',
          pathology: 'Diagnostico cache antiguo',
          admissionDate: '2026-02-10',
          status: 'Estable',
          bedMode: 'Cama',
          hasCompanionCrib: false,
        },
      },
      discharges: [
        {
          id: 'discharge-1',
          bedId: 'R1',
          patientName: 'Paciente Egresado',
          rut: '33.333.333-3',
          admissionDate: '2026-02-10',
          status: 'Vivo',
          movementDate: '2026-02-18',
        },
      ],
    } as unknown as DailyRecord;
    applyPatchesMock.mockReturnValue(patched);
    normalizeDailyRecordInvariantsMock.mockReturnValue({
      record: patched,
      patches: {},
    });

    const result = preparePatchedRecordPersistence(current, '2026-04-19', {
      discharges: patched.discharges,
    } as DailyRecordPatch);

    expect(result.mergedPatches['beds.R1']).toMatchObject({
      bedId: 'R1',
      patientName: '',
      rut: '',
    });
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('logs clinically reviewable context when invariant repairs are merged', () => {
    const patch: DailyRecordPatch = { 'beds.R1.patientName': 'Paciente Demo' };

    preparePatchedRecordPersistence(current, '2026-04-19', patch);

    expect(logErrorMock).toHaveBeenCalledWith(
      'Invariant repair applied on updatePartial',
      undefined,
      expect.objectContaining({
        date: '2026-04-19',
        operation: 'updatePartial',
        patches: ['beds.R2'],
        repairPaths: ['beds.R2'],
        touchedPaths: ['beds.R1.patientName'],
        impactedContexts: ['clinical'],
        samplePaths: ['beds.R2'],
        assessment: expect.objectContaining({
          riskLevel: 'medium',
          reviewRecommended: true,
          reviewReasons: expect.arrayContaining([
            'clinical_invariant_repair',
            'clinical_patch_with_structural_repair',
          ]),
          runbookActions: expect.arrayContaining([
            'Validar que el merge preserve camas y pacientes antes de reintentar.',
          ]),
        }),
      })
    );
  });

  it('passes touched paths to admission-date policy so unrelated beds do not block patches', () => {
    const patch: DailyRecordPatch = {
      'beds.R3.pathology': 'Diagnostico actualizado',
      handoffNoteDayShift: 'Entrega actualizada',
    };

    preparePatchedRecordPersistence(current, '2026-04-19', patch);

    expect(assertAdmissionDatePersistencePolicyMock).toHaveBeenCalledWith(
      '2026-04-19',
      expect.any(Object),
      current,
      {
        changedPaths: ['beds.R3.pathology', 'handoffNoteDayShift'],
      }
    );
  });

  it('skips structural invariant repairs for specialist-scoped patches', () => {
    isSpecialistScopedDailyRecordPatchMock.mockReturnValue(true);
    const patch: DailyRecordPatch = { 'beds.R1.medicalHandoffNote': 'Nota especialista' };

    const result = preparePatchedRecordPersistence(current, '2026-04-19', patch);

    expect(result.mergedPatches).toMatchObject({
      'beds.R1.medicalHandoffNote': 'Nota especialista',
      dateTimestamp: 123,
    });
    expect(result.mergedPatches).not.toHaveProperty('beds.R2');
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('merges Rayen history against the freshest persistence base', () => {
    const fresh = {
      ...current,
      rayenSyncHistory: [
        {
          id: 'remote-run',
          startedAt: '2026-04-19T09:00:00.000Z',
          by: 'Otra pestaña',
          status: 'complete',
        },
      ],
    } as DailyRecord;
    applyPatchesMock.mockImplementation((record: DailyRecord, patch: DailyRecordPatch) => ({
      ...record,
      ...patch,
      dateTimestamp: 123,
    }));
    normalizeDailyRecordInvariantsMock.mockImplementation((record: DailyRecord) => ({
      record,
      patches: {},
    }));

    const result = preparePatchedRecordPersistence(fresh, '2026-04-19', {
      rayenSyncHistory: [
        {
          id: 'local-run',
          startedAt: '2026-04-19T10:00:00.000Z',
          by: 'Esta pestaña',
          status: 'failed',
          failureReason: 'snapshot_timeout',
        },
      ],
    });

    expect(result.mergedPatches.rayenSyncHistory?.map(event => event.id)).toEqual([
      'local-run',
      'remote-run',
    ]);
  });
});
