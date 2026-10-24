import { DataFactory } from '@/tests/factories/DataFactory';

type Json = Record<string, unknown>;

export const IDENTITY_REVIEW_DATE = '2026-10-24';

/** Every identity field of a synthetic patient, plus clinical text a salvage must keep. */
export const syntheticIdentity = (bedId: string, name: string, rut: string, extra: Json = {}) => ({
  bedId,
  patientName: name,
  firstName: name.split(' ')[0],
  lastName: 'SINTETICO',
  secondLastName: bedId,
  rut,
  documentType: 'RUT',
  identityStatus: 'official',
  clinicalEpisodeId: `ep_synthetic_${bedId}`,
  admissionDate: '2026-10-20',
  admissionTime: '09:00',
  pathology: `DIAGNOSTICO SINTETICO ${bedId}`,
  medicalHandoffNote: `NOTA SINTETICA ${bedId}`,
  ...extra,
});

export const syntheticPatient = (bedId: string, name: string, rut: string, extra: Json = {}) => ({
  ...(DataFactory.createMockPatient(bedId) as unknown as Json),
  ...syntheticIdentity(bedId, name, rut, extra),
});

const R1_PASSPORT = ['R1', 'PACIENTE UNO', 'FAKE-PASSPORT-R1'] as const;

export const r1Passport = (extra: Json = {}) =>
  syntheticPatient(...R1_PASSPORT, { documentType: 'Pasaporte', ...extra });

/**
 * A stored census day as Firestore holds it: three occupied beds, and R1 (a passport) carries one
 * stored identity value this client cannot read unless `r1Extra` says otherwise.
 */
export const storedDay = (
  r1Extra: Json = { documentType: 'Cedula' },
  { date = IDENTITY_REVIEW_DATE, lastUpdated = `${date}T08:00:00.000Z` } = {}
): Json => {
  const base = DataFactory.createMockDailyRecord(date, { lastUpdated }) as unknown as Json;
  return {
    ...base,
    schemaVersion: 1,
    beds: {
      ...(base.beds as Json),
      R1: r1Passport(r1Extra),
      R2: syntheticPatient('R2', 'PACIENTE DOS', '11.111.111-1'),
      R3: syntheticPatient('R3', 'PACIENTE TRES', '22.222.222-2'),
    },
  };
};

export const storedSnapshot = (data: Json, id = IDENTITY_REVIEW_DATE) => ({
  id,
  exists: () => true,
  data: () => data,
  metadata: { fromCache: false, hasPendingWrites: false },
});

/** What a read of `storedDay()` must show for R1: the passport, with its document type under review. */
export const expectedReviewedR1 = () => {
  const { documentType: _unreadable, ...readable } = syntheticIdentity(...R1_PASSPORT);
  return readable;
};
