import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  type CensusImportDiff,
  type DischargeEntry,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const legacyPatient = (admissionTime: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'NEO1',
  patientName: 'Paciente Legado',
  rut: '11.111.111-1',
  clinicalEpisodeId: undefined,
  admissionDate: '2026-07-23',
  admissionTime,
});

const recordWith = (patient: PatientData): DailyRecord => ({
  date: '2026-07-24',
  beds: { NEO1: patient },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const discharge = (): DischargeEntry => ({
  bedId: 'NEO1',
  rut: '11.111.111-1',
  patientName: 'Paciente Legado',
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  encounterId: 'rayen-episode',
  expectedOccupant: {
    rut: '11.111.111-1',
    admissionDate: '2026-07-23',
    admissionTime: '13:20',
  },
});

const diffWith = (entry: DischargeEntry): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [entry],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 1,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
});

const apply = (patient: PatientData, entry: DischargeEntry = discharge()) =>
  applyCensusImportDiff(recordWith(patient), diffWith(entry), {
    idFactory: () => 'movement-id',
    now: new Date(2026, 6, 24),
    syncRunId: 'sync-run',
  });

describe('discharge occupant identity guard', () => {
  it('accepts a legacy occupant whose previewed RUN and admission stamp still match', () => {
    const result = apply(legacyPatient('13:20'));

    expect(result.skipped).toHaveLength(0);
    expect(result.applied.discharges).toBe(1);
    expect(result.record.beds.NEO1).toBeUndefined();
  });

  it('rejects a same-RUN legacy readmission with a different admission stamp', () => {
    const changed = legacyPatient('18:45');
    const result = apply(changed);

    expect(result.record.beds.NEO1).toEqual(changed);
    expect(result.applied.discharges).toBe(0);
    expect(result.skipped).toEqual([
      {
        kind: 'discharge',
        bedId: 'NEO1',
        reason: 'La cama ahora corresponde a otro paciente.',
      },
    ]);
  });

  it('explains when a same-RUN discharge lacks the preview admission stamp', () => {
    const entry = {
      ...discharge(),
      expectedOccupant: {
        rut: '11.111.111-1',
        admissionDate: '2026-07-23',
      },
    };
    const result = apply(legacyPatient('13:20'), entry);

    expect(result.record.beds.NEO1).toBeDefined();
    expect(result.applied.discharges).toBe(0);
    expect(result.skipped).toEqual([
      {
        kind: 'discharge',
        bedId: 'NEO1',
        reason: 'No se pudo confirmar la identidad del ocupante (falta el sello de ingreso).',
      },
    ]);
  });

  it('rejects an unidentified occupant even when the admission stamp matches', () => {
    const unidentified = { ...legacyPatient('13:20'), rut: '' };
    const entry = {
      ...discharge(),
      rut: '',
      expectedOccupant: {
        rut: '',
        admissionDate: '2026-07-23',
        admissionTime: '13:20',
      },
    };
    const result = apply(unidentified, entry);

    expect(result.record.beds.NEO1).toEqual(unidentified);
    expect(result.applied.discharges).toBe(0);
    expect(result.skipped).toEqual([
      {
        kind: 'discharge',
        bedId: 'NEO1',
        reason: 'La cama ahora corresponde a otro paciente.',
      },
    ]);
  });
});
