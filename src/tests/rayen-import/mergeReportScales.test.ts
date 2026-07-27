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
});
