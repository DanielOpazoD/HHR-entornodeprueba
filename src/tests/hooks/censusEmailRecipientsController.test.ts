import { describe, expect, it } from 'vitest';

import {
  resolveLegacyRecipients,
  resolveSendingRecipients,
  resolveStoredRecipients,
} from '@/hooks/controllers/censusEmailRecipientsController';

describe('censusEmailRecipientsController', () => {
  it('resolves recipients from stored settings array', () => {
    expect(resolveStoredRecipients(['a@test.com'])).toEqual(['a@test.com']);
    expect(resolveStoredRecipients([])).toBeNull();
    expect(resolveStoredRecipients(null)).toBeNull();
  });

  it('resolves recipients from legacy JSON payload', () => {
    expect(resolveLegacyRecipients('["legacy@test.com"]')).toEqual(['legacy@test.com']);
    expect(resolveLegacyRecipients('{bad json}')).toBeNull();
  });

  it('validates test mode recipient and normalizes main recipients', () => {
    const invalidTestMode = resolveSendingRecipients({
      recipients: ['a@test.com'],
      shouldUseTestMode: true,
      testRecipient: 'bad-email',
    });
    expect(invalidTestMode.ok).toBe(false);

    const normalMode = resolveSendingRecipients({
      recipients: [' A@TEST.COM ', ''],
      shouldUseTestMode: false,
      testRecipient: '',
    });
    expect(normalMode).toEqual({ ok: true, recipients: ['a@test.com'] });
  });
});
