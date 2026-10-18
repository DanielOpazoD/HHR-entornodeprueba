// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

const makeRecord = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-02-18',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as unknown as DailyRecord;

describe('newborn occupancy during maternal closure normalization', () => {
  it('does not restore a departed crib while clearing residual data from the freed maternal bed', () => {
    const record = makeRecord('2026-02-18T10:00:00.000Z');
    const child = DataFactory.createMockPatient('R4', {
      patientName: 'RN sintético',
      rut: '',
      clinicalEpisodeId: 'child-1',
      bedMode: 'Cuna',
    });
    record.beds.R4 = DataFactory.createMockPatient('R4', {
      patientName: '',
      rut: '',
      pathology: 'Residuo de la madre',
      clinicalCrib: child,
    });
    record.discharges = [
      DataFactory.createMockDischarge({
        bedId: 'R4',
        patientName: child.patientName,
        rut: '',
        clinicalEpisodeId: child.clinicalEpisodeId,
        admissionDate: child.admissionDate,
        isNested: true,
      }),
    ];
    const normalized = normalizeMovementBedConsistency(record).record.beds.R4;
    expect(normalized.clinicalCrib).toBeUndefined();
    expect(normalized.pathology).toBe('');
    expect(normalized.hasCompanionCrib).toBe(false);
  });

  it('preserves an unresolved newborn when normalizing its already discharged mother', () => {
    const record = makeRecord('2026-02-18T10:00:00.000Z');
    const crib = DataFactory.createMockPatient('R4', {
      patientName: 'RN de Madre Sintética',
      clinicalEpisodeId: 'child-1',
      rut: '',
      bedMode: 'Cuna',
      handoffNoteNightShift: 'Nota neonatal conservada',
    });
    record.beds.R4 = DataFactory.createMockPatient('R4', {
      patientName: 'Madre Sintética',
      clinicalEpisodeId: 'mother-1',
      clinicalCrib: crib,
    });
    record.discharges = [
      DataFactory.createMockDischarge({
        bedId: 'R4',
        patientName: 'Madre Sintética',
        rut: record.beds.R4.rut,
        admissionDate: record.beds.R4.admissionDate,
        clinicalEpisodeId: 'mother-1',
      }),
    ];
    const normalized = normalizeMovementBedConsistency(record).record;
    expect(normalized.beds.R4.patientName).toBe('');
    expect(normalized.beds.R4.clinicalCrib).toEqual(crib);
    const closed = normalizeMovementBedConsistency({
      ...record,
      discharges: [
        ...record.discharges,
        DataFactory.createMockDischarge({
          bedId: 'R4',
          patientName: crib.patientName,
          rut: '',
          admissionDate: crib.admissionDate,
          clinicalEpisodeId: 'child-1',
          isNested: true,
        }),
      ],
    }).record;
    expect(closed.beds.R4.clinicalCrib).toBeUndefined();
  });
});
