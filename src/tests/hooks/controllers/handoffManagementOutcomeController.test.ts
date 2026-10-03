// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createApplicationFailed } from '@/shared/contracts/applicationOutcomeFactories';
import { presentHandoffManagementFailure } from '@/hooks/controllers/handoffManagementOutcomeController';

describe('handoffManagementOutcomeController', () => {
  it('prefers mapped titles and user-safe messages', () => {
    const outcome = createApplicationFailed(
      null,
      [
        {
          kind: 'validation',
          message: 'technical',
          userSafeMessage: 'mensaje visible',
        },
      ],
      {
        reason: 'missing_base_note',
        userSafeMessage: 'mensaje visible',
      }
    );

    expect(
      presentHandoffManagementFailure(outcome, {
        fallbackMessage: 'fallback',
        fallbackTitle: 'Error',
        reasonTitles: { missing_base_note: 'Sin nota base' },
      })
    ).toEqual({
      message: 'mensaje visible',
      title: 'Sin nota base',
    });
  });
});
