// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { parseDailyRecordWithDefaultsReport, safeParseDailyRecord } from '@/schemas/zodSchemas';

const DATE = '2026-03-04';

// A signed, CUDYR-locked day carrying every top-level field the salvage list does not rebuild.
const signedDay = () => ({
  date: DATE,
  beds: {
    R1: { bedId: 'R1', patientName: 'Paciente Sintético', rut: '12.345.678-5' },
  },
  dateTimestamp: 1772593200000,
  staffingDetailsV1: {
    day: { nurses: [], tens: [] },
    night: { nurses: [], tens: [] },
  },
  medicalHandoffDoctor: 'Dra. Sintética',
  medicalHandoffSentAt: '2026-03-04T12:00:00.000Z',
  medicalHandoffSentAtByScope: { all: '2026-03-04T12:00:00.000Z' },
  medicalSignatureLinkTokenByScope: { all: 'token-sintetico' },
  medicalSignature: { doctorName: 'Dra. Sintética', signedAt: '2026-03-04T12:30:00.000Z' },
  medicalSignatureByScope: {
    all: { doctorName: 'Dra. Sintética', signedAt: '2026-03-04T12:30:00.000Z' },
  },
  cudyrLocked: true,
  cudyrLockedAt: '2026-03-04T23:00:00.000Z',
  cudyrLockedBy: 'enfermera@hospital.test',
  cudyrUpdatedAt: '2026-03-04T22:00:00.000Z',
  cudyrUpdatedBy: 'enfermera@hospital.test',
  cudyrUpdatedById: 'uid-sintetico',
  cudyrShiftDate: DATE,
  cudyrCompletedAt: '2026-03-04T22:30:00.000Z',
  cudyrCompletedBy: 'enfermera@hospital.test',
  futureFieldFromNewerClient: { kept: true },
});

const withBrokenBed = (day: Record<string, unknown>) => ({
  ...day,
  beds: { ...(day.beds as object), R2: { bedId: 'R2', patientName: 42, status: 'NO_EXISTE' } },
});

describe('salvaging a day with one invalid value', () => {
  it('keeps every valid top-level field the strict parse keeps, including the signature', () => {
    const strict = safeParseDailyRecord(signedDay());
    expect(strict).not.toBeNull();

    const { record, report } = parseDailyRecordWithDefaultsReport(withBrokenBed(signedDay()), DATE);

    expect(report.salvagedBeds).toEqual(['R2']);
    const strictFields = strict as unknown as Record<string, unknown>;
    const salvagedFields = record as unknown as Record<string, unknown>;
    const dropped = Object.keys(strictFields).filter(key => !(key in salvagedFields));
    expect(dropped).toEqual([]);
    expect(record.medicalSignature).toEqual(strict?.medicalSignature);
    expect(record.medicalSignatureByScope).toEqual(strict?.medicalSignatureByScope);
    expect(record.cudyrLocked).toBe(true);
  });

  it('drops only the top-level value that fails its own schema', () => {
    const { record } = parseDailyRecordWithDefaultsReport(
      {
        ...withBrokenBed(signedDay()),
        medicalSignature: { doctorName: 7 },
        cudyrLocked: 'sí',
      },
      DATE
    );

    expect(record.medicalSignature).toBeUndefined();
    expect('cudyrLocked' in record).toBe(false);
    expect(record.medicalSignatureByScope?.all?.doctorName).toBe('Dra. Sintética');
    expect(record.medicalHandoffDoctor).toBe('Dra. Sintética');
  });
});
