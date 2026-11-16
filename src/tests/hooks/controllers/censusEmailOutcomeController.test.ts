// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  createApplicationFailed,
  createApplicationPartial,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import { resolveCensusEmailSendOutcomePresentation } from '@/hooks/controllers/censusEmailOutcomeController';

describe('censusEmailOutcomeController', () => {
  it('maps success outcome to success state without alert', () => {
    const presentation = resolveCensusEmailSendOutcomePresentation(createApplicationSuccess({}), {
      fallbackErrorMessage: 'fallback',
      partialTitle: 'partial',
      errorTitle: 'error',
    });

    expect(presentation).toEqual({
      nextStatus: 'success',
      error: null,
      state: 'ok',
      actionRequired: false,
    });
  });

  it('maps partial outcome to success state with warning alert', () => {
    const presentation = resolveCensusEmailSendOutcomePresentation(
      createApplicationPartial({}, [
        { kind: 'unknown', message: 'backup warning', userSafeMessage: 'warning safe' },
      ]),
      {
        fallbackErrorMessage: 'fallback',
        partialTitle: 'partial',
        errorTitle: 'error',
      }
    );

    expect(presentation.nextStatus).toBe('success');
    expect(presentation.alertTitle).toBe('partial');
    expect(presentation.alertMessage).toContain('warning safe');
    expect(presentation.state).toBe('pending');
    expect(presentation.actionRequired).toBe(false);
  });

  it('maps validation failures to validation title when requested', () => {
    const presentation = resolveCensusEmailSendOutcomePresentation(
      createApplicationFailed(null, [
        {
          kind: 'validation',
          message: 'missing recipient',
          userSafeMessage: 'recipient safe',
        },
      ]),
      {
        fallbackErrorMessage: 'fallback',
        partialTitle: 'partial',
        errorTitle: 'error',
        validationTitle: 'validation',
        shouldUseValidationTitle: true,
      }
    );

    expect(presentation.nextStatus).toBe('error');
    expect(presentation.error).toBe('recipient safe');
    expect(presentation.alertTitle).toBe('validation');
    expect(presentation.state).toBe('blocked');
    expect(presentation.actionRequired).toBe(true);
  });
});
