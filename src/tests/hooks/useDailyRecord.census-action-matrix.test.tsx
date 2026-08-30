import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import { defaultDailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { UIProvider } from '@/context/UIContext';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { applyPatches } from '@/utils/patchUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import type { CMAData } from '@/types/domain/movements';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import {
  resetDailyRecordFreshnessGateForTests,
  markDailyRecordRemoteConfirmed,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  buildConfirmedAssociatedCribIdentity,
  buildConfirmedBedOccupantIdentity,
} from '@/hooks/controllers/intentionalBedClearController';

const { mockDailyRecordPorts } = vi.hoisted(() => ({
  mockDailyRecordPorts: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    getPreviousDay: vi.fn(),
    getAvailableDates: vi.fn(),
    getMonthRecords: vi.fn(),
    initializeDay: vi.fn(),
    save: vi.fn(),
    saveDetailed: vi.fn(),
    updatePartial: vi.fn(),
    updatePartialDetailed: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeDetailed: vi.fn(() => vi.fn()),
    syncWithFirestoreDetailed: vi.fn(),
    deleteDay: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: mockDailyRecordPorts,
  defaultDailyRecordWritePort: {
    updatePartial: mockDailyRecordPorts.updatePartialDetailed,
    save: mockDailyRecordPorts.saveDetailed,
    delete: mockDailyRecordPorts.deleteDay,
  },
  defaultDailyRecordSyncPort: {
    syncWithFirestoreDetailed: mockDailyRecordPorts.syncWithFirestoreDetailed,
  },
  defaultDailyRecordRepositoryPort: mockDailyRecordPorts,
}));

vi.mock('@/context/VersionContext', () => ({
  useVersion: () => ({
    checkVersion: vi.fn(),
    currentVersion: 1,
    isOutdated: false,
  }),
}));

vi.mock('@/application/daily-record/syncDailyRecordUseCase', () => ({
  executeSyncDailyRecord: vi.fn().mockResolvedValue({
    success: true,
    data: { date: '2026-05-17', outcome: 'clean', record: null },
  }),
}));

type CensusActionFailureClass =
  | 'lock_demasiado_amplio'
  | 'patch_mal_clasificado'
  | 'persistencia_local_sin_firebase'
  | 'optimistic_update_no_reconcilia'
  | 'ui_error_post_guardado';

type DailyRecordActions = ReturnType<typeof useDailyRecord>;

interface CensusActionMatrixCase {
  name: string;
  failureClass: CensusActionFailureClass;
  run: (actions: DailyRecordActions, record: DailyRecord) => void | Promise<void>;
  expectWrite?: () => void;
  expectPatch?: (patch: DailyRecordPatch) => void;
}

const date = '2026-05-17';

let recordsMap: Record<string, DailyRecord>;

const buildActivePatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData =>
  DataFactory.createMockPatient(bedId, {
    patientName: `Paciente ${bedId}`,
    rut: bedId === 'R1' ? '11.111.111-1' : '22.222.222-2',
    pathology: 'Diagnostico base',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: date,
    clinicalEpisodeId: `episode-${bedId}`,
    ...overrides,
  });

const buildMatrixRecord = (): DailyRecord => {
  const r1 = buildActivePatient('R1');
  const r2 = buildActivePatient('R2', { patientName: '', rut: '', pathology: '' });
  const cmaOriginal = buildActivePatient('R3', { patientName: 'Paciente CMA' });
  const dischargeOriginal = buildActivePatient('R4', { patientName: 'Paciente Alta' });
  const transferOriginal = buildActivePatient('NEO1', { patientName: 'Paciente Traslado' });
  const movementSource = buildActivePatient('R5', {
    patientName: 'Paciente R5',
    rut: '33.333.333-3',
  });
  const emptyR3 = buildActivePatient('R3', { patientName: '', rut: '', pathology: '' });
  const emptyR4 = buildActivePatient('R4', { patientName: '', rut: '', pathology: '' });
  const emptyNeo1 = buildActivePatient('NEO1', { patientName: '', rut: '', pathology: '' });
  return DataFactory.createMockDailyRecord(date, {
    beds: {
      ...DataFactory.createMockDailyRecord(date).beds,
      R1: {
        ...r1,
        clinicalCrib: buildActivePatient('R1', {
          bedMode: 'Cuna',
          patientName: 'RN R1',
          rut: '',
          pathology: 'Observacion RN',
        }),
      },
      R2: r2,
      R3: emptyR3,
      R4: emptyR4,
      R5: movementSource,
      NEO1: emptyNeo1,
    },
    discharges: [
      DataFactory.createMockDischarge({
        id: 'disc-1',
        bedId: 'R4',
        bedName: 'R4',
        patientName: dischargeOriginal.patientName,
        rut: dischargeOriginal.rut,
        originalData: dischargeOriginal,
      }),
    ],
    transfers: [
      DataFactory.createMockTransfer({
        id: 'trans-1',
        bedId: 'NEO1',
        bedName: 'NEO1',
        patientName: transferOriginal.patientName,
        rut: transferOriginal.rut,
        originalData: transferOriginal,
      }),
    ],
    cma: [
      DataFactory.createMockCMA({
        id: 'cma-1',
        bedName: 'R3',
        originalBedId: 'R3',
        patientName: cmaOriginal.patientName,
        rut: cmaOriginal.rut,
        originalData: cmaOriginal,
      }),
    ],
  });
};

const buildReadResult = (record: DailyRecord | null) => ({
  date,
  record,
  source: record ? ('firestore' as const) : ('not_found' as const),
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: record ? ('remote_authoritative' as const) : ('missing' as const),
  sourceOfTruth: record ? ('remote' as const) : ('none' as const),
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read', 'remote_authoritative'],
  repairApplied: false,
});

const createWrapper = () =>
  createQueryClientTestWrapper({
    config: {
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
        mutations: { retry: false },
      },
    },
    wrapChildren: children => <UIProvider>{children}</UIProvider>,
  }).wrapper;

const setupRecordStore = (record: DailyRecord) => {
  recordsMap = { [date]: record };
  mockDailyRecordPorts.getForDate.mockImplementation(async requestedDate => {
    return recordsMap[requestedDate] ?? null;
  });
  mockDailyRecordPorts.getForDateWithMeta.mockImplementation(async requestedDate =>
    buildReadResult(recordsMap[requestedDate] ?? null)
  );
  mockDailyRecordPorts.getAuthoritativeForDate.mockImplementation(mockDailyRecordPorts.getForDate);
  mockDailyRecordPorts.updatePartialDetailed.mockImplementation(async (requestedDate, patch) => {
    if (recordsMap[requestedDate]) {
      recordsMap[requestedDate] = applyPatches(recordsMap[requestedDate], patch);
    }
    return createUpdatePartialDailyRecordResult({
      date: requestedDate,
      outcome: 'clean',
      savedLocally: true,
      updatedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
      patchedFields: Object.keys(patch).length,
    });
  });
  mockDailyRecordPorts.saveDetailed.mockImplementation(async recordToSave => {
    recordsMap[recordToSave.date] = recordToSave;
    return createSaveDailyRecordResult({
      date: recordToSave.date,
      outcome: 'clean',
      savedLocally: true,
      savedRemotely: true,
      queuedForRetry: false,
      autoMerged: false,
    });
  });
};

const expectPatchWrite = () => {
  expect(defaultDailyRecordRepositoryPort.updatePartialDetailed).toHaveBeenCalled();
};

const expectPatchKeepsAvailableBed = (patch: DailyRecordPatch, bedId: string): void => {
  expect(patch).toEqual(
    expect.objectContaining({
      [`beds.${bedId}`]: expect.objectContaining({
        patientName: '',
        rut: '',
        pathology: '',
        specialty: Specialty.EMPTY,
        status: PatientStatus.EMPTY,
        devices: [],
        handoffNoteDayShift: '',
        handoffNoteNightShift: '',
        medicalHandoffEntries: [],
        clinicalEvents: [],
        clinicalCrib: undefined,
      }),
    })
  );
};

const matrixCases: CensusActionMatrixCase[] = [
  {
    name: 'crear paciente nuevo',
    failureClass: 'lock_demasiado_amplio',
    run: actions =>
      actions.updatePatientMultiple('R2', {
        patientName: 'Paciente Nuevo',
        rut: '17.752.753-K',
        pathology: 'Ingreso',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: date,
      }),
  },
  {
    name: 'limpiar paciente',
    failureClass: 'persistencia_local_sin_firebase',
    run: (actions, record) => {
      const patient = record.beds.R1!;
      return actions.clearPatient(
        'R1',
        record.lastUpdated,
        buildConfirmedBedOccupantIdentity(patient),
        patient.clinicalCrib ? buildConfirmedAssociatedCribIdentity(patient.clinicalCrib) : null
      );
    },
  },
  {
    name: 'copiar cama',
    failureClass: 'patch_mal_clasificado',
    run: actions => actions.moveOrCopyPatient('copy', 'R1', 'R2'),
  },
  {
    name: 'mover cama',
    failureClass: 'patch_mal_clasificado',
    run: actions => actions.moveOrCopyPatient('move', 'R1', 'R2'),
    expectPatch: patch => {
      expect(patch).toEqual(
        expect.objectContaining({
          'beds.R2': expect.objectContaining({
            bedId: 'R2',
            patientName: 'Paciente R1',
            pathology: 'Diagnostico base',
          }),
        })
      );
      expectPatchKeepsAvailableBed(patch, 'R1');
    },
  },
  {
    name: 'diagnostico',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'pathology', 'Diagnostico actualizado'),
  },
  {
    name: 'estado clinico',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'status', PatientStatus.GRAVE),
  },
  {
    name: 'especialidad',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'specialty', Specialty.CIRUGIA),
  },
  {
    name: 'especialidad otro',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'specialty', 'Broncopulmonar'),
  },
  {
    name: 'calificar UPC',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'isUPC', true),
  },
  {
    name: 'complicacion quirurgica',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updatePatient('R1', 'surgicalComplication', true),
  },
  {
    name: 'cuna clinica estado',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updateClinicalCrib('R1', 'status', PatientStatus.GRAVE),
  },
  {
    name: 'cuna clinica especialidad',
    failureClass: 'lock_demasiado_amplio',
    run: actions => actions.updateClinicalCrib('R1', 'specialty', Specialty.PEDIATRIA),
  },
  {
    name: 'egresar domicilio',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions =>
      actions.addDischarge('R5', 'Vivo', undefined, 'Domicilio (Habitual)', '', '12:00', 'mother'),
    expectPatch: patch => {
      expect(patch).toEqual(
        expect.objectContaining({
          discharges: expect.arrayContaining([
            expect.objectContaining({
              bedId: 'R5',
              patientName: 'Paciente R5',
              diagnosis: 'Diagnostico base',
            }),
          ]),
        })
      );
      expectPatchKeepsAvailableBed(patch, 'R5');
    },
  },
  {
    name: 'eliminar egreso',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.deleteDischarge('disc-1'),
  },
  {
    name: 'deshacer egreso',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.undoDischarge('disc-1'),
  },
  {
    name: 'trasladar',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.addTransfer('R5', 'Ambulancia', 'Hospital Regional', '', 'Médico'),
    expectPatch: patch => {
      expect(patch).toEqual(
        expect.objectContaining({
          transfers: expect.arrayContaining([
            expect.objectContaining({
              bedId: 'R5',
              patientName: 'Paciente R5',
              diagnosis: 'Diagnostico base',
            }),
          ]),
        })
      );
      expectPatchKeepsAvailableBed(patch, 'R5');
    },
  },
  {
    name: 'eliminar traslado',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.deleteTransfer('trans-1'),
  },
  {
    name: 'deshacer traslado',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.undoTransfer('trans-1'),
  },
  {
    name: 'egresar como CMA',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions =>
      actions.addCMA({
        bedName: 'R1',
        patientName: 'Paciente CMA Nuevo',
        rut: '13.333.333-3',
        age: '44',
        diagnosis: 'Procedimiento',
        specialty: Specialty.CIRUGIA,
        interventionType: 'Cirugía Mayor Ambulatoria',
        originalBedId: 'R5',
      }),
    expectPatch: patch => {
      expect(patch).toEqual(
        expect.objectContaining({
          cma: expect.arrayContaining([
            expect.objectContaining({
              originalBedId: 'R5',
              patientName: 'Paciente Cma Nuevo',
              diagnosis: 'Procedimiento',
            }),
          ]),
        })
      );
      expectPatchKeepsAvailableBed(patch, 'R5');
    },
  },
  {
    name: 'eliminar CMA',
    failureClass: 'persistencia_local_sin_firebase',
    run: actions => actions.deleteCMA('cma-1'),
  },
  {
    name: 'deshacer CMA',
    failureClass: 'persistencia_local_sin_firebase',
    run: (actions, record) => actions.undoCMA(record.cma[0] as CMAData),
  },
];

describe('useDailyRecord census action matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    setupRecordStore(buildMatrixRecord());
    mockDailyRecordPorts.getPreviousDayWithMeta.mockResolvedValue(buildReadResult(null));
    mockDailyRecordPorts.getAvailableDates.mockResolvedValue([date]);
    mockDailyRecordPorts.getMonthRecords.mockResolvedValue([]);
    mockDailyRecordPorts.initializeDay.mockResolvedValue(null);
    mockDailyRecordPorts.deleteDay.mockResolvedValue(undefined);
    mockDailyRecordPorts.syncWithFirestoreDetailed.mockResolvedValue({
      date,
      outcome: 'clean',
      record: null,
    });
    mockDailyRecordPorts.copyPatientToDateDetailed.mockResolvedValue({
      sourceDate: date,
      targetDate: '2026-05-18',
      outcome: 'clean',
      sourceBedId: 'R1',
      targetBedId: 'R2',
      sourceCompatibilityIntensity: 'none',
      sourceMigrationRulesApplied: [],
    });
  });

  it.each(matrixCases)('$name persists remotely ($failureClass)', async testCase => {
    const initialRecord = recordsMap[date];
    markDailyRecordRemoteConfirmed(date, {
      source: 'query',
      confirmedRecord: initialRecord,
      remoteLastUpdated: initialRecord.lastUpdated,
    });

    const { result } = renderHook(() => useDailyRecord(date, false, 'ready'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.record).not.toBeNull());
    mockDailyRecordPorts.updatePartialDetailed.mockClear();

    await act(async () => {
      await testCase.run(result.current, initialRecord);
    });

    await waitFor(() => {
      (testCase.expectWrite ?? expectPatchWrite)();
    });

    const writeCall = mockDailyRecordPorts.updatePartialDetailed.mock.calls[0];
    if (writeCall) {
      const [, patch, options] = writeCall;
      expect(options).toEqual(
        expect.objectContaining({
          baseRecord: expect.objectContaining({ date }),
        })
      );
      testCase.expectPatch?.(patch as DailyRecordPatch);
    }
  });
});
