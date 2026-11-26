// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertCensusEmailSendingAllowed } from '@/services/integrations/censusEmailSendPolicy';

describe('censusEmailSendPolicy', () => {
  it('throws in development when sending is disabled', () => {
    expect(() =>
      assertCensusEmailSendingAllowed({
        isDevelopment: true,
        allowDevelopmentEmailSend: false,
        date: '2026-03-15',
        recipients: ['test@example.com'],
        recordCount: 4,
        disabledMessage: 'disabled',
        endpoint: 'http://localhost:8080',
      })
    ).toThrow('disabled');
  });

  it('does not throw in development when sending is explicitly enabled', () => {
    expect(() =>
      assertCensusEmailSendingAllowed({
        isDevelopment: true,
        allowDevelopmentEmailSend: true,
        date: '2026-03-15',
        recipients: ['test@example.com'],
        recordCount: 4,
        disabledMessage: 'disabled',
        endpoint: 'http://localhost:8080',
      })
    ).not.toThrow();
  });

  it('does not throw outside development mode', () => {
    expect(() =>
      assertCensusEmailSendingAllowed({
        isDevelopment: false,
        allowDevelopmentEmailSend: false,
        date: '2026-03-15',
        recipients: undefined,
        recordCount: 4,
        disabledMessage: 'disabled',
        endpoint: 'https://api.example.com',
      })
    ).not.toThrow();
  });
});
