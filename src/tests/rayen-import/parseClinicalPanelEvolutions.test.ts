import { describe, expect, it } from 'vitest';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';
import type { RayenClinicalPanelEvent } from '@/features/rayen-import/bridge/clinicalPanelBridge';

const event = (over: Partial<RayenClinicalPanelEvent>): RayenClinicalPanelEvent => ({
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
  it('composes people names and buckets evolution and handoff roles', () => {
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

    expect(panel.evolutions.map(entry => entry.profession)).toEqual([
      'nursing',
      'other',
      'medical',
    ]);
    expect(panel.evolutions.find(entry => entry.profession === 'medical')).toMatchObject({
      author: 'Ana María Pérez Soto',
      role: 'Médico',
    });
    expect(panel.evolutions.find(entry => entry.kind === 'shift-change')).toMatchObject({
      author: 'Luisa Miranda',
      profession: 'nursing',
      title: 'Entrega de turno',
    });
    expect(panel.evolutions.find(entry => entry.profession === 'other')).toMatchObject({
      author: 'Pedro Rojas',
      role: 'Kinesiólogo',
    });
  });

  it.each([
    ['Cirujano', 'medical'],
    ['Médico Cirujano', 'medical'],
    ['Traumatólogo', 'medical'],
    ['Paramédico', 'nursing'],
    ['Técnico Paramédico', 'nursing'],
    ['TENS', 'nursing'],
    ['Enfermera(o)', 'nursing'],
    ['Matrona', 'other'],
    ['Kinesiólogo', 'other'],
    ['Nutricionista', 'other'],
  ] as const)('classifies the clinical role %s as %s', (HCPR_NAME, expected) => {
    const panel = parseClinicalPanel([
      event({ evolutionResume: [{ id: HCPR_NAME, OBE_NOTES: 'x', HCPR_NAME }] }),
    ]);
    expect(panel.evolutions[0].profession).toBe(expected);
  });

  it('files a medical shift handoff in the medical bucket', () => {
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

  it('accepts numeric and S-style archived/crossed-out flags', () => {
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
