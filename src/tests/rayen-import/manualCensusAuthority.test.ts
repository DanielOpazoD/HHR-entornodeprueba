import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  type ApplyContext,
  type CensusImportDiff,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { createDischargedEncounterMatcher } from '@/features/rayen-import/domain/censusDischargeHistory';
import { filterRecordedOutcomeActions } from '@/features/rayen-import/domain/filterRecordedOutcomeActions';

const REFERENCE = new Date(2026, 6, 8);
const NOW = new Date(2026, 6, 8, 15, 30, 0);

const makeContext = (): ApplyContext => ({
  idFactory: () => 'generated-id',
  now: NOW,
  actor: 'Enfermera Rayen',
  syncRunId: 'sync-run-1',
});

const makeRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const makeDiff = (overrides: Partial<CensusImportDiff>): CensusImportDiff => ({
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
  ...overrides,
});

describe('manual HHR census authority', () => {
  it('preserves a specialty selected after preview while updating the treating physician', () => {
    const encounter = makeEncounter();
    const { bedId, patient } = rayenToPatientData(encounter, REFERENCE);
    const currentPatient = {
      ...patient,
      specialty: 'Cirugía',
      treatingPhysicianId: 'old',
      treatingPhysicianName: 'Médico anterior',
    };
    const diff = makeDiff({
      updates: [
        {
          bedId: bedId!,
          rut: patient.rut,
          patientName: patient.patientName,
          patient: {
            ...patient,
            specialty: 'Psiquiatría',
            treatingPhysicianId: 'new',
            treatingPhysicianName: 'Médico nuevo',
          },
          source: encounter,
          changes: [
            { field: 'specialty', from: '', to: 'Psiquiatría' },
            { field: 'treatingPhysicianId', from: 'old', to: 'new' },
            { field: 'treatingPhysicianName', from: 'Médico anterior', to: 'Médico nuevo' },
          ],
        },
      ],
    });

    const result = applyCensusImportDiff(
      makeRecord({ [bedId!]: currentPatient }),
      diff,
      makeContext()
    );

    expect(result.record.beds[bedId!]).toMatchObject({
      specialty: 'Cirugía',
      treatingPhysicianId: 'new',
      treatingPhysicianName: 'Médico nuevo',
    });
  });

  it.each(['discharges', 'transfers', 'cma'] as const)(
    'does not re-admit an episode already resolved manually in %s',
    movementKey => {
      const encounter = makeEncounter({ encounterId: 'MANUALLY-RESOLVED' });
      const { patient } = rayenToPatientData(encounter, REFERENCE);
      const current = makeRecord();
      current[movementKey] = [
        {
          id: `manual-${movementKey}`,
          rut: patient.rut,
          clinicalEpisodeId: encounter.encounterId,
          movementProvenance: {
            source: 'manual',
            lineageId: `manual-${movementKey}`,
            classifiedAt: NOW.toISOString(),
          },
        } as never,
      ];
      const diff = makeDiff({
        admissions: [
          {
            bedId: 'H1C2',
            patient,
            isCma: false,
          },
        ],
      });

      const result = applyCensusImportDiff(current, diff, makeContext());

      expect(result.applied.admissions).toBe(0);
      expect(result.record.beds.H1C2).toBeUndefined();
      expect(result.record[movementKey]).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
    }
  );

  it('keeps the active candidate when the other side of a bed collision was resolved manually', () => {
    const resolvedEncounter = makeEncounter({ encounterId: 'RESOLVED' });
    const activeEncounter = makeEncounter({ encounterId: 'ACTIVE', run: '155661110' });
    const resolvedPatient = rayenToPatientData(resolvedEncounter, REFERENCE).patient;
    const activePatient = {
      ...rayenToPatientData(activeEncounter, REFERENCE).patient,
      bedId: 'R1',
    };
    const current = makeRecord();
    current.discharges = [
      {
        id: 'manual-discharge',
        rut: resolvedPatient.rut,
        clinicalEpisodeId: resolvedEncounter.encounterId,
        movementProvenance: {
          source: 'manual',
          lineageId: 'manual-discharge',
          classifiedAt: NOW.toISOString(),
        },
      } as never,
    ];
    const diff = makeDiff({
      bedOccupancyCollisions: [
        {
          id: 'R1:ACTIVE:RESOLVED',
          bedId: 'R1',
          candidates: [
            {
              clinicalEpisodeId: resolvedEncounter.encounterId,
              sourceKind: 'cma',
              patient: resolvedPatient,
              source: resolvedEncounter,
            },
            {
              clinicalEpisodeId: activeEncounter.encounterId,
              sourceKind: 'medical-surgical',
              patient: activePatient,
              source: activeEncounter,
            },
          ],
          availableAlternativeBedIds: [],
        },
      ],
    });

    const result = applyCensusImportDiff(current, diff, makeContext());

    expect(result.record.beds.R1?.clinicalEpisodeId).toBe(activeEncounter.encounterId);
    expect(result.record.discharges).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it('does not duplicate a manual outcome when an administrative report lacks an episode id', () => {
    const encounter = makeEncounter({ encounterId: 'MANUAL-EPISODE' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord();
    current.discharges = [
      {
        id: 'manual-discharge',
        rut: patient.rut,
        clinicalEpisodeId: encounter.encounterId,
        admissionDate: patient.admissionDate,
        originalData: patient,
        movementProvenance: {
          source: 'manual',
          lineageId: 'manual-discharge',
          classifiedAt: NOW.toISOString(),
        },
      } as never,
    ];
    const diff = makeDiff({
      reportEgresos: [
        {
          run: patient.rut,
          patientName: patient.patientName,
          bedLabel: 'H1C2',
          destino: 'Domicilio',
          fechaEgreso: '08-07-2026 15:30',
          kind: 'alta',
          status: 'Vivo',
          admissionDay: patient.admissionDate,
          admissionTime: patient.admissionTime,
        },
      ],
    });

    const result = applyCensusImportDiff(current, diff, makeContext());

    expect(result.record.discharges).toHaveLength(1);
    expect(result.record.discharges[0]?.clinicalEpisodeId).toBe(encounter.encounterId);
  });

  it('keeps an episode-less report when its admission differs from an earlier manual outcome', () => {
    const encounter = makeEncounter({ encounterId: 'EARLIER-EPISODE' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord();
    current.discharges = [
      {
        id: 'earlier-discharge',
        rut: patient.rut,
        clinicalEpisodeId: encounter.encounterId,
        admissionDate: '2026-07-07',
        originalData: { ...patient, admissionDate: '2026-07-07', admissionTime: '09:00' },
      } as never,
    ];
    const diff = makeDiff({
      reportEgresos: [
        {
          run: patient.rut,
          patientName: patient.patientName,
          bedLabel: 'H1C2',
          destino: 'Domicilio',
          fechaEgreso: '08-07-2026 15:30',
          kind: 'alta',
          status: 'Vivo',
          admissionDay: '2026-07-08',
          admissionTime: '10:00',
        },
      ],
    });

    const result = applyCensusImportDiff(current, diff, makeContext());

    expect(result.record.discharges).toHaveLength(2);
  });

  it('keeps a readmission when an earlier manual outcome has no episode id', () => {
    const encounter = makeEncounter({ encounterId: 'NEW-EPISODE' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord();
    current.discharges = [
      {
        id: 'legacy-manual-discharge',
        rut: patient.rut,
        admissionDate: '2026-07-07',
        originalData: { ...patient, admissionDate: '2026-07-07', admissionTime: '09:00' },
      } as never,
    ];
    const diff = makeDiff({
      admissions: [
        {
          bedId: 'H1C2',
          patient,
          isCma: false,
        },
      ],
    });

    const result = applyCensusImportDiff(current, diff, makeContext());

    expect(result.applied.admissions).toBe(1);
    expect(result.record.beds.H1C2?.clinicalEpisodeId).toBe('NEW-EPISODE');
  });

  it('matches a legacy outcome to the encounter with the same admission timestamp', () => {
    const encounter = makeEncounter({ encounterId: 'CURRENT-EPISODE' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord();
    current.discharges = [
      {
        id: 'legacy-manual-discharge',
        rut: patient.rut,
        admissionDate: patient.admissionDate,
        originalData: patient,
      } as never,
    ];

    expect(createDischargedEncounterMatcher(current)(encounter)).toBe(true);
  });

  it('filters a stale discharge using its source admission timestamp', () => {
    const encounter = makeEncounter({ encounterId: 'CURRENT-EPISODE' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord({ H1C2: patient });
    current.discharges = [
      {
        id: 'legacy-manual-discharge',
        rut: patient.rut,
        originalData: {
          ...patient,
          firstSeenDate: '2026-07-09',
          admissionDate: patient.admissionDate,
        },
      } as never,
    ];
    const diff = makeDiff({
      discharges: [
        {
          bedId: 'H1C2',
          rut: patient.rut,
          patientName: patient.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: encounter.encounterId,
          source: encounter,
        },
      ],
    });

    expect(filterRecordedOutcomeActions(current, diff).discharges).toHaveLength(0);
  });

  it('keeps a same-day readmission when a legacy outcome lacks admission time', () => {
    const encounter = makeEncounter({ encounterId: 'LATER-SAME-DAY' });
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const current = makeRecord();
    current.discharges = [
      {
        id: 'legacy-manual-discharge',
        rut: patient.rut,
        admissionDate: patient.admissionDate,
        originalData: { ...patient, admissionTime: '' },
      } as never,
    ];
    const diff = makeDiff({
      admissions: [{ bedId: 'H1C2', patient, isCma: false }],
    });

    const result = applyCensusImportDiff(current, diff, makeContext());

    expect(result.applied.admissions).toBe(1);
    expect(result.record.beds.H1C2?.clinicalEpisodeId).toBe('LATER-SAME-DAY');
  });
});
