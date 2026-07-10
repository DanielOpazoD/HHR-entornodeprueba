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
  });

  it("as of a past census day, uses that day's value and omits later ones", () => {
    const result = mergeReportScales(patient(), [DOWNTON_D9, DOWNTON_D10], {
      censusIsoDay: '2026-07-09',
    });
    expect(result.evaluationScores?.downton?.total).toBe(3); // the day-9 record, not the day-10 one
    // But the full history is still retained for the unified view.
    expect(result.evaluationScores?.history).toHaveLength(2);
  });

  it('returns the patient untouched when there are no scales', () => {
    const before = patient();
    expect(mergeReportScales(before, [], { censusIsoDay: '2026-07-10' })).toBe(before);
  });
});
