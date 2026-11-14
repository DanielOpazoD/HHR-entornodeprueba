import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoLookupResult } from '@/features/rayen-import/contracts/egresoLookup';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

// Eloísa lists episode 111 as hospitalized but without room or bed, while HHR already has it in
// H4C1. Today the complete capture leaves the episode both as an unresolved location and as a
// pending administrative discharge. That pending entry is what makes the real pipeline ask
// Gestión de Camas for the exact episode and, when it is still active, read the official flow
// report to settle the bed. Only the external edges are simulated: the episode lookup and the
// flow report download (the PDF text extraction returns the synthetic text as is).
vi.mock('@/services/pdf/pdfTextExtractionRuntime', () => ({
  extractPdfTextFromBuffer: async (buffer: ArrayBuffer) =>
    new TextDecoder().decode(new Uint8Array(buffer)),
}));

const reference = new Date('2026-07-08T20:00:00-06:00');
const RUT = '11.111.111-1';

const placed: RayenEncounter = {
  encounterId: '111',
  run: RUT,
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
  birthDate: '1990-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H4',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
};
const withoutBed: RayenEncounter = { ...placed, room: undefined, bed: undefined };

const makeRecord = (): DailyRecord =>
  ({
    date: '2026-07-08',
    beds: { H4C1: { ...rayenToPatientData(placed, reference).patient, bedId: 'H4C1' } },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-07-08T10:00:00.000Z',
  }) as DailyRecord;

const snapshot = (isComplete: boolean): RayenCensusSnapshot => ({
  capturedAt: reference.toISOString(),
  facilityId: 1342,
  encounters: [withoutBed],
  isComplete,
});

const flowReport = (bedId: string) => ({
  base64: Buffer.from(
    `Paciente: Paciente Sintético RUN: 111111111\n08/07/2026 10:05:00 Servicio Sala Básica ${bedId}`,
    'utf8'
  ).toString('base64'),
});

const stillActive = {
  id: '111',
  hasAdministrativeDischarge: false,
  hasMedicalDischarge: false,
  hasNurseDischarge: false,
};
const administrativelyDischarged = {
  id: '111',
  hasAdministrativeDischarge: true,
  hasMedicalDischarge: true,
  hasNurseDischarge: true,
  dateDischarge: '2026-07-08T12:00:00-06:00',
};

type LookupAnswer = (target: { run: string; encounterId: string }) => EgresoLookupResult;

const run = async ({
  lookup,
  flowBedId,
  isComplete = true,
  silentLookup = false,
}: {
  lookup: LookupAnswer;
  flowBedId?: string;
  isComplete?: boolean;
  silentLookup?: boolean;
}) => {
  const record = makeRecord();
  const lookupEgresos = vi.fn(async (targets: Array<{ run: string; encounterId: string }>) =>
    silentLookup ? [] : targets.map(lookup)
  );
  const fetchPatientFlowReport = vi.fn(async () =>
    flowBedId ? flowReport(flowBedId) : { base64: '', error: 'unavailable' }
  );
  const diff = await replanRayenStructure(
    record,
    {
      sourceSnapshot: snapshot(isComplete),
      egresoRows: [],
      reportDate: record.date,
      isHistoricalDay: false,
      invalidEpisodeIds: new Set<string>(),
    },
    {
      dailyRecord: {
        getForDate: vi.fn().mockResolvedValue(null),
        getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
      } as unknown as DailyRecordRepositoryPort,
      isAdmin: false,
      fetchPatientFlowReport,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      lookupEgresos,
    }
  );
  const applied = applyCensusImportDiff(makeRecord(), diff, {
    now: reference,
    syncRunId: 'synthetic-run',
    idFactory: () => 'synthetic-id',
  }).record;
  return {
    diff,
    applied,
    lookedUpEpisodes: lookupEgresos.mock.calls.flatMap(([targets]) =>
      targets.map(target => target.encounterId)
    ),
    flowReportsFetched: fetchPatientFlowReport.mock.calls.length,
  };
};

const answer =
  (egreso: EgresoLookupResult['egreso']): LookupAnswer =>
  target => ({ ...target, egreso });

describe('replanRayenStructure: episode listed by Eloísa without a bed', () => {
  it('confirms the same bed from the flow report, with no conflict and no discharge', async () => {
    const result = await run({ lookup: answer(stillActive), flowBedId: 'H4C1' });

    expect(result.lookedUpEpisodes).toEqual(['111']);
    expect(result.flowReportsFetched).toBe(1);
    expect(result.diff.conflicts).toEqual([]);
    expect(result.diff.pendingAdministrativeDischarges).toEqual([]);
    expect(result.diff.discharges).toEqual([]);
    expect(result.diff.moves).toEqual([]);
    expect(result.diff.unchangedCount).toBe(1);
    expect(result.applied.beds.H4C1?.clinicalEpisodeId).toBe('111');
    expect(result.applied.discharges).toEqual([]);
  });

  it('proposes the verified transfer when the flow report places the episode in another bed', async () => {
    const result = await run({ lookup: answer(stillActive), flowBedId: 'H4C2' });

    expect(result.lookedUpEpisodes).toEqual(['111']);
    expect(result.flowReportsFetched).toBe(1);
    expect(result.diff.conflicts).toEqual([]);
    expect(result.diff.pendingAdministrativeDischarges).toEqual([]);
    expect(result.diff.discharges).toEqual([]);
    expect(result.diff.moves.map(move => [move.fromBedId, move.toBedId])).toEqual([
      ['H4C1', 'H4C2'],
    ]);
    expect(result.applied.beds.H4C2?.clinicalEpisodeId).toBe('111');
    expect(result.applied.beds.H4C1?.patientName).toBe('');
  });

  it('proposes the administrative discharge that Gestión de Camas confirms for the episode', async () => {
    const result = await run({ lookup: answer(administrativelyDischarged), flowBedId: 'H4C1' });

    expect(result.lookedUpEpisodes).toEqual(['111']);
    expect(result.flowReportsFetched).toBe(0);
    expect(result.diff.conflicts).toEqual([]);
    expect(result.diff.pendingAdministrativeDischarges).toEqual([]);
    expect(result.diff.moves).toEqual([]);
    expect(result.diff.discharges.map(entry => [entry.encounterId, entry.bedId])).toEqual([
      ['111', 'H4C1'],
    ]);
    expect(result.applied.beds.H4C1?.patientName).toBe('');
    expect(result.applied.discharges.map(entry => entry.clinicalEpisodeId)).toEqual(['111']);
  });

  it.each([
    // An error answer counts as already asked, so the second round does not repeat it.
    ['answers with an error', ['111']],
    // No answer at all leaves the episode unasked, so the second round asks again.
    ['returns no answer', ['111', '111']],
  ] as const)(
    'keeps the conflict and the pending review, without any discharge, when the lookup %s',
    async (failure, expectedLookups) => {
      const result = await run({
        lookup: target => ({ ...target, error: 'Gestión de Camas no respondió' }),
        flowBedId: 'H4C1',
        silentLookup: failure === 'returns no answer',
      });

      expect(result.lookedUpEpisodes).toEqual(expectedLookups);
      expect(result.flowReportsFetched).toBe(0);
      expect(
        result.diff.conflicts.map(conflict => [conflict.bedId, conflict.source?.encounterId])
      ).toEqual([[null, '111']]);
      expect(
        result.diff.pendingAdministrativeDischarges.map(entry => [
          entry.signal,
          entry.encounterId,
          entry.bedId,
        ])
      ).toEqual([['missing-from-ficha', '111', 'H4C1']]);
      expect(result.diff.discharges).toEqual([]);
      expect(result.diff.moves).toEqual([]);
      expect(result.applied.beds.H4C1?.clinicalEpisodeId).toBe('111');
      expect(result.applied.discharges).toEqual([]);
    }
  );

  it('neither looks up nor proposes anything from an incomplete capture', async () => {
    const result = await run({ lookup: answer(administrativelyDischarged), isComplete: false });

    expect(result.lookedUpEpisodes).toEqual([]);
    expect(result.flowReportsFetched).toBe(0);
    expect(result.diff.pendingAdministrativeDischarges).toEqual([]);
    expect(result.diff.discharges).toEqual([]);
    expect(result.diff.moves).toEqual([]);
    expect(result.diff.admissions).toEqual([]);
    expect(result.applied.beds.H4C1?.clinicalEpisodeId).toBe('111');
    expect(result.applied.discharges).toEqual([]);
  });
});
