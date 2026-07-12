import { describe, expect, it } from 'vitest';
import {
  parseHistoryScales,
  evaluationScalesForCensusDay,
  evaluationScalesAsOf,
} from '@/features/rayen-import';

/**
 * Synthetic fixture mirroring the slimmed clinical-history events the extension forwards from
 * `getPatientEncounterHistoryReportServer` (encId 141121): every event carries `publishDatetime` (the
 * REAL application stamp, naive Rapa Nui wall-clock) and an `evaluationInstrumentsResume` of campos
 * `{ FORM_NAME, LABEL, VALUE, ARCHIVED, MCAM_ID, PUBLISH_DATE_HCP_NAME, PRACTITIONER_ROLE }`.
 * Timeline: Braden 17 (07-10) and Downton re-applied several times across 07-10 and 07-11 — the case
 * that encounterFormEntry mis-dated (all under 07-10) and where the last 07-11 score must win.
 */
const BRADEN = 'Escala de riesgo UPP (Braden)';
const DOWNTON = 'Escala de Riesgo de caídas (J. H. DOWNTON)';

const campo = (
  FORM_NAME: string,
  LABEL: string,
  VALUE: string,
  extra: Record<string, unknown> = {}
) => ({
  FORM_NAME,
  LABEL,
  VALUE,
  ARCHIVED: false,
  MCAM_ID: 0,
  PUBLISH_DATE_HCP_NAME: 'Enf. Ejemplo',
  PRACTITIONER_ROLE: 'Enfermera(o)',
  ...extra,
});

const bradenEvent = (publishDatetime: string, puntaje: string, severidad: string) => ({
  publishDatetime,
  evaluationInstrumentsResume: [
    campo(BRADEN, 'Percepción sensorial ', 'No Limitado', { MCAM_ID: 111 }),
    campo(BRADEN, 'Nivel de Severidad', severidad),
    campo(BRADEN, 'Puntaje', puntaje),
  ],
});

const downtonEvent = (publishDatetime: string, puntaje: string, severidad: string) => ({
  publishDatetime,
  evaluationInstrumentsResume: [
    campo(DOWNTON, 'Deambulación', 'Insegura con ayuda/sin ayuda', { MCAM_ID: 222 }),
    campo(DOWNTON, 'Nivel de Severidad', severidad),
    campo(DOWNTON, 'Puntaje', puntaje),
  ],
});

/** A Downton whose whole record is archived (superseded) in Ficha Médico. */
const archivedDowntonEvent = (publishDatetime: string, puntaje: string, severidad: string) => ({
  publishDatetime,
  evaluationInstrumentsResume: [
    campo(DOWNTON, 'Deambulación', 'Insegura con ayuda/sin ayuda', {
      MCAM_ID: 222,
      ARCHIVED: true,
    }),
    campo(DOWNTON, 'Nivel de Severidad', severidad, { ARCHIVED: true }),
    campo(DOWNTON, 'Puntaje', puntaje, { ARCHIVED: true }),
  ],
});

const EVENTS = [
  downtonEvent('2026-07-11T12:35:29.97', '5', 'Riesgo alto'), // last of 07-11
  downtonEvent('2026-07-11T12:29:00', '4', 'Riesgo medio'),
  downtonEvent('2026-07-10T12:55:00', '5', 'Riesgo alto'), // last of 07-10
  downtonEvent('2026-07-10T10:54:16', '8', 'Riesgo alto'),
  bradenEvent('2026-07-10T07:14:31', '17', 'Riesgo bajo'),
];

describe('parseHistoryScales', () => {
  it('parses Braden + Downton with total, severity, items and the real application day', () => {
    const scales = parseHistoryScales(EVENTS);

    const braden = scales.find(s => s.code === 'BRADEN');
    expect(braden).toBeDefined();
    expect(braden?.total).toBe(17);
    expect(braden?.severity).toBe('Riesgo bajo');
    expect(braden?.recordedDate).toBe('2026-07-10');
    expect(braden?.recordedAt).toBe('2026-07-10T07:14:31');
    // Puntaje / Nivel de Severidad are extracted, only the sub-scale answers remain as items.
    expect(braden?.items).toEqual([
      { id: '111', label: 'Percepción sensorial', value: '', valueName: 'No Limitado' },
    ]);
    expect(scales.filter(s => s.code === 'DOWNTON')).toHaveLength(4);
  });

  it('derives recordedDate from publishDatetime WITHOUT Date.parse (naive = Rapa Nui day)', () => {
    // A stamp just after local midnight must stay on its printed day, never shift to UTC.
    const [scale] = parseHistoryScales([downtonEvent('2026-07-11T00:20:00', '3', 'Riesgo bajo')]);
    expect(scale.recordedDate).toBe('2026-07-11');
  });

  it('selects the LAST score applied on the census day being synced (not the newest overall)', () => {
    const scales = parseHistoryScales(EVENTS);

    const day11 = evaluationScalesForCensusDay(scales, '2026-07-11');
    expect(day11.find(s => s.code === 'DOWNTON')?.total).toBe(5); // 12:35, not the 12:29 (4)
    // No Braden re-applied on 07-11 → strict-day selection omits it.
    expect(day11.find(s => s.code === 'BRADEN')).toBeUndefined();

    const day10 = evaluationScalesForCensusDay(scales, '2026-07-10');
    expect(day10.find(s => s.code === 'DOWNTON')?.total).toBe(5); // 12:55, not the 10:54 (8)
    expect(day10.find(s => s.code === 'BRADEN')?.total).toBe(17);
  });

  it('keeps the last known score as-of a past census day (drives the reapplication reminder)', () => {
    const scales = parseHistoryScales(EVENTS);
    // As-of 07-11, Braden was last done 07-10 and still carries (7-day validity + overdue reminder).
    const asOf11 = evaluationScalesAsOf(scales, '2026-07-11');
    expect(asOf11.find(s => s.code === 'BRADEN')?.recordedDate).toBe('2026-07-10');
    expect(asOf11.find(s => s.code === 'DOWNTON')?.total).toBe(5); // still the 07-11 12:35
  });

  it('prefers the non-archived score of the day, discarding the archived (superseded) one', () => {
    // Same day: an archived Downton 5 (12:55) and a live Downton 8 (10:54) — the live one wins and
    // the archived one drops out of the effective history entirely.
    const scales = parseHistoryScales([
      archivedDowntonEvent('2026-07-10T12:55:12', '5', 'Riesgo alto'),
      downtonEvent('2026-07-10T10:54:16', '8', 'Riesgo alto'),
    ]);
    expect(scales.filter(s => s.code === 'DOWNTON')).toHaveLength(1);
    expect(
      evaluationScalesForCensusDay(scales, '2026-07-10').find(s => s.code === 'DOWNTON')?.total
    ).toBe(8);
  });

  it('keeps an archived score when it is the only record of the day (Rodrigo H3C1 case)', () => {
    // 10-07 had ONLY an archived Downton → the assessment WAS done, so it must still count and never
    // read as "reaplicar hoy" for that day.
    const scales = parseHistoryScales([
      archivedDowntonEvent('2026-07-10T11:00:00', '3', 'Riesgo alto'),
    ]);
    expect(scales).toHaveLength(1);
    expect(
      evaluationScalesForCensusDay(scales, '2026-07-10').find(s => s.code === 'DOWNTON')?.total
    ).toBe(3);
  });

  it('ignores forms that are not a tracked scale', () => {
    const scales = parseHistoryScales([
      {
        publishDatetime: '2026-07-11T09:00:00',
        evaluationInstrumentsResume: [
          campo(DOWNTON, 'Puntaje', '6'),
          campo(DOWNTON, 'Nivel de Severidad', 'Riesgo alto'),
          campo('Escala de Glasgow', 'Puntaje', '15'), // not Braden/Downton → ignored
        ],
      },
    ]);
    expect(scales).toHaveLength(1);
    expect(scales[0].code).toBe('DOWNTON');
    expect(scales[0].total).toBe(6);
  });

  it('collapses the report duplicating the same event verbatim (one dot per assessment)', () => {
    // The Jasper report repeated one 10:54 Downton 3× — history must keep a single entry.
    const dup = downtonEvent('2026-07-10T10:54:16', '8', 'Riesgo alto');
    const scales = parseHistoryScales([dup, { ...dup }, { ...dup }]);
    expect(scales).toHaveLength(1);
    expect(scales[0].total).toBe(8);
  });

  it('is defensive about malformed input', () => {
    expect(parseHistoryScales(null)).toEqual([]);
    // A null/undefined element inside evaluationInstrumentsResume must not throw.
    expect(
      parseHistoryScales([
        { publishDatetime: '2026-07-11T09:00:00', evaluationInstrumentsResume: [null, undefined] },
      ])
    ).toEqual([]);
    expect(parseHistoryScales([{ publishDatetime: '', evaluationInstrumentsResume: [] }])).toEqual(
      []
    );
    expect(parseHistoryScales([{ publishDatetime: 'no-date' }])).toEqual([]);
  });
});
