import { describe, expect, it } from 'vitest';
import {
  collectHospitalizedPatientsForRecord,
  resolveAdmissionsCountForRecord,
  resolveMovementSummaryState,
  resolveStaffSelectorsClassName,
  resolveStaffSelectorsState,
} from '@/features/census/controllers/censusStaffHeaderController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { isNewAdmissionForClinicalDay } from '@/utils/dateUtils';
import {
  resolveDetailedStaffingState,
  updateDetailedStaffingStandardSlot,
} from '@/services/staff/dailyRecordDetailedStaffing';

describe('censusStaffHeaderController', () => {
  it('normalizes nullable staff arrays to safe arrays', () => {
    expect(resolveStaffSelectorsState(null)).toEqual({
      nursesDayShift: [],
      nursesNightShift: [],
      tensDayShift: [],
      tensNightShift: [],
    });

    expect(
      resolveStaffSelectorsState({
        nursesDayShift: ['A'],
        nursesNightShift: undefined,
        tensDayShift: ['T1', 'T2'],
        tensNightShift: null,
      })
    ).toEqual({
      nursesDayShift: ['A'],
      nursesNightShift: [],
      tensDayShift: ['T1', 'T2'],
      tensNightShift: [],
    });
  });

  it('uses canonical detailed staffing when legacy day arrays are stale', () => {
    const input = {
      date: '2026-08-11',
      nursesDayShift: ['', ''],
      nursesNightShift: ['Enfermera Noche 1', 'Enfermera Noche 2'],
      tensDayShift: ['', '', ''],
      tensNightShift: ['TENS Noche 1', 'TENS Noche 2', 'TENS Noche 3'],
    };
    let detail = resolveDetailedStaffingState(input, input.date);
    detail = updateDetailedStaffingStandardSlot(detail, 'day', 'nurse', 0, 'Enfermera Día');
    detail = updateDetailedStaffingStandardSlot(detail, 'day', 'tens', 0, 'TENS Día 1');
    detail = updateDetailedStaffingStandardSlot(detail, 'day', 'tens', 1, 'TENS Día 2');
    detail = updateDetailedStaffingStandardSlot(detail, 'day', 'tens', 2, 'TENS Día 3');

    expect(
      resolveStaffSelectorsState({
        ...input,
        staffingDetailsV1: detail,
      })
    ).toEqual({
      nursesDayShift: ['Enfermera Día', ''],
      nursesNightShift: ['Enfermera Noche 1', 'Enfermera Noche 2'],
      tensDayShift: ['TENS Día 1', 'TENS Día 2', 'TENS Día 3'],
      tensNightShift: ['TENS Noche 1', 'TENS Noche 2', 'TENS Noche 3'],
    });
  });

  it('normalizes movement data and computes cmaCount', () => {
    const result = resolveMovementSummaryState({
      discharges: [DataFactory.createMockDischarge({ id: 'd1' })],
      transfers: [DataFactory.createMockTransfer({ id: 't1' })],
      cma: [DataFactory.createMockCMA({ id: 'c1' }), DataFactory.createMockCMA({ id: 'c2' })],
    });

    expect(result.discharges).toHaveLength(1);
    expect(result.transfers).toHaveLength(1);
    expect(result.cmaCount).toBe(2);
    expect(resolveMovementSummaryState(undefined)).toEqual({
      discharges: [],
      transfers: [],
      cmaCount: 0,
      admissionsCount: 0,
    });
  });

  it('resolves admissions count using clinical day rules', () => {
    const beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'P1',
        admissionDate: '2026-03-05',
        admissionTime: '12:00',
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'P2',
        admissionDate: '2026-03-06',
        admissionTime: '07:30',
      }),
      R3: DataFactory.createMockPatient('R3', {
        patientName: 'P3',
        admissionDate: '2026-03-06',
        admissionTime: '08:30',
      }),
    };

    expect(
      resolveAdmissionsCountForRecord({
        beds,
        recordDate: '2026-03-05',
      })
    ).toBe(2);
  });

  it('collects hospitalized patients including valid clinical crib and excluding blocked entries', () => {
    const beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Main',
        isBlocked: false,
        clinicalCrib: DataFactory.createMockPatient('R1-crib', {
          patientName: 'Baby',
          isBlocked: false,
        }),
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Blocked main',
        isBlocked: true,
      }),
      R3: DataFactory.createMockPatient('R3', {
        patientName: 'Main only',
        isBlocked: false,
        clinicalCrib: DataFactory.createMockPatient('R3-crib', {
          patientName: 'Blocked crib',
          isBlocked: true,
        }),
      }),
    };

    expect(collectHospitalizedPatientsForRecord(beds).map(patient => patient.patientName)).toEqual([
      'Main',
      'Baby',
      'Main only',
    ]);
  });

  it('counts admissions consistently for main beds and clinical crib patients', () => {
    const beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Main',
        admissionDate: '2026-03-05',
        admissionTime: '10:00',
        clinicalCrib: DataFactory.createMockPatient('R1-crib', {
          patientName: 'Baby',
          admissionDate: '2026-03-06',
          admissionTime: '07:45',
        }),
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Late entry',
        admissionDate: '2026-03-06',
        admissionTime: '08:15',
      }),
    };

    expect(
      resolveAdmissionsCountForRecord({
        beds,
        recordDate: '2026-03-05',
      })
    ).toBe(2);
  });

  it('matches the same clinical-day admission semantics used by the row indicator', () => {
    const beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Ingreso madrugada',
        admissionDate: '2026-03-06',
        admissionTime: '07:59',
      }),
      R2: DataFactory.createMockPatient('R2', {
        patientName: 'Fuera de ventana',
        admissionDate: '2026-03-06',
        admissionTime: '08:15',
      }),
    };

    const admissionsCount = resolveAdmissionsCountForRecord({
      beds,
      recordDate: '2026-03-05',
    });
    const indicatorCount = Object.values(beds).filter(patient =>
      isNewAdmissionForClinicalDay('2026-03-05', patient.admissionDate, patient.admissionTime)
    ).length;

    expect(admissionsCount).toBe(indicatorCount);
    expect(admissionsCount).toBe(1);
  });

  it('counts madrugada admissions under the owning night shift even when firstSeenDate was anchored on the next calendar day', () => {
    const beds = {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Ingreso madrugada',
        firstSeenDate: '2026-03-06',
        admissionDate: '2026-03-06',
        admissionTime: '02:00',
      }),
    };

    expect(
      resolveAdmissionsCountForRecord({
        beds,
        recordDate: '2026-03-05',
      })
    ).toBe(1);

    expect(
      resolveAdmissionsCountForRecord({
        beds,
        recordDate: '2026-03-06',
      })
    ).toBe(0);
  });

  it('returns read-only class name only when readOnly is true', () => {
    expect(resolveStaffSelectorsClassName(true)).toBe('pointer-events-none opacity-80');
    expect(resolveStaffSelectorsClassName(false)).toBe('');
  });
});
