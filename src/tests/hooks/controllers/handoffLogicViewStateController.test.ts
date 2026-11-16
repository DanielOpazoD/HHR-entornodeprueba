// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildHandoffLogicViewState } from '@/hooks/controllers/handoffLogicViewStateController';

describe('handoffLogicViewStateController', () => {
  it('returns the shared derived handoff view state as a single contract', () => {
    const viewState = buildHandoffLogicViewState({
      visibleBeds: [{ id: 'R1' }] as never,
      hasAnyPatients: true,
      noteField: 'handoffNoteDayShift',
      deliversList: ['Enfermera A'],
      receivesList: ['Enfermera B'],
      tensList: ['Tens A'],
    });

    expect(viewState).toEqual({
      visibleBeds: [{ id: 'R1' }],
      hasAnyPatients: true,
      noteField: 'handoffNoteDayShift',
      deliversList: ['Enfermera A'],
      receivesList: ['Enfermera B'],
      tensList: ['Tens A'],
    });
  });
});
