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

  it('does not apply a current suspension retroactively to the prescription day', () => {
    const panel = parseClinicalPanel(
      [
        event({
          patientPharmaIndicationResume: [
            {
              MRE_ID: 900,
              DESCRIPTOR: 'CEFTRIAXONA 2 g',
              PUBLISH_DATETIME: '2026-07-12T08:00:00',
              SUSPENDED: false,
            },
          ],
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 900, suspended: true, archived: false }],
      }
    );

    expect(panel.indicationDays[0].suspended).toHaveLength(0);
    expect(panel.indicationDays[0].active[0]).toMatchObject({
      id: '900',
      suspended: false,
    });
  });

  it('does not apply current finalization retroactively to the prescription day', () => {
    const panel = parseClinicalPanel(
      [
        event({
          patientPharmaIndicationResume: [
            {
              MRE_ID: 901,
              DESCRIPTOR: 'AMOXICILINA 500 mg',
              PUBLISH_DATETIME: '2026-07-12T08:00:00',
              SUSPENDED: false,
            },
          ],
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 901, suspended: false, archived: false, finalized: true }],
      }
    );

    expect(panel.indicationDays[0].suspended).toHaveLength(0);
    expect(panel.indicationDays[0].active[0]).toMatchObject({
      id: '901',
      suspended: false,
      finalized: false,
    });
  });

  it('projects an active medication onto every day with a treatment validation', () => {
    const panel = parseClinicalPanel(
      [
        event({
          publishDatetime: '2026-07-10T08:00:00',
          patientPharmaIndicationResume: [
            {
              MRE_ID: 902,
              DESCRIPTOR: 'CEFTRIAXONA 2 g',
              POSOLOGY: '2 g cada 24 h',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
            },
          ],
        }),
        event({
          publishDatetime: '2026-07-11T09:00:00',
          validationDatetime: '2026-07-11T09:00:00',
        }),
        event({
          publishDatetime: '2026-07-12T09:00:00',
          validationDatetime: '2026-07-12T09:00:00',
        }),
        event({
          publishDatetime: '2026-07-13T09:00:00',
          validationDatetime: '2026-07-13T09:00:00',
        }),
        event({
          publishDatetime: '2026-07-14T09:00:00',
          validationDatetime: '2026-07-14T09:00:00',
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 902, suspended: false, archived: false, finalized: false }],
      }
    );

    expect(panel.indicationDays.map(day => day.day)).toEqual([
      '2026-07-14',
      '2026-07-13',
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
    ]);
    expect(panel.indicationDays.slice(0, 4).map(day => day.active[0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'CEFTRIAXONA 2 g',
          validitySource: 'daily-validation',
          prescribedAt: '2026-07-10T08:00:00',
        }),
      ])
    );
    expect(panel.indicationDays.every(day => day.active[0]?.title === 'CEFTRIAXONA 2 g')).toBe(
      true
    );
  });

  it('uses the medication version that already existed on each validated day', () => {
    const panel = parseClinicalPanel(
      [
        event({
          publishDatetime: '2026-07-10T08:00:00',
          patientPharmaIndicationResume: [
            {
              MRE_ID: 908,
              DESCRIPTOR: 'CEFTRIAXONA 1 g',
              POSOLOGY: '1 g cada 24 h',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
            },
          ],
        }),
        event({ validationDatetime: '2026-07-11T09:00:00' }),
        event({ validationDatetime: '2026-07-12T09:00:00' }),
        event({
          publishDatetime: '2026-07-13T08:00:00',
          patientPharmaIndicationResume: [
            {
              MRE_ID: 908,
              DESCRIPTOR: 'CEFTRIAXONA 2 g',
              POSOLOGY: '2 g cada 24 h',
              PUBLISH_DATETIME: '2026-07-13T08:00:00',
            },
          ],
        }),
        event({ validationDatetime: '2026-07-14T09:00:00' }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 908, suspended: false, archived: false, finalized: false }],
      }
    );

    expect(panel.indicationDays.find(day => day.day === '2026-07-11')?.active[0]).toMatchObject({
      id: '908',
      title: 'CEFTRIAXONA 1 g',
      prescribedAt: '2026-07-10T08:00:00',
      validitySource: 'daily-validation',
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-12')?.active[0]).toMatchObject({
      title: 'CEFTRIAXONA 1 g',
      prescribedAt: '2026-07-10T08:00:00',
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-13')?.active[0]).toMatchObject({
      title: 'CEFTRIAXONA 2 g',
      validitySource: 'indication',
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-14')?.active[0]).toMatchObject({
      title: 'CEFTRIAXONA 2 g',
      prescribedAt: '2026-07-13T08:00:00',
      validitySource: 'daily-validation',
    });
  });

  it('preserves past validated days after a medication is later suspended', () => {
    const panel = parseClinicalPanel(
      [
        event({
          publishDatetime: '2026-07-10T08:00:00',
          patientPharmaIndicationResume: [
            {
              MRE_ID: 903,
              DESCRIPTOR: 'CEFTRIAXONA 2 g',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
              SUSPENDED: false,
            },
            {
              MRE_ID: 903,
              DESCRIPTOR: 'CEFTRIAXONA 2 g',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
              SUSPENDED: true,
            },
          ],
        }),
        event({
          publishDatetime: '2026-07-11T09:00:00',
          validationDatetime: '2026-07-11T09:00:00',
        }),
        event({
          publishDatetime: '2026-07-12T09:00:00',
          validationDatetime: '2026-07-12T09:00:00',
        }),
        event({
          publishDatetime: '2026-07-13T09:00:00',
          validationDatetime: '2026-07-13T09:00:00',
        }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [
          {
            id: 903,
            suspended: true,
            archived: false,
            finalized: false,
            programmingEndDatetime: '2026-07-13T08:00:00',
          },
        ],
      }
    );

    expect(panel.indicationDays.find(day => day.day === '2026-07-11')?.active[0]).toMatchObject({
      id: '903',
      validitySource: 'daily-validation',
      suspended: false,
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-12')?.active[0]).toMatchObject({
      id: '903',
      validitySource: 'daily-validation',
      suspended: false,
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-13')).toBeUndefined();
  });

  it('does not invent historical validity for an undated current suspension', () => {
    const panel = parseClinicalPanel(
      [
        event({
          publishDatetime: '2026-07-10T08:00:00',
          patientPharmaIndicationResume: [
            {
              MRE_ID: 904,
              DESCRIPTOR: 'AMOXICILINA 500 mg',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
            },
          ],
        }),
        event({ validationDatetime: '2026-07-11T09:00:00' }),
        event({ validationDatetime: '2026-07-12T09:00:00' }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 904, suspended: true, archived: false, finalized: false }],
      }
    );

    expect(panel.indicationDays.find(day => day.day === '2026-07-11')).toBeUndefined();
    expect(panel.indicationDays.find(day => day.day === '2026-07-12')).toBeUndefined();
  });

  it('uses the earliest dated medication end marker', () => {
    const panel = parseClinicalPanel(
      [
        event({
          patientPharmaIndicationResume: [
            {
              MRE_ID: 905,
              DESCRIPTOR: 'CLINDAMICINA 600 mg',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
            },
          ],
        }),
        event({ validationDatetime: '2026-07-11T09:00:00' }),
        event({ validationDatetime: '2026-07-12T09:00:00' }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [
          {
            id: 905,
            suspended: true,
            programmingEndDatetime: '2026-07-14T08:00:00',
            deletedDateTime: '2026-07-12T08:00:00',
          },
        ],
      }
    );

    expect(panel.indicationDays.find(day => day.day === '2026-07-11')?.active[0]?.id).toBe('905');
    expect(panel.indicationDays.find(day => day.day === '2026-07-12')).toBeUndefined();
  });

  it('fails closed when no current medication state can be verified', () => {
    const panel = parseClinicalPanel([
      event({
        patientPharmaIndicationResume: [
          {
            MRE_ID: 906,
            DESCRIPTOR: 'VANCOMICINA 1 g',
            PUBLISH_DATETIME: '2026-07-10T08:00:00',
          },
        ],
      }),
      event({ validationDatetime: '2026-07-11T09:00:00' }),
    ]);

    expect(panel.indicationDays.find(day => day.day === '2026-07-10')?.active[0]?.id).toBe('906');
    expect(panel.indicationDays.find(day => day.day === '2026-07-11')).toBeUndefined();
  });

  it('emits at most one medication row per day and prefers the source indication', () => {
    const panel = parseClinicalPanel(
      [
        event({
          patientPharmaIndicationResume: [
            {
              MRE_ID: 907,
              DESCRIPTOR: 'METRONIDAZOL 500 mg',
              PUBLISH_DATETIME: '2026-07-10T08:00:00',
            },
          ],
          validationDatetime: '2026-07-10T10:00:00',
        }),
        event({ validationDatetime: '2026-07-11T09:00:00' }),
        event({ validationDatetime: '2026-07-11T18:00:00' }),
      ],
      {
        carePlanHeaders: [],
        medicationStates: [{ id: 907, suspended: false, archived: false, finalized: false }],
      }
    );

    expect(panel.indicationDays.find(day => day.day === '2026-07-10')?.active).toHaveLength(1);
    expect(panel.indicationDays.find(day => day.day === '2026-07-10')?.active[0]).toMatchObject({
      id: '907',
      validitySource: 'indication',
    });
    expect(panel.indicationDays.find(day => day.day === '2026-07-11')?.active).toHaveLength(1);
    expect(panel.indicationDays.find(day => day.day === '2026-07-11')?.active[0]).toMatchObject({
      id: '907',
      validitySource: 'daily-validation',
      publishedAt: '2026-07-11T18:00:00',
    });
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

describe('parseClinicalPanel — cuidados de enfermería', () => {
  it('groups assigned-care actions by day and makes execution state explicit', () => {
    const panel = parseClinicalPanel([], {
      medicationStates: [],
      carePlanHeaders: [
        {
          scheduledDate: '2026-07-13T00:00:00',
          carePlanBody: [
            {
              entryGuid: 'care-1',
              title: 'Cambio de posición',
              activity: 'Cambio de posición',
              hoursRangeActi: '08:00',
              administrationDate: '2026-07-13T08:12:00',
              user: 'ANA PÉREZ',
              isPerformed: true,
            },
            {
              entryGuid: 'care-2',
              title: 'Aseo y confort',
              isPerformedOutSidePlanning: true,
              administrationDate: '2026-07-13T09:00:00',
            },
            {
              entryGuid: 'care-3',
              title: 'Curación',
              doNotExecute: { reason: 'rechazo' },
            },
          ],
        },
      ],
    });

    expect(panel.careDays).toHaveLength(1);
    expect(panel.careDays[0].label).toBe('13-07-2026');
    expect(panel.careDays[0].actions.map(action => action.status)).toEqual([
      'outside-plan',
      'performed',
      'not-performed',
    ]);
    expect(panel.careDays[0].actions[1]).toMatchObject({
      title: 'Cambio de posición',
      author: 'Ana Pérez',
      schedule: '08:00',
    });
  });

  it('falls back to the first valid care date instead of the first non-empty value', () => {
    const panel = parseClinicalPanel([], {
      medicationStates: [],
      carePlanHeaders: [
        {
          scheduledDate: 'fecha-inválida',
          labelDate: '2026-07-14T00:00:00',
          carePlanBody: [{ entryGuid: 'care-date', title: 'Control de signos vitales' }],
        },
      ],
    });

    expect(panel.careDays[0]).toMatchObject({ day: '2026-07-14', label: '14-07-2026' });
  });

  it('translates and deduplicates technical care-plan labels', () => {
    const panel = parseClinicalPanel([], {
      medicationStates: [],
      carePlanHeaders: [
        {
          scheduledDate: '2026-07-14T00:00:00',
          carePlanBody: [
            {
              entryGuid: 'care-label',
              title: 'Cambio de posición',
              activity: 'assignedCareActivity',
              tag: 'assignedCareActivity',
            },
          ],
        },
      ],
    });

    expect(panel.careDays[0].actions[0]?.detail).toBe('Cuidado asignado');
  });

  it('keeps repeated Eloisa care GUIDs unique within the rendered plan', () => {
    const panel = parseClinicalPanel([], {
      medicationStates: [],
      carePlanHeaders: [
        {
          scheduledDate: '2026-07-15',
          carePlanBody: [
            { entryGuid: '00000000-0000-0000-0000-000000000000', title: 'Cambio de posición' },
            { entryGuid: '00000000-0000-0000-0000-000000000000', title: 'Aseo en cama' },
          ],
        },
      ],
    });

    const ids = panel.careDays[0].actions.map(action => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
