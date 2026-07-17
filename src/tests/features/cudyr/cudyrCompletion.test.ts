import { describe, expect, it } from 'vitest';
import {
  CUDYR_SCORE_FIELDS,
  finalizeCudyrCompletion,
  isCudyrScoreComplete,
  resolveCudyrRecordCompletion,
} from '@/domain/cudyr/cudyrCompletion';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecordCudyrState } from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';
import { DataFactory } from '../../factories/DataFactory';

const completeScore = Object.fromEntries(
  CUDYR_SCORE_FIELDS.map(field => [field, 0])
) as unknown as CudyrScore;

const createEligiblePatient = (overrides: Partial<PatientData> = {}): PatientData =>
  DataFactory.createMockPatient('R1', {
    patientName: 'Paciente CUDYR',
    admissionDate: '2026-07-15',
    admissionTime: '10:00',
    ...overrides,
  });

describe('CUDYR night-shift completion policy', () => {
  it('requires every score field while accepting a clinically valid zero', () => {
    expect(isCudyrScoreComplete(completeScore)).toBe(true);
    expect(isCudyrScoreComplete({ ...completeScore, airway: 3 })).toBe(true);
    expect(isCudyrScoreComplete({ changeClothes: 1 })).toBe(false);
  });

  it('closes only when every eligible patient and clinical crib is complete', () => {
    const record: DailyRecordCudyrState = {
      date: '2026-07-16',
      activeExtraBeds: [],
      beds: {
        R1: createEligiblePatient({
          cudyr: completeScore,
          clinicalCrib: createEligiblePatient({
            patientName: 'Recién nacido pendiente',
            cudyr: undefined,
          }),
        }),
        R2: createEligiblePatient({ patientName: 'Paciente pendiente', cudyr: undefined }),
      },
    };

    expect(resolveCudyrRecordCompletion(record)).toEqual({
      eligibleCount: 3,
      completedCount: 1,
      isComplete: false,
    });

    record.beds.R2 = { ...record.beds.R2, cudyr: completeScore };
    expect(resolveCudyrRecordCompletion(record)).toEqual({
      eligibleCount: 3,
      completedCount: 2,
      isComplete: false,
    });

    record.beds.R1 = {
      ...record.beds.R1,
      clinicalCrib: { ...record.beds.R1.clinicalCrib!, cudyr: completeScore },
    };
    expect(resolveCudyrRecordCompletion(record)).toEqual({
      eligibleCount: 3,
      completedCount: 3,
      isComplete: true,
    });
  });

  it('normalizes every new closure owner to the record receiving the scores', () => {
    const record = DataFactory.createMockDailyRecord('2026-07-16', {
      cudyrLocked: true,
      cudyrShiftDate: '2026-07-17',
      cudyrUpdatedAt: '2026-07-17T15:00:00.000Z',
      cudyrUpdatedBy: 'Enfermera Día',
      cudyrUpdatedById: 'nurse-day',
      cudyrCompletedBy: 'Responsable obsoleto',
    });
    record.beds.R1 = createEligiblePatient({ cudyr: completeScore });

    expect(finalizeCudyrCompletion(record, { normalizeIntroducedLock: true })).toMatchObject({
      cudyrShiftDate: '2026-07-16',
      cudyrCompletedBy: 'Enfermera Día',
      cudyrLockedBy: 'nurse-day',
    });
  });
});
