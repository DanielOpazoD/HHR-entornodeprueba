// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  joinApplicationIssueMessages,
  resolveApplicationOutcomeMessage,
  resolveFailedApplicationOutcomeMessage,
  resolvePrimaryApplicationIssueMessage,
} from '@/shared/contracts/applicationOutcomeMessage';

describe('applicationOutcomeMessage', () => {
  it('prefers userSafeMessage over issue messages', () => {
    expect(
      resolveApplicationOutcomeMessage(
        {
          userSafeMessage: 'Mensaje seguro',
          issues: [{ message: 'Mensaje técnico' }],
        },
        'Fallback'
      )
    ).toBe('Mensaje seguro');
  });

  it('falls back to first issue message and then fallback', () => {
    expect(
      resolveApplicationOutcomeMessage(
        {
          issues: [{ message: 'Mensaje técnico' }],
        },
        'Fallback'
      )
    ).toBe('Mensaje técnico');

    expect(resolveApplicationOutcomeMessage({}, 'Fallback')).toBe('Fallback');
  });

  it('returns null for successful outcomes in failed-only resolver', () => {
    expect(
      resolveFailedApplicationOutcomeMessage(
        {
          status: 'success',
          userSafeMessage: 'No debería usarse',
        },
        'Fallback'
      )
    ).toBeNull();

    expect(
      resolveFailedApplicationOutcomeMessage(
        {
          status: 'failed',
          issues: [{ userSafeMessage: 'Error visible' }],
        },
        'Fallback'
      )
    ).toBe('Error visible');
  });

  it('resolves the primary issue message using user-safe copy first', () => {
    expect(
      resolvePrimaryApplicationIssueMessage(
        [{ userSafeMessage: 'Visible', message: 'Technical' }],
        'Fallback'
      )
    ).toBe('Visible');
  });

  it('joins issue messages preserving user-safe text when available', () => {
    expect(
      joinApplicationIssueMessages([
        { userSafeMessage: 'Visible', message: 'Technical' },
        { message: 'Second raw' },
      ])
    ).toBe('Visible\nSecond raw');
  });
});
