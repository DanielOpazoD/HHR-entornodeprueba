import { describe, expect, it } from 'vitest';
import {
  parseEvaluationScales,
  latestEvaluationScales,
  evaluationScalesForCensusDay,
  evaluationScalesAsOf,
  type EvaluationScale,
} from '@/features/rayen-import';

/**
 * Synthetic fixture mirroring the real
 * `entrySummary/encounterFormEntry/{encId}/1/INSTRUMENTO/{practitionerId}` payload:
 * a signed-forms array with one Braden and several Downton records (history across two days), plus a
 * non-instrument form that must be ignored. Values reflect the real field shapes (multi-select items
 * carry comma-separated value/valueName; Puntaje lives in `value` with a null `valueName`; per-field
 * `createDatetime` carries the true "when performed"). Author / patient identifiers are made up.
 */
const item = (
  id: string,
  label: string,
  value: string,
  valueName: string,
  createDatetime: string
) => ({
  id,
  label,
  value,
  valueName,
  sectionId: 0,
  createDatetime,
});
const puntaje = (id: string, value: string, createDatetime: string) => ({
  id,
  label: 'Puntaje',
  value,
  valueName: null,
  sectionId: 1,
  createDatetime,
});
const severidad = (id: string, valueName: string, createDatetime: string) => ({
  id,
  label: 'Nivel de Severidad',
  value: '8063',
  valueName,
  sectionId: 1,
  createDatetime,
});

const PAYLOAD = [
  {
    formCodigo: 'VITAL_SIGNS',
    formTypeId: 1,
    nameForm: 'Examen Fisico SAPU',
    encounterEventId: 9000001,
    metaCampList: [{ id: 'VS_FC', label: 'FC', value: '80', valueName: '80', sectionId: 0 }],
  },
  {
    formCodigo: 'INSTRUMENTO',
    formTypeId: 16,
    nameForm: 'Escala de riesgo UPP (Braden)',
    encounterEventId: 8652718,
    startDateTime: '10-07-2026 7:14:31',
    createDateTime: '10-07-2026 7:14:31 -04:00',
    authorHealthCarePractitionerName: 'Enf. Ejemplo',
    authorHealthCarePractitionerRoleName: 'Enfermera(o)',
    metaCampList: [
      item(
        'BRAD_Percepcion',
        'Percepción sensorial ',
        '8019',
        'No Limitado',
        '10-07-2026 7:14:31 -04:00'
      ),
      item('BRAD_Humedad', 'Humedad', '8022', 'Ocasionalmente húmeda', '10-07-2026 7:14:31 -04:00'),
      item(
        'BRAD_Actividad',
        'Actividad',
        '8025',
        'En silla de ruedas',
        '10-07-2026 7:14:31 -04:00'
      ),
      item('BRAD_Movilidad', 'Movilidad', '8029', 'Muy limitado', '10-07-2026 7:14:31 -04:00'),
      item('BRAD_Nutrición', 'Nutrición', '8034', 'Adecuado', '10-07-2026 7:14:31 -04:00'),
      item(
        'BRAD_Fricción',
        'Fuerzas de fricción y cizalla',
        '8038',
        'Sin problemas aparentes',
        '10-07-2026 7:14:31 -04:00'
      ),
      puntaje('BRAD_Puntaje', '17', '10-07-2026 7:14:31 -04:00'),
      severidad('BRAD_ResultadoScore', 'Riesgo bajo', '10-07-2026 7:14:31 -04:00'),
    ],
  },
  // Downton from the PREVIOUS census day (09-07). Must be excluded when syncing day 10.
  {
    formCodigo: 'INSTRUMENTO',
    formTypeId: 16,
    nameForm: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
    encounterEventId: 8640000,
    startDateTime: '09-07-2026 20:00:00',
    metaCampList: [
      item('DOWN_Caidas', 'Caídas previas', '8042', 'No', '09-07-2026 20:00:00 -06:00'),
      puntaje('DOWN_Puntaje', '3', '09-07-2026 20:00:00 -06:00'),
      severidad('DOWN_ResultadoScore', 'Riesgo bajo', '09-07-2026 20:00:00 -06:00'),
    ],
  },
  // First Downton on day 10 (score 5) — superseded by the redo below (higher encounterEventId).
  {
    formCodigo: 'INSTRUMENTO',
    formTypeId: 16,
    nameForm: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
    encounterEventId: 8652724,
    startDateTime: '10-07-2026 7:15:44',
    metaCampList: [
      item('DOWN_Caidas', 'Caídas previas', '8042', 'No', '10-07-2026 7:15:44 -04:00'),
      puntaje('DOWN_Puntaje', '5', '10-07-2026 7:15:44 -04:00'),
      severidad('DOWN_ResultadoScore', 'Riesgo alto', '10-07-2026 7:15:44 -04:00'),
    ],
  },
  // Redo on day 10 (score 8): form-level times are STALE (copied to the 9th), but the per-field
  // createDatetime is the real day/time — recordedDate must follow the field, not startDateTime.
  {
    formCodigo: 'INSTRUMENTO',
    formTypeId: 16,
    nameForm: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
    encounterEventId: 8655768,
    startDateTime: '09-07-2026 7:15:44',
    createDateTime: '10-07-2026 7:15:44 -04:00',
    metaCampList: [
      item('DOWN_Caidas', 'Caídas previas', '8042', 'No', '10-07-2026 12:55:12 -04:00'),
      item(
        'DOWN_Medicamentos',
        'Medicamentos',
        '8046, 8047',
        'Diuréticos, Hipotensores (no diuréticos)',
        '10-07-2026 12:55:12 -04:00'
      ),
      puntaje('DOWN_Puntaje', '8', '10-07-2026 12:55:12 -04:00'),
      severidad('DOWN_ResultadoScore', 'Riesgo alto', '10-07-2026 12:55:12 -04:00'),
    ],
  },
];

const byCode = (scales: EvaluationScale[], code: string) => scales.find(s => s.code === code)!;

describe('parseEvaluationScales', () => {
  it('parses the Braden scale: 6 items, numeric total, severity and recorded day', () => {
    const braden = byCode(parseEvaluationScales(PAYLOAD), 'BRADEN');
    expect(braden.name).toBe('Escala de riesgo UPP (Braden)');
    expect(braden.total).toBe(17);
    expect(braden.severity).toBe('Riesgo bajo');
    expect(braden.recordedDate).toBe('2026-07-10');
    expect(braden.items).toHaveLength(6);
    expect(braden.items[0]).toEqual({
      id: 'BRAD_Percepcion',
      label: 'Percepción sensorial', // trimmed
      value: '8019',
      valueName: 'No Limitado',
    });
    // The result fields never leak into the item list.
    expect(braden.items.some(i => /_Puntaje|_ResultadoScore/.test(i.id))).toBe(false);
  });

  it('derives recordedDate from the per-field time, not the stale form startDateTime (redo case)', () => {
    const redo = parseEvaluationScales(PAYLOAD).find(s => s.encounterEventId === 8655768)!;
    expect(redo.recordedDate).toBe('2026-07-10'); // field says 10th even though startDateTime says 9th
  });

  it('keeps multi-select answers as comma-separated value/valueName', () => {
    const redo = parseEvaluationScales(PAYLOAD).find(s => s.encounterEventId === 8655768)!;
    const meds = redo.items.find(i => i.id === 'DOWN_Medicamentos')!;
    expect(meds.value).toBe('8046, 8047');
    expect(meds.valueName).toBe('Diuréticos, Hipotensores (no diuréticos)');
  });

  it('ignores non-instrument forms and returns the full history', () => {
    const scales = parseEvaluationScales(PAYLOAD);
    expect(scales.every(s => s.code === 'BRADEN' || s.code === 'DOWNTON')).toBe(true);
    expect(scales).toHaveLength(4); // 1 Braden + 3 Downton, no vital-signs form
  });

  it('empty / non-array input yields no scales', () => {
    expect(parseEvaluationScales(null)).toEqual([]);
    expect(parseEvaluationScales({})).toEqual([]);
    expect(parseEvaluationScales([])).toEqual([]);
  });

  it('an in-progress scale with an empty Puntaje yields total null, not 0', () => {
    const inProgress = [
      {
        formCodigo: 'INSTRUMENTO',
        formTypeId: 16,
        nameForm: 'Escala de riesgo UPP (Braden)',
        encounterEventId: 7,
        startDateTime: '10-07-2026 09:00:00',
        metaCampList: [
          item(
            'BRAD_Percepcion',
            'Percepción sensorial',
            '8019',
            'No Limitado',
            '10-07-2026 09:00:00 -06:00'
          ),
          puntaje('BRAD_Puntaje', '', '10-07-2026 09:00:00 -06:00'),
        ],
      },
    ];
    expect(parseEvaluationScales(inProgress)[0].total).toBeNull();
  });

  it('flags an archived summary scale (form.archived) so a live same-day one wins downstream', () => {
    // Edgardo case: on 10-07 Downton was applied at 09:42 (medio, live) then at 15:23 (alto, ARCHIVED).
    // The summary feed carries the archived one too; unflagged it would win the highest-id selection.
    const downtonForm = (over: Record<string, unknown> = {}) => ({
      formCodigo: 'INSTRUMENTO',
      nameForm: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
      encounterEventId: 500,
      metaCampList: [
        item('DOWN_Medicamentos', 'Medicamentos', '1', 'Otros', '10-07-2026 09:42:19 -06:00'),
        puntaje('DOWN_Puntaje', '2', '10-07-2026 09:42:19 -06:00'),
        severidad('DOWN_ResultadoScore', 'Riesgo medio', '10-07-2026 09:42:19 -06:00'),
      ],
      ...over,
    });
    expect(parseEvaluationScales([downtonForm({ archived: true })])[0]?.archived).toBe(true);
    expect(parseEvaluationScales([downtonForm()])[0]?.archived).toBe(false);
  });
});

describe('evaluationScalesForCensusDay', () => {
  it('takes the last score recorded ON the census day (by encounterEventId), scoped to that day', () => {
    const day10 = evaluationScalesForCensusDay(parseEvaluationScales(PAYLOAD), '2026-07-10');
    expect(day10.map(s => s.code)).toEqual(['BRADEN', 'DOWNTON']);
    expect(byCode(day10, 'BRADEN').total).toBe(17);
    // Day-10 Downton is the redo (score 8, event 8655768) — not the earlier 5 nor the day-09 record.
    const downton = byCode(day10, 'DOWNTON');
    expect(downton.encounterEventId).toBe(8655768);
    expect(downton.total).toBe(8);
  });

  it("a past census day returns that day's score, not the newest overall", () => {
    const day09 = evaluationScalesForCensusDay(parseEvaluationScales(PAYLOAD), '2026-07-09');
    // Braden was not recorded on the 9th, so only the day-09 Downton (score 3) comes back.
    expect(day09.map(s => s.code)).toEqual(['DOWNTON']);
    expect(byCode(day09, 'DOWNTON').total).toBe(3);
  });

  it('a day with no scales returns nothing (never an older value)', () => {
    expect(evaluationScalesForCensusDay(parseEvaluationScales(PAYLOAD), '2026-07-01')).toEqual([]);
  });
});

describe('evaluationScalesAsOf', () => {
  it('keeps the last known score on a day with no new assessment (drives the overdue reminder)', () => {
    // No scale exists on 2026-07-12; as-of that day still returns the day-10 Downton (event 8655768).
    const asOf = evaluationScalesAsOf(parseEvaluationScales(PAYLOAD), '2026-07-12');
    expect(byCode(asOf, 'DOWNTON').encounterEventId).toBe(8655768);
    expect(byCode(asOf, 'BRADEN').total).toBe(17);
  });

  it('a late sync of a past census never picks up a later score', () => {
    // As of 2026-07-09, the day-10 Downton records must not leak in — only the day-09 one (score 3).
    const asOf = evaluationScalesAsOf(parseEvaluationScales(PAYLOAD), '2026-07-09');
    expect(byCode(asOf, 'DOWNTON').total).toBe(3);
    expect(asOf.some(s => s.code === 'BRADEN')).toBe(false); // Braden not recorded until the 10th
  });
});

describe('latestEvaluationScales (day-agnostic)', () => {
  it('picks the newest overall per scale by encounterEventId', () => {
    const latest = latestEvaluationScales(parseEvaluationScales(PAYLOAD));
    expect(byCode(latest, 'DOWNTON').total).toBe(8);
    expect(byCode(latest, 'BRADEN').total).toBe(17);
  });
});

describe('Rapa Nui timezone (recordedDate)', () => {
  const scaleAt = (createDatetime: string) => [
    {
      formCodigo: 'INSTRUMENTO',
      formTypeId: 16,
      nameForm: 'Escala de riesgo UPP (Braden)',
      encounterEventId: 1,
      startDateTime: '10-07-2026 01:00:00',
      metaCampList: [
        item('BRAD_Percepcion', 'Percepción sensorial', '8019', 'No Limitado', createDatetime),
        puntaje('BRAD_Puntaje', '17', createDatetime),
        severidad('BRAD_ResultadoScore', 'Riesgo bajo', createDatetime),
      ],
    },
  ];

  it('maps a continental (-04:00) just-after-midnight stamp to the previous Rapa Nui day', () => {
    // 2026-07-10 01:00 -04:00 == 2026-07-10 05:00Z == 2026-07-09 23:00 in Pacific/Easter (-06).
    const [braden] = parseEvaluationScales(scaleAt('10-07-2026 01:00:00 -04:00'));
    expect(braden.recordedDate).toBe('2026-07-09');
  });

  it('keeps an island (-06:00) morning stamp on the same day', () => {
    const [braden] = parseEvaluationScales(scaleAt('10-07-2026 08:00:00 -06:00'));
    expect(braden.recordedDate).toBe('2026-07-10');
  });
});
