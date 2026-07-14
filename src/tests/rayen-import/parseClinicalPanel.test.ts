import { describe, expect, it } from 'vitest';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';
import type { RayenClinicalPanelEvent } from '@/features/rayen-import/bridge/clinicalPanelBridge';

const event = (over: Partial<RayenClinicalPanelEvent> = {}): RayenClinicalPanelEvent => ({
  publishDatetime: '2026-07-12T10:00:00',
  evolutionResume: [],
  shiftChangeResume: [],
  patientPharmaIndicationResume: [],
  patientFreeIndicationResume: [],
  nutritionOrderResume: [],
  restResume: [],
  ...over,
});

describe('parseClinicalPanel — evoluciones', () => {
  it('composes the PERSON name from the HCP_* parts and buckets by profession (role)', () => {
    const panel = parseClinicalPanel([
      event({
        evolutionResume: [
          {
            id: 71,
            OBE_NOTES: 'Paciente estable, afebril.',
            OBE_PUBLISH_DATETIME: '2026-07-12T09:30:00',
            HCPR_NAME: 'Médico',
            HCP_FGN: 'ANA',
            HCP_NGN: 'MARÍA',
            HCP_FFN: 'PÉREZ',
            HCP_SFN: 'SOTO',
            ARCHIVED: false,
          },
          {
            id: 72,
            OBE_NOTES: 'Valoración kinésica.',
            OBE_PUBLISH_DATETIME: '2026-07-12T11:00:00',
            HCPR_NAME: 'Kinesiólogo',
            HCP_FGN: 'PEDRO',
            HCP_FFN: 'ROJAS',
          },
        ],
        shiftChangeResume: [
          {
            ID: 5,
            OBSERVATION: 'Sin novedades nocturnas.',
            HCPR_NAME: 'Enfermera(o)',
            HCP_FGN: 'LUISA',
            HCP_FFN: 'MIRANDA',
            PUBLISH_DATETIME: '2026-07-12T20:15:00',
          },
        ],
      }),
    ]);

    expect(panel.evolutions.map(e => e.profession)).toEqual(['nursing', 'other', 'medical']);
    const medical = panel.evolutions.find(e => e.profession === 'medical');
    expect(medical).toMatchObject({ author: 'Ana María Pérez Soto', role: 'Médico' });
    const nursing = panel.evolutions.find(e => e.kind === 'shift-change');
    expect(nursing).toMatchObject({
      author: 'Luisa Miranda',
      profession: 'nursing',
      title: 'Entrega de turno',
    });
    const other = panel.evolutions.find(e => e.profession === 'other');
    expect(other).toMatchObject({ author: 'Pedro Rojas', role: 'Kinesiólogo' });
  });

  it('classifies tricky roles: Cirujano → médica, Paramédico/TENS → enfermería, Matrona → otros', () => {
    const roleOf = (HCPR_NAME: string) =>
      parseClinicalPanel([
        event({ evolutionResume: [{ id: HCPR_NAME, OBE_NOTES: 'x', HCPR_NAME }] }),
      ]).evolutions[0].profession;

    expect(roleOf('Cirujano')).toBe('medical');
    expect(roleOf('Médico Cirujano')).toBe('medical');
    expect(roleOf('Traumatólogo')).toBe('medical');
    // "paramédico" contains "médico" — must NOT leak into medical.
    expect(roleOf('Paramédico')).toBe('nursing');
    expect(roleOf('Técnico Paramédico')).toBe('nursing');
    expect(roleOf('TENS')).toBe('nursing');
    expect(roleOf('Enfermera(o)')).toBe('nursing');
    expect(roleOf('Matrona')).toBe('other');
    expect(roleOf('Kinesiólogo')).toBe('other');
    expect(roleOf('Nutricionista')).toBe('other');
  });

  it('files a shift-change by the practitioner role: a medical one lands in "medical"', () => {
    const panel = parseClinicalPanel([
      event({
        shiftChangeResume: [
          {
            ID: 8,
            OBSERVATION: 'Entrega turno médico: pendiente TAC.',
            HCPR_NAME: 'Médico',
            PUBLISH_DATETIME: '2026-07-12T08:00:00',
          },
        ],
      }),
    ]);
    expect(panel.evolutions[0]).toMatchObject({
      kind: 'shift-change',
      profession: 'medical',
      role: 'Médico',
    });
  });

  it('flags archived/crossed-out and accepts 1/"S" style truthy values', () => {
    const panel = parseClinicalPanel([
      event({
        evolutionResume: [
          {
            id: 1,
            OBE_NOTES: 'Nota anulada',
            ARCHIVED: 1,
            IS_CROSSED_OUT: 'S',
            HCPR_NAME: 'Médico',
          },
        ],
      }),
    ]);
    expect(panel.evolutions[0]).toMatchObject({ archived: true, crossedOut: true });
  });
});

describe('parseClinicalPanel — hoja diaria de indicaciones', () => {
  it('groups indications per calendar day in clinical order (régimen → reposo → fármacos → libres)', () => {
    const panel = parseClinicalPanel([
      event({
        publishDatetime: '2026-07-12T08:00:00',
        nutritionOrderResume: [
          { DIET_type: 'Liviano', OBSERVATION: 'Sin sal', PUBLISH_DATETIME: '2026-07-12T08:00:00' },
        ],
        restResume: [{ rest_type: 'Relativo', PUBLISH_DATETIME: '2026-07-12T08:00:00' }],
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900,
            DESCRIPTOR: 'ASPIRINA 100 mg',
            POSOLOGY: '100 mg/día',
            ROUTE_ADMINISTRATION: 'Oral',
            PUBLISH_DATETIME: '2026-07-12T08:00:00',
          },
        ],
        patientFreeIndicationResume: [
          { AMRE_ID: 3, INDICATION: 'Curación diaria', PUBLISH_DATETIME: '2026-07-12T08:00:00' },
        ],
      }),
      event({
        publishDatetime: '2026-07-11T09:00:00',
        restResume: [{ rest_type: 'Absoluto', PUBLISH_DATETIME: '2026-07-11T09:00:00' }],
      }),
    ]);

    expect(panel.indicationDays.map(d => d.label)).toEqual(['12-07-2026', '11-07-2026']);
    const today = panel.indicationDays[0];
    expect(today.active.map(e => e.kind)).toEqual(['diet', 'rest', 'pharma', 'free-indication']);
    expect(today.active[2]).toMatchObject({
      title: 'ASPIRINA 100 mg',
      text: '100 mg/día · Oral',
    });
  });

  it('splits suspended indications out of the day sheet and dedupes by id within the day', () => {
    const panel = parseClinicalPanel([
      event({
        publishDatetime: '2026-07-12T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900,
            DESCRIPTOR: 'CEFTRIAXONA 2 g',
            POSOLOGY: '2 g/día',
            PUBLISH_DATETIME: '2026-07-12T08:00:00',
            SUSPENDED: false,
          },
        ],
      }),
      event({
        publishDatetime: '2026-07-12T14:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900,
            DESCRIPTOR: 'CEFTRIAXONA 2 g',
            POSOLOGY: '2 g/día',
            PUBLISH_DATETIME: '2026-07-12T14:00:00',
            SUSPENDED: true,
          },
        ],
      }),
    ]);

    const day = panel.indicationDays[0];
    expect(day.active).toHaveLength(0);
    expect(day.suspended).toHaveLength(1);
    expect(day.suspended[0]).toMatchObject({ title: 'CEFTRIAXONA 2 g', suspended: true });
  });

  it('buckets indications with an unparseable date under a "Sin fecha" day', () => {
    const panel = parseClinicalPanel([
      event({
        publishDatetime: 'no-es-fecha',
        patientFreeIndicationResume: [
          { AMRE_ID: 1, INDICATION: 'Kinesioterapia', PUBLISH_DATETIME: '' },
        ],
      }),
    ]);
    expect(panel.indicationDays).toHaveLength(1);
    expect(panel.indicationDays[0]).toMatchObject({ day: '', label: 'Sin fecha' });
    expect(panel.indicationDays[0].active[0].title).toBe('Indicación');
  });

  it('dedupes diet/rest (no stable id) by text within the day', () => {
    const panel = parseClinicalPanel([
      event({
        publishDatetime: '2026-07-12T08:00:00',
        nutritionOrderResume: [{ DIET_type: 'Liviano', PUBLISH_DATETIME: '2026-07-12T08:00:00' }],
      }),
      event({
        publishDatetime: '2026-07-12T13:00:00',
        nutritionOrderResume: [{ DIET_type: 'Liviano', PUBLISH_DATETIME: '2026-07-12T13:00:00' }],
      }),
    ]);
    expect(panel.indicationDays[0].active).toHaveLength(1);
  });

  it('skips rows without clinical text and tolerates malformed events', () => {
    const panel = parseClinicalPanel([
      event({ evolutionResume: [{ id: 9, OBE_NOTES: '   ' }, null, 'basura'] }),
      null as unknown as RayenClinicalPanelEvent,
    ]);
    expect(panel.evolutions).toHaveLength(0);
    expect(panel.indicationDays).toHaveLength(0);
  });
});
