// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createInitialCensusMessageState,
  createInitialCensusSendState,
  resolveCensusEmailMessage,
  resolveDateBoundSendState,
  updateDateBoundErrorState,
  updateDateBoundStatusState,
} from '@/features/census/email/controllers/censusEmailStateController';

describe('censusEmailStateController', () => {
  it('creates initial date-bound message state', () => {
    expect(createInitialCensusMessageState('2025-01-08', 'Nurse')).toEqual({
      key: '2025-01-08',
      value: expect.stringContaining('Nurse'),
      edited: false,
    });
  });

  it('resolves generated message when state is stale or unedited', () => {
    const staleState = { key: '2025-01-07', value: 'Old', edited: true };
    expect(resolveCensusEmailMessage(staleState, '2025-01-08', 'Nurse')).toContain('Nurse');

    const freshUneditedState = { key: '2025-01-08', value: 'Ignored', edited: false };
    expect(resolveCensusEmailMessage(freshUneditedState, '2025-01-08', 'Nurse')).toContain('Nurse');
  });

  it('preserves manual edits for the active day', () => {
    const editedState = { key: '2025-01-08', value: 'Manual edit', edited: true };
    expect(resolveCensusEmailMessage(editedState, '2025-01-08', 'Nurse')).toBe('Manual edit');
  });

  it('updates date-bound send state without leaking old dates', () => {
    const initial = createInitialCensusSendState('2025-01-08');
    const loading = updateDateBoundStatusState(initial, '2025-01-08', 'loading');
    expect(resolveDateBoundSendState(loading, '2025-01-08')).toEqual({
      status: 'loading',
      error: null,
    });

    expect(resolveDateBoundSendState(loading, '2025-01-09')).toEqual({
      status: 'idle',
      error: null,
    });
  });

  it('updates date-bound errors while preserving current status', () => {
    const loading = updateDateBoundStatusState(
      createInitialCensusSendState('2025-01-08'),
      '2025-01-08',
      'loading'
    );
    expect(updateDateBoundErrorState(loading, '2025-01-08', 'Boom')).toEqual({
      key: '2025-01-08',
      status: 'loading',
      error: 'Boom',
    });
  });
});
