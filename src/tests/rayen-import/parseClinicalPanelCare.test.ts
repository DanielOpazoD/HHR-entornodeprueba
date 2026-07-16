import { describe, expect, it } from 'vitest';
import { parseClinicalPanel } from '@/features/rayen-import/mapping/parseClinicalPanel';

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

  it('uses the first valid care date', () => {
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
