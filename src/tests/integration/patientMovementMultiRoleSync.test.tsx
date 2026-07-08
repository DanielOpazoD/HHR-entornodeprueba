import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuditContext } from '@/context/AuditContext';
import { useCMA } from '@/hooks/useCMA';
import { usePatientDischarges } from '@/hooks/usePatientDischarges';
import { usePatientTransfers } from '@/hooks/usePatientTransfers';
import { applyOptimisticDailyRecordPatch } from '@/hooks/controllers/dailyRecordQueryController';
import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: vi.fn(),
}));

vi.mock('@/services/factories/patientFactory', () => ({
  createEmptyPatient: (bedId: string) => ({
    bedId,
    patientName: '',
    rut: '',
    pathology: '',
    location: '',
  }),
}));

type ClinicalRole = 'admin' | 'nurse_hospital';
type MovementScenario = 'cma' | 'discharge' | 'transfer';

const MOVEMENT_DATE = '2026-02-19';
const SOURCE_BED_ID = 'R1';
const PATIENT_NAME = 'Paciente Multirol';

const buildPatient = (bedId: string): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: PATIENT_NAME,
  rut: '11.111.111-1',
  age: '44',
  pathology: 'Diagnostico multirol',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: MOVEMENT_DATE,
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  location: 'Sector A',
});

const buildRecord = (): DailyRecord =>
  ({
    date: MOVEMENT_DATE,
    beds: {
      [SOURCE_BED_ID]: buildPatient(SOURCE_BED_ID),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${MOVEMENT_DATE}T08:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
    schemaVersion: 1,
  }) as DailyRecord;

const cloneRecord = (record: DailyRecord): DailyRecord => structuredClone(record) as DailyRecord;

const createSharedRecordRuntime = (initialRecord: DailyRecord) => {
  let sharedRecord = cloneRecord(initialRecord);
  return {
    getSnapshot: () => cloneRecord(sharedRecord),
    patchRecord: vi.fn(async (patch: DailyRecordPatch) => {
      sharedRecord = applyOptimisticDailyRecordPatch(sharedRecord, patch);
    }),
    saveAndUpdate: vi.fn(async (record: DailyRecord) => {
      sharedRecord = cloneRecord(record);
    }),
  };
};

const expectPatientMovedOnce = (
  record: DailyRecord,
  movement: MovementScenario,
  sourceRole: ClinicalRole,
  observerRole: ClinicalRole
) => {
  const sourceBed = record.beds[SOURCE_BED_ID];
  expect(sourceBed.patientName).toBe('');
  expect(sourceBed.rut).toBe('');
  expect(sourceBed.pathology).toBe('');

  const activeOccurrences = Object.values(record.beds).filter(
    bed => bed.patientName === PATIENT_NAME
  );
  expect(activeOccurrences).toHaveLength(0);

  const movedList =
    movement === 'discharge'
      ? record.discharges
      : movement === 'transfer'
        ? record.transfers
        : record.cma;
  expect(movedList).toHaveLength(1);
  expect(movedList[0]).toEqual(
    expect.objectContaining({
      patientName: expect.stringMatching(/Paciente Multirol/i),
    })
  );

  expect(sourceRole).not.toBe(observerRole);
};

describe('patient movement multi-role sync contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logEvent: vi.fn(),
      logPatientDischarge: vi.fn(),
      logPatientTransfer: vi.fn(),
    } as unknown as ReturnType<typeof useAuditContext>);
  });

  it.each([
    {
      movement: 'cma' as const,
      sourceRole: 'nurse_hospital' as const,
      observerRole: 'admin' as const,
    },
    {
      movement: 'discharge' as const,
      sourceRole: 'nurse_hospital' as const,
      observerRole: 'admin' as const,
    },
    {
      movement: 'transfer' as const,
      sourceRole: 'admin' as const,
      observerRole: 'nurse_hospital' as const,
    },
  ])(
    'keeps $movement atomic when $sourceRole writes and $observerRole reloads',
    async ({ movement, sourceRole, observerRole }) => {
      const runtime = createSharedRecordRuntime(buildRecord());
      const sourceSnapshot = runtime.getSnapshot();

      if (movement === 'cma') {
        const { result } = renderHook(() =>
          useCMA(sourceSnapshot, runtime.saveAndUpdate, runtime.patchRecord)
        );

        await act(async () => {
          result.current.addCMA({
            bedName: SOURCE_BED_ID,
            patientName: PATIENT_NAME,
            rut: '111111111',
            age: '44',
            diagnosis: 'Diagnostico multirol',
            specialty: 'Medicina',
            interventionType: 'Cirugía Mayor Ambulatoria',
            originalBedId: SOURCE_BED_ID,
          });
        });
      }

      if (movement === 'discharge') {
        const { result } = renderHook(() =>
          usePatientDischarges(
            sourceSnapshot,
            runtime.saveAndUpdate,
            undefined,
            runtime.patchRecord
          )
        );

        await act(async () => {
          result.current.addDischarge(SOURCE_BED_ID, 'Vivo', undefined, 'Alta Medica');
        });
      }

      if (movement === 'transfer') {
        const { result } = renderHook(() =>
          usePatientTransfers(sourceSnapshot, runtime.saveAndUpdate, undefined, runtime.patchRecord)
        );

        await act(async () => {
          result.current.addTransfer(SOURCE_BED_ID, 'Ambulancia', 'Hospital receptor', '');
        });
      }

      expect(runtime.patchRecord).toHaveBeenCalledTimes(1);
      expect(runtime.saveAndUpdate).not.toHaveBeenCalled();
      expectPatientMovedOnce(runtime.getSnapshot(), movement, sourceRole, observerRole);
    }
  );
});
