import { describe, expect, it } from 'vitest';
import { mergeReportScales, type EvaluationScale } from '@/features/rayen-import';
import type { PatientData } from '@/types/domain/patient';

const patient = (over: Partial<PatientData> = {}): PatientData =>
  ({
    patientName: 'Ana Perez',
    rut: '1-9',
    clinicalEpisodeId: 'E1',
    ...over,
  }) as unknown as PatientData;

const scale = (over: Partial<EvaluationScale>): EvaluationScale => ({
  code: 'BRADEN',
  name: 'Escala de riesgo UPP (Braden)',
  encounterEventId: 1,
  recordedDate: '2026-07-10',
  recordedAt: '10-07-2026 08:00:00 -06:00',
  author: 'Enf. Ejemplo',
  authorRole: 'Enfermera(o)',
  items: [
    {
      id: 'BRAD_Percepcion',
      label: 'Percepción sensorial',
      value: '8019',
      valueName: 'No Limitado',
    },
  ],
  total: 17,
  severity: 'Riesgo bajo',
  ...over,
});

const BRADEN_D10 = scale({ encounterEventId: 100, total: 17, recordedDate: '2026-07-10' });
const DOWNTON_D9 = scale({
  code: 'DOWNTON',
  name: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
  encounterEventId: 90,
  total: 3,
  severity: 'Riesgo bajo',
  recordedDate: '2026-07-09',
});
const DOWNTON_D10 = scale({
  code: 'DOWNTON',
  name: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
  encounterEventId: 110,
  total: 5,
  severity: 'Riesgo alto',
  recordedDate: '2026-07-10',
});

describe('mergeReportScales', () => {
  it('stores current braden + downton (as-of the census day) with items, plus compact history', () => {
    const result = mergeReportScales(patient(), [BRADEN_D10, DOWNTON_D9, DOWNTON_D10], {
      censusIsoDay: '2026-07-10',
    });
    const scores = result.evaluationScores!;
    expect(scores.braden?.total).toBe(17);
    expect(scores.braden?.items).toHaveLength(1); // current entries keep the breakdown
    expect(scores.downton?.total).toBe(5); // day-10 Downton wins over the day-9 one
    // History is most-recent-first and compact (no per-item breakdown).
    expect(scores.history?.map(e => e.encounterEventId)).toEqual([110, 100, 90]);
    expect(scores.history?.every(e => e.items === undefined)).toBe(true);
    // Who applied it travels with every entry — feeds the census hover card.
    expect(scores.braden?.author).toBe('Enf. Ejemplo');
    expect(scores.braden?.authorRole).toBe('Enfermera(o)');
    expect(scores.history?.every(e => e.author === 'Enf. Ejemplo')).toBe(true);
  });

  it("as of a past census day, uses that day's value and omits later ones", () => {
    const result = mergeReportScales(patient(), [DOWNTON_D9, DOWNTON_D10], {
      censusIsoDay: '2026-07-09',
    });
    expect(result.evaluationScores?.downton?.total).toBe(3); // the day-9 record, not the day-10 one
    // The backdated snapshot must not expose the later application in its history.
    expect(result.evaluationScores?.history).toHaveLength(1);
    expect(result.evaluationScores?.history?.[0].recordedDate).toBe('2026-07-09');
  });

  it('returns the patient untouched when there are no scales', () => {
    const before = patient();
    expect(mergeReportScales(before, [], { censusIsoDay: '2026-07-10' })).toBe(before);
  });

  it('prefers the latest visible Braden on a day while retaining a later archived application', () => {
    const activeLow = scale({
      encounterEventId: 20260723110000,
      total: 17,
      severity: 'Riesgo bajo',
      recordedDate: '2026-07-23',
      recordedAt: '2026-07-23T11:00:00',
    });
    const archivedHigh = scale({
      encounterEventId: 20260723130000,
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-23',
      recordedAt: '2026-07-23T13:00:00',
      archived: true,
    });

    const scores = mergeReportScales(patient(), [activeLow, archivedHigh], {
      censusIsoDay: '2026-07-26',
    }).evaluationScores!;

    expect(scores.braden?.total).toBe(17);
    expect(scores.braden?.severity).toBe('Riesgo bajo');
    expect(scores.braden?.recordedDate).toBe('2026-07-23');
    expect(scores.braden?.latestApplication).toMatchObject({
      recordedDate: '2026-07-23',
      archived: true,
    });
    expect(scores.history?.map(item => [item.recordedDate, item.archived ?? false])).toEqual([
      ['2026-07-23', true],
      ['2026-07-23', false],
    ]);
  });

  it('uses the latest archived result when it is the only application of the latest day', () => {
    const previousVisible = scale({
      encounterEventId: 20260722110000,
      total: 17,
      severity: 'Riesgo bajo',
      recordedDate: '2026-07-22',
      recordedAt: '2026-07-22T11:00:00',
    });
    const latestArchived = scale({
      encounterEventId: 20260723130000,
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-23',
      recordedAt: '2026-07-23T13:00:00',
      archived: true,
    });

    const braden = mergeReportScales(patient(), [previousVisible, latestArchived], {
      censusIsoDay: '2026-07-26',
    }).evaluationScores?.braden;

    expect(braden).toMatchObject({
      total: 11,
      severity: 'Riesgo alto',
      recordedDate: '2026-07-23',
      archived: true,
    });
  });

  it('is referentially stable on retry and converges a correction for the same source event', () => {
    const first = mergeReportScales(patient(), [BRADEN_D10], { censusIsoDay: '2026-07-10' });
    expect(mergeReportScales(first, [BRADEN_D10], { censusIsoDay: '2026-07-10' })).toBe(first);

    const corrected = { ...BRADEN_D10, total: 11, severity: 'Riesgo alto' };
    const result = mergeReportScales(first, [corrected], { censusIsoDay: '2026-07-10' });
    expect(result.evaluationScores?.history).toHaveLength(1);
    expect(result.evaluationScores?.braden?.total).toBe(11);
  });

  it('preserves antecedents omitted from a shorter incremental window', () => {
    const older = scale({
      encounterEventId: 50,
      recordedDate: '2026-06-01',
      recordedAt: '2026-06-01T08:00:00',
      total: 19,
    });
    const before = mergeReportScales(patient(), [older], { censusIsoDay: '2026-07-10' });
    const result = mergeReportScales(before, [BRADEN_D10], { censusIsoDay: '2026-07-10' });

    expect(result.evaluationScores?.history?.map(item => item.recordedDate)).toEqual([
      '2026-07-10',
      '2026-06-01',
    ]);
  });

  it('does not prune facts outside the explicit window from partial or authoritative evidence', () => {
    const storedFuture = scale({
      encounterEventId: 200,
      recordedDate: '2026-07-12',
      recordedAt: '2026-07-12T08:00:00',
    });
    const before = patient({
      evaluationScores: { history: [{ ...storedFuture, items: undefined }] },
    });

    const partial = mergeReportScales(before, [BRADEN_D10], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'partial',
    });
    const authoritative = mergeReportScales(before, [BRADEN_D10], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'authoritative',
      authoritativeWindowStartIsoDay: '2026-07-01',
      authoritativeWindowEndIsoDay: '2026-07-10',
    });

    expect(partial.evaluationScores?.history).toHaveLength(2);
    expect(authoritative.evaluationScores?.history).toHaveLength(2);
  });

  it('removes retracted facts only inside an explicitly validated authoritative window', () => {
    const older = scale({
      encounterEventId: 40,
      sourceOrder: 40,
      recordedDate: '2026-06-30',
      recordedAt: '2026-06-30T08:00:00',
      total: 19,
    });
    const retracted = scale({
      encounterEventId: 80,
      sourceOrder: 80,
      recordedDate: '2026-07-10',
      recordedAt: '2026-07-10T08:00:00',
      total: 11,
    });
    const before = mergeReportScales(patient(), [older, retracted], {
      censusIsoDay: '2026-07-10',
    });

    const partial = mergeReportScales(before, [], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'partial',
    });
    const authoritative = mergeReportScales(before, [], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'authoritative',
      authoritativeWindowStartIsoDay: '2026-07-01',
      authoritativeWindowEndIsoDay: '2026-07-10',
    });

    expect(partial).toBe(before);
    expect(authoritative.evaluationScores?.history?.map(item => item.recordedDate)).toEqual([
      '2026-06-30',
    ]);
    expect(authoritative.evaluationScores?.braden?.total).toBe(19);
  });

  it('preserves prior-day Rayen antecedents inside a multi-day authoritative window', () => {
    const priorRayen = scale({
      encounterEventId: 20260705080000,
      sourceOrder: 5,
      recordedDate: '2026-07-05',
      recordedAt: '2026-07-05T08:00:00',
      total: 13,
    });
    const before = patient({
      evaluationScores: { history: [{ ...priorRayen, items: undefined }] },
    });

    const result = mergeReportScales(before, [], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'authoritative',
      authoritativeWindowStartIsoDay: '2026-07-01',
      authoritativeWindowEndIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toEqual([
      expect.objectContaining({ recordedDate: '2026-07-05', total: 13 }),
    ]);
  });

  it('preserves unowned local scales when an authoritative Rayen window is empty', () => {
    const local = scale({
      encounterEventId: 20260705080000,
      sourceOrder: undefined,
      recordedDate: '2026-07-05',
      recordedAt: '2026-07-05T08:00:00',
      author: 'Registro local',
      total: 13,
    });
    const before = patient({
      evaluationScores: { history: [{ ...local, items: undefined }] },
    });

    const result = mergeReportScales(before, [], {
      censusIsoDay: '2026-07-10',
      sourceCompleteness: 'authoritative',
      authoritativeWindowStartIsoDay: '2026-07-01',
      authoritativeWindowEndIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toEqual([
      expect.objectContaining({ author: 'Registro local', total: 13 }),
    ]);
  });

  it('removes the old copy when a source correction moves the scale after the census day', () => {
    const before = mergeReportScales(patient(), [BRADEN_D10], { censusIsoDay: '2026-07-11' });
    const corrected = {
      ...BRADEN_D10,
      recordedDate: '2026-07-12',
      recordedAt: '2026-07-12T08:00:00',
      total: 11,
    };

    const result = mergeReportScales(before, [corrected], {
      censusIsoDay: '2026-07-11',
      sourceCompleteness: 'partial',
    });
    expect(result.evaluationScores?.braden).toBeUndefined();
    expect(result.evaluationScores?.history).toEqual([]);
  });

  it('repairs already-persisted equivalent duplicates without waiting for a new scale', () => {
    const duplicated = patient({
      evaluationScores: {
        history: [
          {
            ...BRADEN_D10,
            sourceOrder: 100,
            author: 'Valeria Salfate',
            items: undefined,
          },
          {
            ...BRADEN_D10,
            sourceOrder: 200,
            author: 'Constanza Guajardo',
            items: undefined,
          },
        ],
      },
    });

    const result = mergeReportScales(duplicated, [], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toHaveLength(1);
    expect(result.evaluationScores?.history?.[0].author).toBe('Valeria Salfate');
  });

  it('defensively collapses equivalent duplicates that arrive in the same batch', () => {
    const original = { ...BRADEN_D10, sourceOrder: 100 };
    const duplicate = {
      ...BRADEN_D10,
      sourceOrder: 200,
      author: 'Otro formulario',
    };

    const result = mergeReportScales(patient(), [original, duplicate], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toHaveLength(1);
    expect(result.evaluationScores?.history?.[0].author).toBe('Enf. Ejemplo');
  });

  it('canonicalizes compact and detailed copies on the first pass', () => {
    const compact = {
      ...BRADEN_D10,
      sourceOrder: 1,
      items: [],
      author: 'Historial',
    };
    const detailed = {
      ...BRADEN_D10,
      sourceOrder: 8642,
      author: 'Resumen',
    };

    const first = mergeReportScales(patient(), [compact, detailed], {
      censusIsoDay: '2026-07-10',
    });
    const retry = mergeReportScales(first, [compact, detailed], {
      censusIsoDay: '2026-07-10',
    });

    expect(first.evaluationScores?.history).toHaveLength(1);
    expect(first.evaluationScores?.braden?.items).toHaveLength(1);
    expect(retry).toBe(first);
  });

  it('keeps the preferred visible persisted representation over an archived alternate form', () => {
    const existing = patient({
      evaluationScores: {
        history: [
          {
            ...BRADEN_D10,
            encounterEventId: 20260710080000,
            sourceOrder: 1,
            author: 'Valeria Salfate',
            items: undefined,
          },
        ],
      },
    });
    const archivedCopy = {
      ...BRADEN_D10,
      encounterEventId: 20260710080000,
      sourceOrder: 2,
      author: 'Otro formulario',
      archived: true,
    };

    const result = mergeReportScales(existing, [archivedCopy], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toEqual([
      expect.objectContaining({
        encounterEventId: 20260710080000,
        author: 'Valeria Salfate',
      }),
    ]);
    expect(result.evaluationScores?.history?.[0].archived).toBeUndefined();
  });

  it('persists an authoritative archive transition for the same stable event', () => {
    const existing = patient({
      evaluationScores: {
        history: [
          {
            ...BRADEN_D10,
            encounterEventId: 20260710080000,
            sourceOrder: 1,
            author: 'Valeria Salfate',
          },
        ],
      },
    });
    const archivedUpdate = {
      ...BRADEN_D10,
      encounterEventId: 20260710080000,
      sourceOrder: 1,
      author: 'Rayen actualizado',
      archived: true,
    };

    const result = mergeReportScales(existing, [archivedUpdate], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toEqual([
      expect.objectContaining({
        author: 'Rayen actualizado',
        archived: true,
      }),
    ]);
  });

  it('retains a newly available stable identity when repairing a preferred legacy copy', () => {
    const existing = patient({
      evaluationScores: {
        history: [
          {
            ...BRADEN_D10,
            encounterEventId: 0,
            sourceOrder: 1,
            author: 'Valeria Salfate',
          },
        ],
      },
    });
    const stableArchivedCopy = {
      ...BRADEN_D10,
      encounterEventId: 20260710080000,
      sourceOrder: 42,
      author: 'Otro formulario',
      items: [],
      archived: true,
    };

    const result = mergeReportScales(existing, [stableArchivedCopy], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toEqual([
      expect.objectContaining({
        author: 'Valeria Salfate',
        encounterEventId: 20260710080000,
        sourceOrder: 42,
      }),
    ]);
    expect(result.evaluationScores?.history?.[0].archived).toBeUndefined();
  });

  it('does not repair away a real reapplication with a changed score', () => {
    const repeated = {
      ...BRADEN_D10,
      encounterEventId: 20260710080008,
      recordedAt: '10-07-2026 08:00:08 -06:00',
      sourceOrder: 200,
      total: 11,
      severity: 'Riesgo alto',
    };

    const result = mergeReportScales(patient(), [BRADEN_D10, repeated], {
      censusIsoDay: '2026-07-10',
    });

    expect(result.evaluationScores?.history).toHaveLength(2);
  });
});
