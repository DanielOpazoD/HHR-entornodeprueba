import { describe, expect, it } from 'vitest';
import { parseVitalSigns, latestVitalsAsOf } from '@/features/rayen-import/mapping/parseVitalSigns';

// No per-campo createDatetime, so `effectiveWhen` resolves the day from the form's createDateTime.
const campo = (id: string, value: string) => ({ id, value, valueName: null, sectionId: 0 });

const vitalsForm = (over: Record<string, unknown> = {}) => ({
  formCodigo: 'VITAL_SIGNS',
  nameForm: 'Examen Fisico SAPU',
  encounterEventId: 8670131,
  startDateTime: '11-07-2026 22:49:00',
  createDateTime: '11-07-2026 22:49:00 -06:00',
  authorHealthCarePractitionerName: 'Johanna  Pascua ',
  authorHealthCarePractitionerRoleName: 'Paramédico',
  archived: false,
  metaCampList: [
    campo('global_FechaHoraSapu', '12-07-2026 05:00'),
    campo('global_PASSent', '130'),
    campo('global_PADSent', '82'),
    campo('global_Pulso', '84'),
    campo('exa_Fisic_G_SaturacionO2', '98'),
    campo('global_TempAxilar', '36'),
    campo('exa_Fisic_Frecuencia_Respiratoria', '18'),
    campo('global_EscalaDolorEVA', '3'),
    campo('global_Observaciones', 'PAM (94) DIURESIS (+)'),
  ],
  ...over,
});

describe('parseVitalSigns', () => {
  it('parses a full VITAL_SIGNS form into a vitals record (Rapa Nui day)', () => {
    const [v] = parseVitalSigns([vitalsForm()]);
    expect(v).toMatchObject({
      recordedDate: '2026-07-11',
      recordedAt: '12-07-2026 05:00',
      systolic: 130,
      diastolic: 82,
      heartRate: 84,
      spo2: 98,
      temperature: 36,
      respiratoryRate: 18,
      painEva: 3,
      observations: 'PAM (94) DIURESIS (+)',
      authorRole: 'Paramédico',
    });
  });

  it('ignores non-VITAL_SIGNS forms and archived measurements', () => {
    expect(parseVitalSigns([{ formCodigo: 'INSTRUMENTO', metaCampList: [] }])).toEqual([]);
    expect(parseVitalSigns([vitalsForm({ archived: true })])).toEqual([]);
  });

  it('keeps nullable readings when a reading is absent', () => {
    const [v] = parseVitalSigns([
      vitalsForm({ metaCampList: [campo('global_Pulso', '77'), campo('global_PASSent', '')] }),
    ]);
    expect(v.heartRate).toBe(77);
    expect(v.systolic).toBeNull();
    expect(v.spo2).toBeNull();
  });

  it('skips a VITAL_SIGNS form with only a timestamp and no readings', () => {
    expect(
      parseVitalSigns([
        vitalsForm({ metaCampList: [campo('global_FechaHoraSapu', '12-07 05:00')] }),
      ])
    ).toEqual([]);
  });

  it('latestVitalsAsOf picks the most recent measurement on or before the census day', () => {
    const older = vitalsForm({
      encounterEventId: 100,
      createDateTime: '10-07-2026 08:00:00 -06:00',
      metaCampList: [campo('global_Pulso', '70')],
    });
    const newer = vitalsForm({
      encounterEventId: 200,
      createDateTime: '11-07-2026 08:00:00 -06:00',
      metaCampList: [campo('global_Pulso', '90')],
    });
    const records = parseVitalSigns([older, newer]);

    // Most-recent-first ordering.
    expect(records[0].heartRate).toBe(90);
    // Viewing 07-11 → newest; viewing 07-10 → the older one (never the 07-11 future measurement).
    expect(latestVitalsAsOf(records, '2026-07-11')?.heartRate).toBe(90);
    expect(latestVitalsAsOf(records, '2026-07-10')?.heartRate).toBe(70);
    expect(latestVitalsAsOf(records, '2026-07-09')).toBeNull();
  });

  it('is defensive about malformed input', () => {
    expect(parseVitalSigns(null)).toEqual([]);
    expect(parseVitalSigns([null, undefined, {}])).toEqual([]);
  });
});
