// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import {
  recoverMissingSnapshotPlacements,
  resolveOccupiedBedTraceability,
} from '@/features/rayen-import/bedTraceabilityResolver';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { collectEgresoLookupTargets } from '@/features/rayen-import/hooks/rayenSnapshotLookupTargets';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { EgresoLookupTarget } from '@/features/rayen-import/contracts/egresoLookup';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';

const DAY = '2026-10-27';
const PREVIOUS_DAY = '2026-10-26';
const NOW = new Date('2026-10-27T22:00:00Z');
// Synthetic 9-digit foreign document whose digits do NOT satisfy Chilean Mod-11 RUT check digit.
const NUMERIC_PASSPORT = '887766554';
// Synthetic 9-digit foreign document whose digits DO satisfy Chilean Mod-11 RUT check digit.
const MOD11_LUCKY_PASSPORT = '123456785';

const foreignStatisticalPdf = (doc: string) => `
Informe Estadístico de Egreso Hospitalario
5 5 6 SEXO F
5. Número de Documento identificador país de origen
1.RUN:
-
N° de Pasaporte u otro documento
${doc.split('').join(' ')} 54 IDENTIDAD DE GÉNERO
24 INGRESO 2 2 - 2 2 2 5 - 1 0 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
25 1er TRASLADO - - -
26 2° TRASLADO - - -
27 3er TRASLADO - - -
28 4° TRASLADO * - - -
29 EGRESO 1 3 - 1 0 2 7 - 1 0 - 2 6
30 DÍAS ESTADIA 0 0 0 2 31 1) VIVO 2) FALLECIDO 1
`;

const chileanRunStatisticalPdf = (run: string) => `
Informe Estadístico de Egreso Hospitalario
1.RUN:
${run.slice(0, -1).split('').join(' ')} - ${run.slice(-1)}
24 INGRESO 2 2 - 2 2 2 5 - 1 0 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 1 3 - 1 0 2 7 - 1 0 - 2 6
30 DÍAS ESTADIA 0 0 0 2 31 1) VIVO 2) FALLECIDO 1
`;

const makePassportPatient = (doc: string, episodeId = '910700'): PatientData => ({
  ...rayenToPatientData(
    {
      encounterId: episodeId,
      run: doc,
      documentType: 'Pasaporte',
      firstGivenName: 'CLARA',
      firstFamilyName: 'EXTRANJERA',
      birthDate: '1969-05-27',
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'Recuperación',
      bed: 'R1',
      admissionDatetime: '2026-10-25T22:22:03-05:00',
    },
    NOW
  ).patient,
  rut: doc,
  documentType: 'Pasaporte',
  documentManualOverride: true,
  clinicalEpisodeId: episodeId,
});

const recordWith = (date: string, patient?: PatientData): DailyRecord => ({
  date,
  beds: patient ? { R1: patient } : {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const bulkRow = (doc: string): EgresoReportRow => ({
  run: doc,
  patientName: 'CLARA EXTRANJERA',
  bedLabel: 'R1',
  servicio: 'Hospitalizados',
  edad: '57 años',
  destino: 'Domicilio',
  motivo: 'Alta',
  fechaEgreso: '27-10-2026 13:10',
});

describe('numeric passport administrative discharge verification (ID-01)', () => {
  it.each([
    ['non-RUT numeric passport', NUMERIC_PASSPORT],
    ['Mod-11-lucky numeric passport marked as Pasaporte', MOD11_LUCKY_PASSPORT],
  ])('verifies and vacates R1 for %s using DEIS Field 5 statistical PDF', async (_label, doc) => {
    const occupant = makePassportPatient(doc);
    const current = recordWith(DAY, occupant);
    const previous = recordWith(PREVIOUS_DAY, occupant);
    const snapshot: RayenCensusSnapshot = {
      capturedAt: NOW.toISOString(),
      facilityId: 1342,
      isComplete: true,
      encounters: [],
    };
    const lookupEgresos = vi.fn(async (targets: (string | EgresoLookupTarget)[]) =>
      targets.map(target => ({
        run: typeof target === 'string' ? target : target.run,
        encounterId: '910700',
        egreso: {
          id: 910700,
          startPeriod: '2026-10-25T22:22:03-05:00',
          endPeriod: '2026-10-27T13:15:00-05:00',
        },
      }))
    );
    const repository = {
      getAuthoritativeForDate: vi.fn(async () => previous),
      getForDate: vi.fn().mockResolvedValue(null),
      getLocalForDateWithMeta: vi.fn().mockResolvedValue({
        record: null,
        hasPendingWrites: false,
        hasPendingWritesForDate: false,
        writeState: 'none',
      }),
    } as unknown as DailyRecordRepositoryPort;

    const { diff } = await prepareRayenStructuralPlan({
      baseRecord: current,
      planningSnapshot: snapshot,
      bundle: {
        id: 'synthetic-passport-sync',
        startedAt: NOW.toISOString(),
        completedAt: NOW.toISOString(),
        facilityId: 1342,
        dateStart: DAY,
        dateEnd: DAY,
        fichaMedicoCapturedAt: NOW.toISOString(),
        gestionCamasCapturedAt: NOW.toISOString(),
        sourceSkewMs: 0,
        egresoRows: [bulkRow(doc)],
      },
      isHistoricalDay: false,
      invalidEpisodeIds: new Set<string>(),
      reportDate: DAY,
      dailyRecord: repository,
      isAdmin: true,
      counters: { requests: 0, cacheHits: 0, timeouts: 0 },
      measureEvidence: operation => operation(),
      evidenceClient: {
        lookupHospitalizations: vi.fn().mockResolvedValue({ ok: false }),
        lookupEgresos,
        fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
        fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      },
      extractStatisticalText: vi.fn().mockResolvedValue(foreignStatisticalPdf(doc)),
    });

    expect(lookupEgresos).toHaveBeenCalledWith([
      expect.objectContaining({
        run: doc,
        encounterId: '910700',
        documentType: 'Pasaporte',
      }),
    ]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.discharges).toMatchObject([
      {
        bedId: 'R1',
        rut: doc,
        encounterId: '910700',
        correctedDay: DAY,
        correctedTime: '13:10',
        status: 'Vivo',
      },
    ]);

    const applied = applyCensusImportDiff(current, diff, {
      now: NOW,
      idFactory: () => 'synthetic-discharge-id',
      syncRunId: 'synthetic-run',
    }).record;
    expect(applied.beds.R1.patientName).toBe('');
    expect(applied.discharges).toMatchObject([
      { bedId: 'R1', rut: doc, clinicalEpisodeId: '910700', time: '13:10' },
    ]);
  });

  it('never verifies a Pasaporte patient against a Chilean 1.RUN statistical PDF (ID-01)', async () => {
    const result = await enrichReportOnlyDischarges([bulkRow(MOD11_LUCKY_PASSPORT)], DAY, {
      lookupEgresos: vi.fn().mockResolvedValue([
        {
          run: MOD11_LUCKY_PASSPORT,
          encounterId: '910700',
          egreso: { id: 910700, endPeriod: '2026-10-27T13:10:00-05:00' },
        },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(chileanRunStatisticalPdf(MOD11_LUCKY_PASSPORT)),
      previousCensusCandidates: [
        {
          run: MOD11_LUCKY_PASSPORT,
          documentType: 'Pasaporte',
          patientName: 'CLARA EXTRANJERA',
          encounterId: '910700',
          dischargeDay: DAY,
          fromClinicalCrib: false,
        },
      ],
    });
    expect(result).toEqual([
      { ...bulkRow(MOD11_LUCKY_PASSPORT), exactEpisodeVerification: 'unverified' },
    ]);
  });

  it('verifies a same-day short-stay numeric non-RUT passport directly from bulk report', async () => {
    const result = await enrichReportOnlyDischarges([bulkRow(NUMERIC_PASSPORT)], DAY, {
      lookupEgresos: vi.fn().mockResolvedValue([
        {
          run: NUMERIC_PASSPORT,
          encounterId: '910700',
          egreso: { id: 910700, endPeriod: '2026-10-27T13:10:00-05:00' },
        },
      ]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(foreignStatisticalPdf(NUMERIC_PASSPORT)),
    });
    expect(result[0]).toMatchObject({
      encounterId: '910700',
      exactEpisodeVerification: 'verified',
      admissionDay: '2026-10-25',
      admissionTime: '22:22',
      correctedDay: DAY,
      correctedTime: '13:10',
      dischargeStatus: 'Vivo',
    });
  });

  it('propagates documentType=Pasaporte in pendingAdministrativeDischarges lookup targets', () => {
    const diff = createEmptyCensusImportDiff(true);
    diff.pendingAdministrativeDischarges.push({
      bedId: 'R1',
      rut: NUMERIC_PASSPORT,
      documentType: 'Pasaporte',
      patientName: 'CLARA EXTRANJERA',
      signal: 'missing-from-ficha',
      encounterId: '910700',
      verification: {
        medicalEpicrisis: 'unknown',
        nursingEpicrisis: 'unknown',
        hospitalDischarge: 'unknown',
      },
    });
    expect(collectEgresoLookupTargets(diff)).toEqual([
      { run: NUMERIC_PASSPORT, encounterId: '910700', documentType: 'Pasaporte' },
    ]);
  });

  it('verifies Flujo del Paciente for numeric passport via Número de Identificación and rejects RUN headers', async () => {
    const occupant = makePassportPatient(NUMERIC_PASSPORT);
    const current = recordWith(DAY, occupant);
    const encounter: RayenEncounter = {
      encounterId: '910700',
      run: NUMERIC_PASSPORT,
      documentType: 'Pasaporte',
      firstGivenName: 'CLARA',
      firstFamilyName: 'EXTRANJERA',
      admissionDatetime: '2026-10-25T22:22:03-05:00',
      room: 'Recuperación',
      bed: 'R2',
    };
    const diff = createEmptyCensusImportDiff(true);
    diff.conflicts.push({
      bedId: 'R1',
      code: 'occupied-local-bed',
      rut: NUMERIC_PASSPORT,
      reason: 'synthetic',
    });
    const snapshot: RayenCensusSnapshot = {
      capturedAt: NOW.toISOString(),
      facilityId: 1342,
      isComplete: true,
      encounters: [encounter],
    };
    const passportFlow = `Flujo del Paciente Número de Identificación: ${NUMERIC_PASSPORT}\n26/10/2026 10:00:00 Área Médico Quirúrgico Recuperación R2`;
    const runFlow = `Flujo del Paciente RUN: ${NUMERIC_PASSPORT}\n26/10/2026 10:00:00 Área Médico Quirúrgico Recuperación R2`;

    const resolved = await resolveOccupiedBedTraceability(current, snapshot, diff, {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(passportFlow),
    });
    expect(resolved.encounters[0].verifiedBedPlacement?.bedId).toBe('R2');

    const rejected = await resolveOccupiedBedTraceability(current, snapshot, diff, {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      extractText: vi.fn().mockResolvedValue(runFlow),
    });
    expect(rejected.encounters[0].verifiedBedPlacement).toBeUndefined();

    const missingDiff = createEmptyCensusImportDiff(true);
    missingDiff.pendingAdministrativeDischarges.push({
      bedId: 'R1',
      rut: NUMERIC_PASSPORT,
      documentType: 'Pasaporte',
      patientName: 'CLARA EXTRANJERA',
      signal: 'missing-from-ficha',
      encounterId: '910700',
      verification: {
        medicalEpicrisis: 'unknown',
        nursingEpicrisis: 'unknown',
        hospitalDischarge: 'unknown',
      },
    });
    const recovered = await recoverMissingSnapshotPlacements(
      current,
      { ...snapshot, encounters: [] },
      missingDiff,
      [
        {
          run: NUMERIC_PASSPORT,
          encounterId: '910700',
          egreso: {
            id: 910700,
            hasAdministrativeDischarge: false,
            hasMedicalDischarge: false,
            hasNurseDischarge: false,
          },
        },
      ],
      {
        fetchReport: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
        extractText: vi.fn().mockResolvedValue(passportFlow),
      },
      () => missingDiff
    );
    expect(recovered.snapshot.encounters[0]?.verifiedBedPlacement?.bedId).toBe('R2');
  });
});
