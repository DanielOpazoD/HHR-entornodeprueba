import { describe, expect, it } from 'vitest';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import {
  buildClinicalEventAddForm,
  buildClinicalEventEditForm,
  buildClinicalEventSubmission,
  buildClinicalEventToday,
  canSaveClinicalEventForm,
  EMPTY_CLINICAL_EVENT_FORM,
  sortClinicalEventsByDateDesc,
} from '@/features/handoff/controllers/clinicalEventsPanelController';

describe('clinicalEventsPanelController', () => {
  it('builds empty and add forms with the expected defaults', () => {
    expect(EMPTY_CLINICAL_EVENT_FORM).toEqual({
      name: '',
      date: '',
      note: '',
    });
    expect(buildClinicalEventToday('2026-03-26T18:45:00.000Z')).toBe('2026-03-26');
    expect(buildClinicalEventAddForm('2026-03-26')).toEqual({
      name: '',
      date: '2026-03-26',
      note: '',
    });
  });

  it('reads an instant on the hospital calendar before midnight', () => {
    expect(buildClinicalEventToday('2026-10-25T04:30:00.000Z')).toBe('2026-10-24');
  });

  it('maps an existing event into editable form state', () => {
    const event: ClinicalEvent = {
      id: 'evt-1',
      name: 'Cultivo',
      date: '2026-03-20',
      note: 'Pendiente',
      createdAt: '2026-03-20T12:00:00.000Z',
    };

    expect(buildClinicalEventEditForm(event)).toEqual({
      name: 'Cultivo',
      date: '2026-03-20',
      note: 'Pendiente',
    });
  });

  it('validates and normalizes clinical event submissions', () => {
    expect(
      canSaveClinicalEventForm({
        name: '  ',
        date: '2026-03-26',
        note: '',
      })
    ).toBe(false);

    expect(
      buildClinicalEventSubmission({
        name: ' Broncoscopía ',
        date: '2026-03-26',
        note: ' Control ',
      })
    ).toEqual({
      name: 'Broncoscopía',
      date: '2026-03-26',
      note: 'Control',
    });
  });

  it('sorts events by newest date first', () => {
    const events: ClinicalEvent[] = [
      {
        id: 'evt-1',
        name: 'Evento antiguo',
        date: '2026-03-20',
        createdAt: '2026-03-20T10:00:00.000Z',
      },
      {
        id: 'evt-2',
        name: 'Evento nuevo',
        date: '2026-03-25',
        createdAt: '2026-03-25T10:00:00.000Z',
      },
    ];

    expect(sortClinicalEventsByDateDesc(events).map(event => event.id)).toEqual(['evt-2', 'evt-1']);
  });
});
