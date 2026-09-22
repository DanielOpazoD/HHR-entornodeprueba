import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { createCensusPatientIdentityIndex } from '@/features/rayen-import/domain/censusPatientIdentityIndex';
import type { RayenEncounter } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const encounter = (documentType: 'RUT' | 'Pasaporte'): RayenEncounter => ({
  encounterId: documentType === 'RUT' ? '990001' : '990002',
  run: '123456785',
  documentType,
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
});

const record: DailyRecord = {
  date: '2026-09-21',
  beds: {
    R2: {
      ...EMPTY_PATIENT,
      bedId: 'R2',
      patientName: 'Paciente Pasaporte',
      rut: '123456785',
      documentType: 'Pasaporte',
      clinicalEpisodeId: undefined,
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '',
};

describe('census patient typed identity', () => {
  it('does not reuse a numeric passport bed for a same-looking RUT', () => {
    const incoming = encounter('RUT');
    const index = createCensusPatientIdentityIndex(record, [incoming]);

    expect(index.findCurrent(incoming)).toBeUndefined();
  });

  it('keeps the conservative legacy fallback within the same document class', () => {
    const incoming = encounter('Pasaporte');
    const index = createCensusPatientIdentityIndex(record, [incoming]);

    expect(index.findCurrent(incoming)?.bedId).toBe('R2');
  });
});
