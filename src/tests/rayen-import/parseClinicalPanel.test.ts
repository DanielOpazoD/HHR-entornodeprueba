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

describe('parseClinicalPanel', () => {
  it('merges medical evolutions and nursing shift-change notes, newest first', () => {
    const panel = parseClinicalPanel([
      event({
        evolutionResume: [
          {
            id: 71,
            OBE_NOTES: 'Paciente estable, afebril.',
            OBE_PUBLISH_DATETIME: '2026-07-12T09:30:00',
            HCPR_NAME: 'Dra. Uno',
            ARCHIVED: false,
            IS_CROSSED_OUT: false,
          },
        ],
        shiftChangeResume: [
          {
            ID: 5,
            OBSERVATION: 'Sin novedades nocturnas.',
            HCPR_NAME: 'Enf. Dos',
            PUBLISH_DATETIME: '2026-07-12T20:15:00',
            ARCHIVED: 0,
          },
        ],
      }),
    ]);

    expect(panel.evolutions.map(e => e.kind)).toEqual(['shift-change', 'evolution']);
    expect(panel.evolutions[0]).toMatchObject({
      title: 'Entrega de turno · Enfermería',
      text: 'Sin novedades nocturnas.',
      author: 'Enf. Dos',
    });
    expect(panel.evolutions[1]).toMatchObject({ author: 'Dra. Uno', archived: false });
  });

  it('dedupes a pharma indication by MRE_ID keeping the LATEST publication (current flags)', () => {
    const panel = parseClinicalPanel([
      event({
        publishDatetime: '2026-07-11T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900,
            DESCRIPTOR: 'CEFTRIAXONA 1 g',
            POSOLOGY: '1 g cada 12 h',
            ROUTE_ADMINISTRATION: 'Endovenosa',
            PUBLISH_DATETIME: '2026-07-11T08:00:00',
            SUSPENDED: false,
            IS_NEW: true,
          },
        ],
      }),
      event({
        publishDatetime: '2026-07-12T08:00:00',
        patientPharmaIndicationResume: [
          {
            MRE_ID: 900,
            DESCRIPTOR: 'CEFTRIAXONA 1 g',
            POSOLOGY: '1 g cada 12 h',
            ROUTE_ADMINISTRATION: 'Endovenosa',
            PUBLISH_DATETIME: '2026-07-12T08:00:00',
            SUSPENDED: true,
            IS_NEW: false,
          },
        ],
      }),
    ]);

    expect(panel.indications).toHaveLength(1);
    expect(panel.indications[0]).toMatchObject({
      kind: 'pharma',
      title: 'CEFTRIAXONA 1 g',
      text: '1 g cada 12 h · Endovenosa',
      suspended: true,
    });
  });

  it('parses free indications, diet and rest into the indications list', () => {
    const panel = parseClinicalPanel([
      event({
        patientFreeIndicationResume: [
          { AMRE_ID: 3, INDICATION: 'Curación diaria', HCP_NAME: 'Dr. Tres', SUSPENDED: 'false' },
        ],
        nutritionOrderResume: [
          { DIET_type: 'Liviano', OBSERVATION: 'Sin sal', HCPR_NAME: 'Dra. Uno' },
        ],
        restResume: [{ rest_type: 'Relativo', OBSERVATION: '', HCPR_NAME: 'Dra. Uno' }],
      }),
    ]);

    expect(panel.indications.map(i => i.kind).sort()).toEqual(['diet', 'free-indication', 'rest']);
    expect(panel.indications.find(i => i.kind === 'diet')?.text).toBe('Liviano · Sin sal');
    expect(panel.indications.find(i => i.kind === 'rest')?.text).toBe('Relativo');
  });

  it('flags archived/crossed-out and accepts 1/"S" style truthy values', () => {
    const panel = parseClinicalPanel([
      event({
        evolutionResume: [
          { id: 1, OBE_NOTES: 'Nota anulada', ARCHIVED: 1, IS_CROSSED_OUT: 'S', HCPR_NAME: 'X' },
        ],
      }),
    ]);
    expect(panel.evolutions[0]).toMatchObject({ archived: true, crossedOut: true });
  });

  it('skips rows without clinical text and tolerates malformed events', () => {
    const panel = parseClinicalPanel([
      event({ evolutionResume: [{ id: 9, OBE_NOTES: '   ' }, null, 'basura'] }),
      null as unknown as RayenClinicalPanelEvent,
    ]);
    expect(panel.evolutions).toHaveLength(0);
    expect(panel.indications).toHaveLength(0);
  });
});
