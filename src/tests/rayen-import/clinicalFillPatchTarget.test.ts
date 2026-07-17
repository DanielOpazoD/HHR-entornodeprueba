import { describe, expect, it } from 'vitest';
import { assertClinicalFillPatchTarget } from '@/features/rayen-import/domain/clinicalFillPatchTarget';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

const record = {
  date: '2026-07-16',
  beds: {
    R1: { bedId: 'R1', patientName: 'Paciente', clinicalEpisodeId: 'episode-1' },
  },
  discharges: [],
  transfers: [],
  cma: [],
} as unknown as DailyRecord;

describe('assertClinicalFillPatchTarget', () => {
  it('accepts the census and episode that originated the clinical request', () => {
    expect(() =>
      assertClinicalFillPatchTarget(record, {
        censusDate: '2026-07-16',
        bedId: 'R1',
        clinicalEpisodeId: 'episode-1',
      })
    ).not.toThrow();
  });

  it('rejects a delayed response after the operator changes census', () => {
    expect(() =>
      assertClinicalFillPatchTarget(record, {
        censusDate: '2026-07-15',
        bedId: 'R1',
        clinicalEpisodeId: 'episode-1',
      })
    ).toThrow('El censo activo cambió');
  });

  it('rejects a delayed response after the bed occupant changes', () => {
    expect(() =>
      assertClinicalFillPatchTarget(record, {
        censusDate: '2026-07-16',
        bedId: 'R1',
        clinicalEpisodeId: 'episode-2',
      })
    ).toThrow('El paciente o su cama cambiaron');
  });
});
