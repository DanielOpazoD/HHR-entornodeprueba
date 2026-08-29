import { describe, expect, it } from 'vitest';
import { findManualPatientDuplicate } from '@/features/rayen-manual-import/domain/manualPatientImportPolicy';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('manual Eloísa patient duplicate policy', () => {
  const record: DailyRecord = {
    date: '2026-08-28',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-08-28T00:00:00.000Z',
  };
  record.beds.H3C1 = {
    ...createEmptyPatient('H3C1'),
    patientName: 'Paciente Existente',
    rut: '12.345.678-5',
    clinicalEpisodeId: '9001',
  };

  it('finds an occupied matching RUT regardless of formatting', () => {
    expect(findManualPatientDuplicate(record, { rut: '123456785', encounterId: '9002' })).toEqual({
      kind: 'rut',
      bedId: 'H3C1',
    });
  });

  it('finds a matching Eloísa episode even when the RUT differs', () => {
    expect(findManualPatientDuplicate(record, { rut: '111111111', encounterId: '9001' })).toEqual({
      kind: 'episode',
      bedId: 'H3C1',
    });
  });

  it('allows a genuinely different patient and episode', () => {
    expect(
      findManualPatientDuplicate(record, { rut: '111111111', encounterId: '9002' })
    ).toBeNull();
  });
});
