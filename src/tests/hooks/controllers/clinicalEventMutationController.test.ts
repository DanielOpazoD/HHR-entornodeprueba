// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';
import {
  appendClinicalEvent,
  buildAddedClinicalEvent,
  removeClinicalEventFromList,
  updateClinicalEventList,
} from '@/features/handoff/controllers/clinicalEventMutationController';

describe('clinicalEventMutationController', () => {
  const existingEvent: ClinicalEvent = {
    id: 'evt-1',
    name: 'Cultivo',
    date: '2026-03-17',
    note: 'Inicial',
    createdAt: '2026-03-17T10:00:00.000Z',
  };

  it('builds a clinical event with generated id and timestamp', () => {
    expect(
      buildAddedClinicalEvent(
        { name: 'Broncoscopía', date: '2026-03-17', note: 'Sin incidentes' },
        () => 'evt-2',
        () => '2026-03-17T11:00:00.000Z'
      )
    ).toEqual({
      id: 'evt-2',
      name: 'Broncoscopía',
      date: '2026-03-17',
      note: 'Sin incidentes',
      createdAt: '2026-03-17T11:00:00.000Z',
    });
  });

  it('appends and updates clinical events immutably', () => {
    const appended = appendClinicalEvent(
      { clinicalEvents: [existingEvent] },
      {
        ...existingEvent,
        id: 'evt-2',
      }
    );
    expect(appended).toHaveLength(2);

    const updated = updateClinicalEventList({ clinicalEvents: [existingEvent] }, 'evt-1', {
      note: 'Actualizado',
    });
    expect(updated[0]?.note).toBe('Actualizado');
  });

  it('removes an event and reports the deleted entry', () => {
    const result = removeClinicalEventFromList({ clinicalEvents: [existingEvent] }, 'evt-1');

    expect(result.nextEvents).toEqual([]);
    expect(result.deletedEvent?.id).toBe('evt-1');
  });
});
