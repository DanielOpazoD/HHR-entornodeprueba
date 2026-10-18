import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { recoverPreviousCensusDischarges } from '@/features/rayen-import/domain/recoverPreviousCensusDischarges';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  EgresoLookupResult,
  EgresoLookupTarget,
} from '@/features/rayen-import/contracts/egresoLookup';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

const now = new Date('2026-10-03T02:00:00Z'); // Still October 2 in Rapa Nui.
const patient = {
  ...EMPTY_PATIENT,
  bedId: 'H6C2',
  patientName: 'Paciente Sintético',
  rut: '8.260.364-6',
  clinicalEpisodeId: '1001',
  admissionDate: '2026-10-01',
  admissionTime: '10:00',
};
const record = (date = '2026-10-02'): DailyRecord => ({
  date,
  beds: { H6C2: { ...EMPTY_PATIENT, bedId: 'H6C2' } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const snapshot: RayenCensusSnapshot = {
  capturedAt: now.toISOString(),
  facilityId: 1342,
  isComplete: true,
  encounters: [],
};
const result: EgresoLookupResult = {
  run: patient.rut,
  encounterId: patient.clinicalEpisodeId,
  egreso: {
    id: 1001,
    hasAdministrativeDischarge: true,
    dateDischarge: '2026-10-02T15:10:00-05:00',
    dischargeDestination: 'Domicilio',
    isDead: false,
  },
};
const fixture = () => {
  const previous: DailyRecord = { ...record('2026-10-01'), beds: { H6C2: { ...patient } } };
  const lookupEgresos = vi.fn(async (targets: Array<string | EgresoLookupTarget>) =>
    targets.length ? [result] : []
  );
  const dailyRecord = {
    getAuthoritativeForDate: vi.fn(async (day: string) =>
      day === previous.date ? previous : null
    ),
    getForDate: vi.fn(async (day: string) => (day === previous.date ? previous : null)),
    getLocalForDateWithMeta: vi.fn().mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  } as unknown as DailyRecordRepositoryPort;
  const fetchStatisticalDischarge = vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' });
  const extractText = vi.fn().mockResolvedValue('');
  const prepare = (baseRecord = record(), source = snapshot, historical = false) =>
    prepareRayenStructuralPlan({
      baseRecord,
      planningSnapshot: source,
      bundle: {
        id: 'synthetic-absent-discharge',
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        facilityId: 1342,
        dateStart: baseRecord.date,
        dateEnd: baseRecord.date,
        fichaMedicoCapturedAt: now.toISOString(),
        gestionCamasCapturedAt: now.toISOString(),
        sourceSkewMs: 0,
        egresoRows: [],
      },
      isHistoricalDay: historical,
      reportDate: baseRecord.date,
      dailyRecord,
      isAdmin: true,
      counters: { requests: 0, cacheHits: 0, timeouts: 0 },
      measureEvidence: operation => operation(),
      extractStatisticalText: extractText,
      evidenceClient: {
        lookupHospitalizations: vi.fn().mockResolvedValue({ ok: false }),
        lookupEgresos,
        fetchStatisticalDischarge,
        fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      },
    });
  return { prepare, lookupEgresos, previous, fetchStatisticalDischarge, extractText };
};
const apply = (
  current: DailyRecord,
  diff: Awaited<ReturnType<ReturnType<typeof fixture>['prepare']>>['diff']
) =>
  applyCensusImportDiff(current, diff, {
    now,
    idFactory: () => `recovered-${current.discharges.length + 1}`,
    syncRunId: 'recovery',
  }).record;

describe('D-1 departure absent from both live census and bulk report', () => {
  it.each(['E9876543', 'F9876543'])(
    'retains the passport prefix when verifying an exact D-1 discharge: %s',
    async returnedIdentifier => {
      const { previous } = fixture();
      const diff = createEmptyCensusImportDiff(true);
      previous.beds.H6C2 = { ...patient, rut: 'E9876543', documentType: 'Pasaporte' };
      const rows = await recoverPreviousCensusDischarges(
        previous,
        record(),
        diff,
        snapshot,
        async () => [{ ...result, run: returnedIdentifier }]
      );
      expect(rows).toHaveLength(returnedIdentifier === 'E9876543' ? 1 : 0);
    }
  );

  it('recovers an official discharge after manual bed clearing', async () => {
    const { prepare, lookupEgresos } = fixture();
    const current = record();
    const { diff, replanDiff } = await prepare(current);
    expect(lookupEgresos).toHaveBeenCalledWith([{ run: patient.rut, encounterId: '1001' }]);
    expect(diff.admissions).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(diff.reportEgresos).toEqual([
      expect.objectContaining({
        encounterId: '1001',
        correctedDay: '2026-10-02',
        correctedTime: '15:10',
        admissionDay: '2026-10-01',
      }),
    ]);
    const applied = apply(current, diff);
    expect(applied.beds.H6C2.patientName).toBe('');
    expect(applied.discharges).toEqual([
      expect.objectContaining({
        clinicalEpisodeId: '1001',
        movementDate: '2026-10-02',
        time: '15:10',
      }),
    ]);
    const again = await prepare(applied);
    expect(again.diff.reportEgresos ?? []).toEqual([]);
    expect(again.diff.conflicts).toEqual([]);
    const replanned = await replanDiff(applied);
    expect(replanned.reportEgresos ?? []).toEqual([]);
    expect(replanned.conflicts).toEqual([]);
  });

  it('recovers after the manually registered movement was deleted', async () => {
    const { prepare } = fixture();
    const current = record();
    const original = apply(current, (await prepare(current)).diff);
    original.discharges[0].deletedAt = now.toISOString();
    const recovered = apply(original, (await prepare(original)).diff);
    expect(recovered.discharges.filter(row => !row.deletedAt)).toHaveLength(1);
    expect((await prepare(recovered)).diff.conflicts).toEqual([]);
  });

  it('preserves a replacement in the same bed, including a new episode of the same RUN', async () => {
    const { prepare } = fixture();
    const current = record();
    current.beds.H6C2 = {
      ...patient,
      clinicalEpisodeId: '2002',
      admissionDate: '2026-10-02',
      admissionTime: '16:00',
    };
    const source = {
      ...snapshot,
      encounters: [
        {
          encounterId: '2002',
          run: patient.rut,
          firstGivenName: 'Paciente',
          firstFamilyName: 'Sintético',
          bed: 'H6C2',
          room: 'H6',
          admissionDatetime: '2026-10-02T16:00:00-05:00',
        },
      ],
    };
    const { diff } = await prepare(current, source);
    const applied = apply(current, diff);
    expect(applied.beds.H6C2.clinicalEpisodeId).toBe('2002');
    expect(applied.discharges.map(row => row.clinicalEpisodeId)).toEqual(['1001']);
  });

  it.each([
    [
      'active episode',
      { ...result, egreso: { ...result.egreso, hasAdministrativeDischarge: false } },
    ],
    [
      'implicit closure',
      {
        ...result,
        egreso: {
          ...result.egreso,
          hasAdministrativeDischarge: undefined,
          dateDischarge: undefined,
          endPeriod: result.egreso?.dateDischarge,
        },
      },
    ],
    ['wrong episode', { ...result, encounterId: '2002' }],
    ['wrong RUN', { ...result, run: '11.111.111-1' }],
    ['wrong metadata ID', { ...result, egreso: { ...result.egreso, id: 2002 } }],
    [
      'contradictory metadata episode',
      { ...result, egreso: { ...result.egreso, encounterId: 2002 } },
    ],
    ['lookup error with stale payload', { ...result, error: 'unavailable' }],
    ['invalid timestamp', { ...result, egreso: { ...result.egreso, dateDischarge: 'invalid' } }],
    [
      'future discharge',
      { ...result, egreso: { ...result.egreso, dateDischarge: '2026-10-03T15:10:00-05:00' } },
    ],
    [
      'before admission',
      { ...result, egreso: { ...result.egreso, dateDischarge: '2026-10-01T09:00:00-05:00' } },
    ],
  ] satisfies Array<[string, EgresoLookupResult]>)(
    'retains the identified conflict for %s',
    async (_label, response) => {
      const { prepare, lookupEgresos } = fixture();
      lookupEgresos.mockResolvedValue([response]);
      const { diff } = await prepare();
      expect(diff.reportEgresos ?? []).toEqual([]);
      expect(diff.discharges).toEqual([]);
      expect(diff.conflicts).toEqual([
        expect.objectContaining({
          code: 'previous-census-continuity',
          caseContext: expect.objectContaining({ bedId: 'H6C2', patientName: patient.patientName }),
        }),
      ]);
    }
  );

  it('keeps the conflict after a timeout and succeeds on a new synchronization', async () => {
    const { prepare, lookupEgresos } = fixture();
    lookupEgresos.mockRejectedValueOnce(new Error('timeout'));
    expect((await prepare()).diff.conflicts).toHaveLength(1);
    expect((await prepare()).diff.reportEgresos).toHaveLength(1);
  });

  it('accepts the exact administrative discharge date when an older response omits its boolean flag', async () => {
    const { prepare, lookupEgresos } = fixture();
    lookupEgresos.mockResolvedValue([
      {
        ...result,
        egreso: { ...result.egreso, hasAdministrativeDischarge: undefined },
      },
    ]);
    const { diff } = await prepare();
    expect(diff.reportEgresos).toEqual([
      expect.objectContaining({
        encounterId: '1001',
        correctedDay: '2026-10-02',
        correctedTime: '15:10',
      }),
    ]);
    expect(diff.conflicts).toEqual([]);
  });

  it('does not use a live source episode as evidence of absence', async () => {
    const { prepare, lookupEgresos } = fixture();
    const source = {
      ...snapshot,
      encounters: [
        {
          encounterId: '1001',
          run: patient.rut,
          firstGivenName: 'Paciente',
          firstFamilyName: 'Sintético',
          bed: 'H6C2',
          room: 'H6',
          admissionDatetime: '2026-10-01T10:00:00-05:00',
        },
      ],
    };
    const { diff } = await prepare(record(), source);
    expect(lookupEgresos.mock.calls.flatMap(([targets]) => targets)).toEqual([]);
    expect(diff.reportEgresos ?? []).toEqual([]);
  });

  it('preserves crib scope despite the shared maternal RUN', async () => {
    const { prepare, previous } = fixture();
    previous.beds.H6C2 = { ...EMPTY_PATIENT, bedId: 'H6C2', clinicalCrib: patient };
    const { diff } = await prepare();
    expect(diff.reportEgresos?.[0].fromClinicalCrib).toBe(true);
    expect(apply(record(), diff).discharges[0].isNested).toBe(true);
  });
  it('queries the exact known newborn episode through its mother without assigning her RUN', async () => {
    const { prepare, previous, lookupEgresos, fetchStatisticalDischarge, extractText } = fixture();
    fetchStatisticalDischarge.mockResolvedValue({ base64: 'cGRm', error: undefined });
    extractText.mockResolvedValue(`5 2 6 SEXO M
2. RUN Materno/progenitor(a)
1.RUN:
-
No de Pasaporte u otro documento
1. Masculino
8 2 6 0 3 6 4 6 54 IDENTIDAD DE GÉNERO 01
24 INGRESO 1 0 - 0 0 0 1 - 1 0 - 2 6 Unidad
29 EGRESO 0 0 - 1 7 0 2 - 1 0 - 2 6`);
    const mother = { ...patient, clinicalEpisodeId: '2002', patientName: 'Madre Sintética' };
    const newborn = { ...patient, patientName: 'RN de Madre Sintética', age: '1d', rut: '' };
    previous.beds.H6C2 = { ...mother, clinicalCrib: newborn };
    const current = record();
    current.beds.H6C2 = { ...mother };
    lookupEgresos.mockResolvedValue([
      { ...result, egreso: { ...result.egreso, dateDischarge: '2026-10-01T22:17:00-05:00' } },
    ]);

    const { diff } = await prepare(current);

    expect(lookupEgresos).toHaveBeenCalledWith([{ run: mother.rut, encounterId: '1001' }]);
    expect(diff.reportEgresos).toEqual([
      expect.objectContaining({
        encounterId: '1001',
        run: '',
        fromClinicalCrib: true,
        correctedDay: '2026-10-01',
        correctedTime: '00:17',
      }),
    ]);
    expect(diff.previousDayEdits).toEqual(
      expect.arrayContaining([expect.objectContaining({ day: '2026-10-01' })])
    );
    expect(diff.conflicts).toEqual([]);
    expect(apply(current, diff).beds.H6C2.clinicalEpisodeId).toBe('2002');
  });
  it.each(['mother episode returned', 'ambiguous mother', 'unlinked standalone newborn'])(
    'retains newborn review when %s',
    async kind => {
      const { prepare, previous, lookupEgresos } = fixture();
      const mother = { ...patient, clinicalEpisodeId: '2002', patientName: 'Madre Sintética' };
      const newborn = { ...patient, patientName: 'RN de Madre Sintética', age: '1d', rut: '' };
      previous.beds.H6C2 = { ...mother, clinicalCrib: newborn };
      const current = record();
      current.beds.H6C2 = { ...mother };
      if (kind === 'mother episode returned')
        lookupEgresos.mockResolvedValue([{ ...result, egreso: { ...result.egreso, id: 2002 } }]);
      if (kind === 'ambiguous mother') previous.beds.R3 = { ...mother, clinicalEpisodeId: '3003' };
      if (kind === 'unlinked standalone newborn') {
        previous.beds.H6C2 = newborn;
        previous.beds.R3 = mother;
      }
      const { diff } = await prepare(current);
      expect(diff.reportEgresos ?? []).toEqual([]);
      expect(diff.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'previous-census-continuity',
            patientName: newborn.patientName,
          }),
        ])
      );
      if (kind !== 'mother episode returned')
        expect(lookupEgresos.mock.calls.flatMap(([targets]) => targets)).not.toContainEqual(
          expect.objectContaining({ encounterId: '1001' })
        );
    }
  );
  it('assigns an after-midnight discharge to the selected night census', async () => {
    const { prepare, lookupEgresos } = fixture();
    lookupEgresos.mockResolvedValue([
      { ...result, egreso: { ...result.egreso, dateDischarge: '2026-10-03T01:10:00-05:00' } },
    ]);
    const { diff } = await prepare();
    expect(diff.reportEgresos?.[0]).toMatchObject({
      correctedDay: '2026-10-02',
      correctedTime: '01:10',
    });
    expect(diff.conflicts).toEqual([]);
  });

  it('routes a verified D-1 discharge to that day instead of creating a current-day movement', async () => {
    const { prepare, lookupEgresos } = fixture();
    lookupEgresos.mockResolvedValue([
      { ...result, egreso: { ...result.egreso, dateDischarge: '2026-10-01T15:10:00-05:00' } },
    ]);
    const { diff } = await prepare();
    expect(diff.previousDayEdits).toEqual(
      expect.arrayContaining([expect.objectContaining({ day: '2026-10-01' })])
    );
    expect(apply(record(), diff).discharges).toEqual([]);
    expect(diff.conflicts).toEqual([]);
  });

  it.each(['missing episode', 'duplicate episode', 'duplicate response'])(
    'keeps ambiguity visible: %s',
    async kind => {
      const { prepare, previous, lookupEgresos } = fixture();
      if (kind === 'missing episode') previous.beds.H6C2.clinicalEpisodeId = '';
      if (kind === 'duplicate episode') previous.beds.H6C2.clinicalCrib = { ...patient };
      if (kind === 'duplicate response') lookupEgresos.mockResolvedValue([result, result]);
      const { diff } = await prepare();
      expect(diff.reportEgresos ?? []).toEqual([]);
      expect(diff.conflicts.length).toBeGreaterThan(0);
    }
  );
  it('leaves historical reconstruction in its existing evidence path', async () => {
    const { prepare, lookupEgresos } = fixture();
    const { diff } = await prepare(record(), snapshot, true);
    expect(lookupEgresos.mock.calls.flatMap(([targets]) => targets)).toEqual([]);
    expect(diff.reportEgresos ?? []).toEqual([]);
    expect(diff.conflicts).toEqual([
      expect.objectContaining({ code: 'previous-census-continuity' }),
    ]);
  });
});

it('uses preserved maternal identity and the exact PDF after the mother has already left', async () => {
  const { prepare, previous, lookupEgresos, fetchStatisticalDischarge, extractText } = fixture();
  previous.beds.H6C2 = {
    ...EMPTY_PATIENT,
    bedId: 'H6C2',
    clinicalCrib: { ...patient, rut: '', neonatalMaternalRut: patient.rut, bedMode: 'Cuna' },
  };
  lookupEgresos.mockResolvedValue([
    { ...result, egreso: { id: 1001, endPeriod: '2026-10-01T22:19:00-05:00' } },
  ]);
  fetchStatisticalDischarge.mockResolvedValue({ base64: 'cGRm', error: undefined });
  extractText.mockResolvedValue(`5 2 6 SEXO M
2. RUN Materno/progenitor(a)
1.RUN:
-
No de Pasaporte u otro documento
1. Masculino
8 2 6 0 3 6 4 6 54 IDENTIDAD DE GÉNERO 01
24 INGRESO 1 0 - 0 0 0 1 - 1 0 - 2 6 Unidad
29 EGRESO 0 0 - 1 9 0 2 - 1 0 - 2 6`);
  const { diff } = await prepare();
  expect(diff.conflicts).toEqual([]);
  expect(diff.reportEgresos).toEqual([
    expect.objectContaining({
      encounterId: '1001',
      run: '',
      correctedDay: '2026-10-01',
      correctedTime: '00:19',
    }),
  ]);
});

it('rejects a type-1 maternal report returned for a blank-RUN newborn', async () => {
  const { prepare, previous, fetchStatisticalDischarge, extractText } = fixture();
  previous.beds.H6C2 = {
    ...EMPTY_PATIENT,
    bedId: 'H6C2',
    clinicalCrib: { ...patient, rut: '', neonatalMaternalRut: patient.rut, bedMode: 'Cuna' },
  };
  fetchStatisticalDischarge.mockResolvedValue({ base64: 'cGRm', error: undefined });
  extractText.mockResolvedValue(`1.RUN:
8 2 6 0 3 6 4 - 6
24 INGRESO 1 0 - 0 0 0 1 - 1 0 - 2 6 Unidad
29 EGRESO 0 0 - 1 9 0 2 - 1 0 - 2 6`);
  const { diff } = await prepare();
  expect(diff.reportEgresos ?? []).toEqual([]);
  expect(diff.conflicts).toHaveLength(1);
});
