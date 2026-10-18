import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const reference = new Date('2026-10-17T15:00:00-05:00');
const encounter = (run: string): RayenEncounter => ({
  encounterId: '140001',
  run,
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
  room: 'R2',
  bed: 'R2',
  admissionDatetime: '2026-10-17T10:00:00-05:00',
  diagnosis: 'Diagnóstico sintético',
});
const record = (patient?: PatientData): DailyRecord => ({
  date: '2026-10-17',
  beds: patient ? { R2: patient } : {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '',
});
const synchronize = (current: DailyRecord, source: RayenEncounter) => {
  const { diff } = planRayenCensusImport({
    current,
    snapshot: { capturedAt: reference.toISOString(), facilityId: 1342, encounters: [source] },
    reference,
  });
  const result = applyCensusImportDiff(current, diff, {
    now: reference,
    idFactory: () => 'synthetic-movement',
    syncRunId: 'synthetic-sync',
  });
  return { diff, result };
};

describe('passport identity across repeated census synchronizations', () => {
  it('repairs a previously truncated passport for the exact episode and converges', () => {
    let current = record({
      ...EMPTY_PATIENT,
      bedId: 'R2',
      patientName: 'Paciente Sintético',
      clinicalEpisodeId: '140001',
      rut: '987.654-3',
      documentType: 'RUT',
      handoffNote: 'Texto corregido en HHR',
    });
    const source = encounter('E9876543');
    for (let pass = 0; pass < 3; pass += 1) {
      const { diff, result } = synchronize(current, source);
      expect(diff.conflicts).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.record.beds.R2).toMatchObject({
        rut: 'E9876543',
        documentType: 'Pasaporte',
        handoffNote: 'Texto corregido en HHR',
      });
      if (pass > 0) expect(diff.updates).toEqual([]);
      current = result.record;
    }
  });

  it('keeps a known numeric passport when the bridge provides no document type', () => {
    const first = synchronize(record(), encounter('9876543')).result.record;
    first.beds.R2 = { ...first.beds.R2, rut: '9876543', documentType: 'Pasaporte' };
    const { diff, result } = synchronize(first, encounter('9876543'));
    expect(result.record.beds.R2).toMatchObject({ rut: '9876543', documentType: 'Pasaporte' });
    expect(diff.updates).toEqual([]);
  });

  it('does not match a legacy passport to another identifier with the same digits', () => {
    const current = record({
      ...EMPTY_PATIENT,
      bedId: 'R2',
      patientName: 'Otra persona',
      rut: 'A9876543',
      documentType: 'Pasaporte',
      admissionDate: '2026-10-17',
      admissionTime: '10:00',
    });
    const { diff, result } = synchronize(current, encounter('B9876543'));
    expect(diff.conflicts).not.toEqual([]);
    expect(result.record.beds.R2).toMatchObject({ rut: 'A9876543', patientName: 'Otra persona' });
  });
});
