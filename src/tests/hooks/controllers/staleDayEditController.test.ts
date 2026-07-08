import { describe, expect, it } from 'vitest';
import { resolveStaleDayEditDecision } from '@/hooks/controllers/staleDayEditController';

describe('resolveStaleDayEditDecision', () => {
  it('allows editing the clinical today', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-29',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: false,
      })
    ).toBe('allowed');
  });

  it('requires confirmation for a previous day not yet confirmed', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-28',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: false,
      })
    ).toBe('requires-confirmation');
  });

  it('allows a previous day once it has been confirmed (one prompt per day)', () => {
    expect(
      resolveStaleDayEditDecision({
        currentDateString: '2026-06-28',
        clinicalToday: '2026-06-29',
        alreadyConfirmed: true,
      })
    ).toBe('allowed');
  });
});
