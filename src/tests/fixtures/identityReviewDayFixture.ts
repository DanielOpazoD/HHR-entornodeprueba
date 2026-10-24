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
  { date = IDENTITY_REVIEW_DATE, lastUpdated }: { date?: string; lastUpdated?: string } = {}
): Json => {
  const base = DataFactory.createMockDailyRecord(date, {
    lastUpdated: lastUpdated ?? `${date}T08:00:00.000Z`,
  }) as unknown as Json;
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

const PLANTED_REVIEW = { bedId: 'R2', slot: 'bed', fields: ['documentType'] };

/**
 * A readable stored day where every place a patient can sit carries an `identityReview` that a
 * writer left in Firestore: a bed and its crib, the snapshot of a discharge and the crib inside
 * it, a transfer and its snapshot, and a CMA snapshot. None of them was produced by a read.
 */
export const storedDayWithPlantedReviews = (): Json => {
  const day = storedDay({ documentType: 'Pasaporte' });
  const beds = day.beds as Record<string, Json>;
  const newborn = syntheticPatient('R1', 'RN SINTETICO', 'FAKE-PASSPORT-RN', { bedMode: 'Cuna' });
  const snapshot = {
    ...r1Passport(),
    identityReview: PLANTED_REVIEW,
    clinicalCrib: { ...newborn, identityReview: PLANTED_REVIEW },
  };
  beds.R2 = {
    ...beds.R2,
    identityReview: PLANTED_REVIEW,
    clinicalCrib: { ...newborn, bedId: 'R2', identityReview: PLANTED_REVIEW },
  };
  return {
    ...day,
    discharges: [
      DataFactory.createMockDischarge({ id: 'discharge-planted', originalData: snapshot as never }),
    ],
    transfers: [
      {
        ...DataFactory.createMockTransfer({
          id: 'transfer-planted',
          originalData: snapshot as never,
        }),
        identityReview: PLANTED_REVIEW,
      },
    ],
    cma: [DataFactory.createMockCMA({ id: 'cma-planted', originalData: snapshot as never })],
  };
};
