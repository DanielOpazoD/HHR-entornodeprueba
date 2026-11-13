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

it('does not block a passport admission as a duplicate of a RUN with the same digits', () => {
  expect(
    findManualPatientDuplicate(
      { beds: { R1: { patientName: 'SINTETICO', rut: '12.345.678-5', clinicalEpisodeId: 'one' } } },
      { rut: 'P123456785', encounterId: 'two' }
    )
  ).toBeNull();
});

it('still blocks the same passport already in the census, whatever its separators or case', () => {
  expect(
    findManualPatientDuplicate(
      { beds: { R1: { patientName: 'SINTETICO', rut: 'P123456785', clinicalEpisodeId: 'one' } } },
      { rut: ' p-123456785 ', encounterId: 'two' }
    )
  ).toEqual({ kind: 'rut', bedId: 'R1' });
});

it('does not take two different passports with the same digits for one person', () => {
  expect(
    findManualPatientDuplicate(
      { beds: { R1: { patientName: 'SINTETICO', rut: 'P123456785', clinicalEpisodeId: 'one' } } },
      { rut: 'X123456785', encounterId: 'two' }
    )
  ).toBeNull();
});

it('does not match two patients that both lack a document', () => {
  expect(
    findManualPatientDuplicate(
      { beds: { R1: { patientName: 'SINTETICO', rut: '', clinicalEpisodeId: 'one' } } },
      { rut: '', encounterId: 'two' }
    )
  ).toBeNull();
});

it.each(['SIN RUT', 'S/R', 'NN', '--'])(
  'lets a second patient without a document in: the marker %s names nobody',
  marker => {
    expect(
      findManualPatientDuplicate(
        { beds: { R1: { patientName: 'SINTETICO', rut: marker, clinicalEpisodeId: 'one' } } },
        { rut: marker, encounterId: 'two' }
      )
    ).toBeNull();
  }
);

it('still blocks the same passport written with a space inside', () => {
  expect(
    findManualPatientDuplicate(
      { beds: { R1: { patientName: 'SINTETICO', rut: 'P123456785', clinicalEpisodeId: 'one' } } },
      { rut: 'P 123456785', encounterId: 'two' }
    )
  ).toEqual({ kind: 'rut', bedId: 'R1' });
});
