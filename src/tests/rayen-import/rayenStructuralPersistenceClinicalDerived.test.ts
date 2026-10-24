/**
 * Structural Rayen base on split days (D9 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md): the
 * base merges a pending local copy into each authoritative bed, so on a marked authoritative day
 * the moved clinical fields, the marker and meta come from the authoritative day only. Unmarked
 * days keep the local copy as before. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { buildRayenStructuralPersistenceBase } from '@/features/rayen-import/domain/rayenStructuralPersistenceBase';

const date = '2026-11-02';
const marker = { version: 1, generation: 'gen_synthetic_a' };
const vitalSignsHistory = [
  { recordedDate: date, recordedAt: `${date}T08:00:00`, heartRate: 80, author: 'local-copy' },
];
const clinicalSyncCheckpoint = { version: 3, fingerprintVersion: 1, sources: {} };

const patient = (extra: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: 'R4',
    patientName: 'Paciente sintético',
    rut: '11.111.111-1',
    admissionDate: date,
    clinicalEpisodeId: 'ep_synthetic_a',
    isBlocked: false,
    bedMode: 'Cama',
    devices: [],
    ...extra,
  }) as PatientData;

const record = (beds: DailyRecord['beds'], lastUpdated: string, extra = {}): DailyRecord =>
  ({
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
    ...extra,
  }) as DailyRecord;

const emptyDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
} as CensusImportDiff;

// A newer pending local copy taken before the split: a new note plus the old embedded copies.
const pendingLocal = record(
  {
    R4: patient({
      medicalHandoffNote: 'Nota local pendiente',
      vitalSignsHistory,
      clinicalSyncCheckpoint,
    } as Partial<PatientData>),
  },
  `${date}T20:01:00.000Z`,
  { meta: { revision: 3 } }
);

const build = (authoritative: DailyRecord) =>
  buildRayenStructuralPersistenceBase(authoritative, pendingLocal, emptyDiff, {
    localWriteState: 'active',
  });

describe('buildRayenStructuralPersistenceBase on a split day', () => {
  it('keeps the local note but takes the moved fields, marker and meta from the authoritative day', () => {
    const base = build(
      record({ R4: patient() }, `${date}T20:00:00.000Z`, {
        clinicalDerivedLayout: marker,
        meta: { revision: 9 },
      })
    );

    expect(base.beds.R4?.medicalHandoffNote).toBe('Nota local pendiente');
    expect(base.beds.R4).not.toHaveProperty('vitalSignsHistory');
    expect(base.beds.R4).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(base).toMatchObject({ clinicalDerivedLayout: marker, meta: { revision: 9 } });
  });

  it('keeps the local embedded copies on an unmarked day, as before', () => {
    const base = build(record({ R4: patient() }, `${date}T20:00:00.000Z`));

    expect(base.beds.R4).toMatchObject({ vitalSignsHistory, clinicalSyncCheckpoint });
    expect(base).not.toHaveProperty('clinicalDerivedLayout');
  });
});
