import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { applyCensusImportDiff, rayenToPatientData } from '@/features/rayen-import';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { startCudyrSyncCapture } from '@/features/rayen-import/domain/startCudyrSyncCapture';
import { cudyrPlacementsFromPatientFlow } from '@/features/rayen-import/mapping/cudyrPatientFlowPlacements';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { persistClinicalBatch } from '@/features/rayen-import/domain/clinicalBatchPersistence';
import type {
  ClinicalFillDeps,
  ClinicalFillPatchOperation,
} from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { createDependencies } from './applyClinicalEnrichmentBatch.fixtures';

// Shapes that broke production in the week of 2026-11-02, driven from Eloísa's source rows through
// the production planner, the apply step and the clinical batch to what the sync would save.
// Only the browser bridge and the callable are substituted. All identities are synthetic.

const NOW = new Date('2026-11-07T12:00:00-05:00');
const DAY = '2026-11-07';

const encounter = (overrides: Partial<RayenEncounter> & { encounterId: string }) =>
  ({
    run: '144700554',
    firstGivenName: 'Paciente',
    firstFamilyName: 'Sintética',
    birthDate: '1990-01-01',
    administrativeSex: 'Mujer',
    service: 'Área Médico Quirúrgica Indiferenciada',
    room: 'H1',
    bed: 'C1',
    admissionDatetime: '2026-11-05T10:00:00-05:00',
    diagnosis: 'Diagnóstico sintético',
    ...overrides,
  }) satisfies RayenEncounter;

const seed = (source: RayenEncounter): PatientData => rayenToPatientData(source, NOW).patient;

const day = (beds: DailyRecord['beds']): DailyRecord => ({
  date: DAY,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${DAY}T10:00:00.000Z`,
  activeExtraBeds: [],
});

const snapshot = (encounters: RayenEncounter[], isComplete = true): RayenCensusSnapshot => ({
  capturedAt: NOW.toISOString(),
  facilityId: 1342,
  isComplete,
  encounters,
});

/** The production structural planner with the Eloísa bridge stubbed out. */
const sync = async (
  current: DailyRecord,
  encounters: RayenEncounter[],
  egresoRows: EgresoReportRow[] = [],
  isComplete = true
) => {
  const dailyRecord = {
    getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
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
    planningSnapshot: snapshot(encounters, isComplete),
    bundle: {
      id: 'synthetic-production-shapes',
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      facilityId: 1342,
      dateStart: current.date,
      dateEnd: current.date,
      fichaMedicoCapturedAt: NOW.toISOString(),
      gestionCamasCapturedAt: NOW.toISOString(),
      sourceSkewMs: 0,
      egresoRows,
    },
    isHistoricalDay: false,
    invalidEpisodeIds: new Set<string>(),
    reportDate: current.date,
    dailyRecord,
    isAdmin: true,
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: operation => operation(),
    extractStatisticalText: vi.fn().mockResolvedValue(''),
    evidenceClient: {
      lookupHospitalizations: vi.fn().mockResolvedValue({ ok: false }),
      lookupEgresos: vi.fn().mockResolvedValue([]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    },
  });
  let sequence = 0;
  const result = applyCensusImportDiff(current, diff, {
    now: NOW,
    actor: 'Profesional Sintético',
    syncRunId: 'synthetic-production-shapes',
    idFactory: () => `movement-${++sequence}`,
  });
  return { diff, ...result };
};

/** Movement recovery for one episode, reading Eloísa's flow report with the real parser. */
const recoverBedHistory = async (record: DailyRecord, episode: string, flowReport: string) => {
  const recover = vi.fn(
    async (
      id: string,
      rut: string,
      observedAt: string,
      identityKind?: 'patient' | 'maternal',
      maternalRut?: string
    ) => cudyrPlacementsFromPatientFlow(flowReport, id, rut, observedAt, identityKind, maternalRut)
  );
  const archive = vi.fn().mockResolvedValue('persisted');
  const run = startCudyrSyncCapture({
    record,
    censusDate: record.date,
    captureEpisodes: [episode],
    needsRead: true,
    deps: {
      fetchCudyrCategories: async () => ({
        items: [],
        source: 'gestion_camas',
        historyAvailable: true,
        observedEpisodeIds: [],
      }),
      archiveCudyrCapture: archive,
      recoverCudyrPlacements: recover,
      now: () => NOW,
      createId: () => 'capture',
    } as unknown as ClinicalFillDeps,
    trackRequest: operation => operation(),
    recordTimeout: vi.fn(),
  });
  const errors = await run.archive;
  return { errors, recover, archived: archive.mock.calls[0]?.[0]?.capture };
};

describe('Eloísa sync, production shapes of 2026-11-02 to 2026-11-08', () => {
  describe('(a) a newborn admitted at birth, known only by its delivery-receipt folio', () => {
    // Mother RUN 14.470.055-4. The folio 7906953 fails the RUT check digit.
    const MOTHER = '920001';
    const NEWBORN = '920002';
    const FOLIO_SHAPES = ['7906953', '790.695-3'];
    const mother = encounter({
      encounterId: MOTHER,
      room: 'H5',
      bed: 'C1',
      diagnosis: 'Puerperio',
    });
    const newborn = (overrides: Partial<RayenEncounter> = {}) =>
      encounter({
        encounterId: NEWBORN,
        run: '7906953',
        firstGivenName: 'RN de Paciente',
        birthDate: DAY,
        administrativeSex: 'Hombre',
        room: 'Cunas',
        bed: 'CH5C1',
        clinicalCribParentBedId: 'H5C1',
        admissionDatetime: `${DAY}T00:03:00-05:00`,
        diagnosis: 'Recién nacido',
        ...overrides,
      });
    const independent = (overrides: Partial<RayenEncounter> = {}) =>
      newborn({ room: 'Neo 1', bed: 'Neo1', clinicalCribParentBedId: undefined, ...overrides });
    // A record saved before #1326 kept the folio as the newborn's RUT.
    const storedIndependent = (): DailyRecord =>
      day({
        NEO1: { ...seed(independent()), rut: '790.695-3', neonatalMaternalRut: seed(mother).rut },
      });
    // Real report layout: the folio value wraps under its label and no RUN is printed.
    const birthReceiptFlowReport = `Paciente: RN de Número Folio Comprobante de Parto:
Paciente Sintética 7906953
Sexo: Hombre Edad: 0 año(s)
07/11/2026 00:03:00 Área médica indiferenciada Área Médica Pediátrica Cuidados Básicos Cuna R3 Cunas RN Cuna R3 Básica`;

    const expectNoFolio = (patient: PatientData | undefined) => {
      expect(patient?.clinicalEpisodeId).toBe(NEWBORN);
      expect(FOLIO_SHAPES).not.toContain(patient?.rut);
    };

    it('admits the newborn without the folio and reads its bed history by the mother', async () => {
      const saved = await sync(day({ H5C1: seed(mother) }), [mother, newborn()]);

      expect(saved.diff.conflicts).toEqual([]);
      const crib = saved.record.beds.H5C1?.clinicalCrib;
      expectNoFolio(crib);
      expect(crib?.identityStatus).toBe('provisional');
      expect(saved.record.beds.H5C1?.clinicalEpisodeId).toBe(MOTHER);
      expect(saved.record.beds.H5C1?.rut).toBe('14.470.055-4');

      const history = await recoverBedHistory(saved.record, NEWBORN, birthReceiptFlowReport);
      expect(history.recover).toHaveBeenCalledWith(
        NEWBORN,
        '144700554',
        NOW.toISOString(),
        'maternal',
        '144700554'
      );
      // A failed read would surface as a `bed_history` coverage issue on the sync.
      expect(history.errors).toEqual([]);
      expect(history.archived?.sourcePlacements).toMatchObject([
        { clinicalEpisodeId: NEWBORN, modality: 'cuna' },
      ]);
    });

    it('drops a stored folio when the newborn moves, closes or leaves', async () => {
      const moved = await sync(storedIndependent(), [independent({ room: 'Neo 2', bed: 'Neo2' })]);
      expect(moved.applied.moves).toBe(1);
      expectNoFolio(moved.record.beds.NEO2);

      const closed = await sync(storedIndependent(), [independent({ hasMedicalDischarge: true })]);
      expect(closed.diff.pendingAdministrativeDischarges).toHaveLength(1);
      expectNoFolio(closed.record.beds.NEO1);

      const nested = day({
        H5C1: {
          ...seed(mother),
          clinicalCrib: {
            ...seed(newborn()),
            rut: '790.695-3',
            neonatalMaternalRut: seed(mother).rut,
          },
        },
      });
      const discharged = await sync(
        nested,
        [mother],
        [
          {
            encounterId: NEWBORN,
            run: '7906953',
            patientName: 'RN de Paciente Sintética',
            bedLabel: 'CH5C1',
            servicio: 'Cunas',
            edad: '0',
            destino: 'Domicilio',
            motivo: 'Alta hospitalaria',
            fechaEgreso: '07-11-2026 11:00',
            correctedDay: DAY,
            correctedTime: '11:00',
            exactEpisodeVerification: 'verified',
          },
        ]
      );
      expect(discharged.record.discharges).toHaveLength(1);
      expectNoFolio(discharged.record.discharges[0] as unknown as PatientData);
      expect(discharged.record.beds.H5C1?.clinicalCrib?.patientName ?? '').toBe('');
    });
  });

  describe('(b) a clinical leaf stored as null on the server and absent in the local copy', () => {
    const EPISODE = '920101';
    const source = encounter({ encounterId: EPISODE, run: '111111111', room: 'H2', bed: 'C1' });
    const scores = (total?: number | null) => ({
      braden: { total: 16 },
      history: [
        { code: 'DOWNTON', encounterEventId: 1, ...(total === undefined ? {} : { total }) },
      ],
    });
    const withScores = (record: DailyRecord, total?: number | null): DailyRecord => {
      const copy = structuredClone(record);
      (copy.beds.H2C1 as unknown as { evaluationScores: unknown }).evaluationScores = scores(total);
      return { ...copy, meta: { revision: 2 } } as DailyRecord;
    };

    it('writes the clinical batch after a structural update instead of rejecting it', async () => {
      // The structural update runs first; its local result is the clinical run's base.
      const structural = await sync(withScores(day({ H2C1: seed(source) })), [
        { ...source, diagnosis: 'Diagnóstico sintético actualizado' },
      ]);
      expect(structural.applied.updates).toBe(1);
      const base = withScores(structural.record);
      const server = withScores(structural.record, null);

      const deps = createDependencies();
      deps.refreshRecord.mockResolvedValue(server);
      const desired = { braden: { total: 18 }, history: scores(null).history };
      const operations: ClinicalFillPatchOperation[] = [
        {
          target: { censusDate: DAY, bedId: 'H2C1', clinicalEpisodeId: EPISODE },
          patch: { 'beds.H2C1.evaluationScores': desired } as ClinicalFillPatchOperation['patch'],
          clinicalFieldCount: 1,
        },
      ];
      const strategy = createClinicalEnrichmentPersistenceStrategy({
        mode: 'enforced',
        record: base,
        runId: 'synthetic-null-leaf',
        refreshRecord: deps.refreshRecord,
        applyBatch: input =>
          applyClinicalEnrichmentBatch({
            ...input,
            invoke: deps.invoke,
            createMutationId: deps.createMutationId,
          }),
      });

      const result = await persistClinicalBatch({
        operations,
        strategy,
        applyWithMetrics: operation => operation(),
        recordRetries: vi.fn(),
        recordPersistenceEvidence: vi.fn(),
        wait: async () => undefined,
      });

      // Rejected, every patient of the run would stay pending until the next sync.
      expect(result).toMatchObject({ patched: 1, errors: [] });
      expect(deps.invoke).toHaveBeenCalledOnce();
      expect(deps.invoke.mock.calls[0]?.[0].patches).toMatchObject([
        { bedId: 'H2C1', clinicalEpisodeId: EPISODE, fields: { evaluationScores: desired } },
      ]);
    });
  });

  describe('(c) a patient identified by passport', () => {
    const PASSPORT = 'P111111111';
    const traveller = encounter({
      encounterId: '920201',
      run: PASSPORT,
      firstGivenName: 'Viajera',
      room: 'H3',
      bed: 'C1',
    });
    // Same digits as the passport: 11.111.111-1 is a valid RUT of another person.
    const resident = encounter({
      encounterId: '920202',
      run: '111111111',
      firstGivenName: 'Residente',
      room: 'H4',
      bed: 'C1',
    });

    it('keeps the passport as written through admission, move and a repeated sync', async () => {
      const admitted = await sync(day({}), [traveller]);
      expect(admitted.record.beds.H3C1).toMatchObject({
        clinicalEpisodeId: '920201',
        rut: PASSPORT,
        documentType: 'Pasaporte',
      });

      const moved = await sync(admitted.record, [{ ...traveller, room: 'H3', bed: 'C2' }]);
      expect(moved.applied.moves).toBe(1);
      expect(moved.record.beds.H3C2).toMatchObject({ rut: PASSPORT, documentType: 'Pasaporte' });

      const repeated = await sync(moved.record, [{ ...traveller, room: 'H3', bed: 'C2' }]);
      expect(repeated.applied).toEqual({ admissions: 0, updates: 0, moves: 0, discharges: 0 });
      expect(repeated.record.beds.H3C2).toMatchObject({ rut: PASSPORT });
    });

    it('never matches a passport occupant to a RUT with the same digits', async () => {
      // Entered by hand in HHR: no Eloísa episode yet, so the document is the only link.
      const manual = { ...seed(traveller), clinicalEpisodeId: undefined };
      const saved = await sync(day({ H3C1: manual }), [traveller, resident]);

      expect(saved.diff.conflicts).toEqual([]);
      expect(saved.record.beds.H3C1).toMatchObject({
        rut: PASSPORT,
        documentType: 'Pasaporte',
        clinicalEpisodeId: '920201',
      });
      expect(saved.record.beds.H4C1).toMatchObject({
        rut: '11.111.111-1',
        documentType: 'RUT',
        clinicalEpisodeId: '920202',
      });
    });
  });

  describe('(d) the same RUT with two Eloísa episodes in two beds (seen 2026-11-05)', () => {
    const FIRST = '920301';
    const SECOND = '920302';
    const first = encounter({ encounterId: FIRST, run: '123456785', room: 'H1', bed: 'C1' });
    const second = encounter({
      encounterId: SECOND,
      run: '123456785',
      room: 'H6',
      bed: 'C1',
      admissionDatetime: '2026-11-05T14:20:00-05:00',
    });

    it('keeps both episodes in their own beds and closes only the one Eloísa discharged', async () => {
      const saved = await sync(day({ H1C1: seed(first) }), [first, second]);

      expect(saved.diff.conflicts).toEqual([]);
      expect(saved.applied).toMatchObject({ admissions: 1, moves: 0, discharges: 0 });
      expect(saved.record.beds.H1C1).toMatchObject({
        clinicalEpisodeId: FIRST,
        rut: '12.345.678-5',
      });
      expect(saved.record.beds.H6C1).toMatchObject({
        clinicalEpisodeId: SECOND,
        rut: '12.345.678-5',
      });

      const repeated = await sync(saved.record, [first, second]);
      expect(repeated.applied).toEqual({ admissions: 0, updates: 0, moves: 0, discharges: 0 });

      // A partial read that lists only the second episode: the first neither leaves nor lends it
      // its bed (CEN-01).
      const partial = await sync(day({ H1C1: seed(first) }), [second], [], false);
      expect(partial.applied).toMatchObject({ admissions: 1, moves: 0, discharges: 0 });
      expect(partial.record.beds.H1C1).toMatchObject({ clinicalEpisodeId: FIRST });
      expect(partial.record.beds.H6C1).toMatchObject({ clinicalEpisodeId: SECOND });

      const closed = await sync(
        saved.record,
        [first],
        [
          {
            encounterId: SECOND,
            run: '12.345.678-5',
            patientName: 'Paciente Sintética',
            bedLabel: 'C1',
            servicio: 'Área Médico Quirúrgica Indiferenciada',
            edad: '36',
            destino: 'Domicilio',
            motivo: 'Alta hospitalaria',
            fechaEgreso: '07-11-2026 11:00',
            correctedDay: DAY,
            correctedTime: '11:00',
            exactEpisodeVerification: 'verified',
          },
        ]
      );
      expect(closed.record.discharges.map(entry => entry.clinicalEpisodeId)).toEqual([SECOND]);
      expect(closed.record.beds.H1C1).toMatchObject({ clinicalEpisodeId: FIRST });
      expect(closed.record.beds.H6C1?.patientName ?? '').toBe('');
    });
  });
});
