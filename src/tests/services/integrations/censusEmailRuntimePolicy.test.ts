// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CENSUS_EMAIL_ENDPOINT,
  getDevelopmentSendDisabledMessage,
  resolveCensusEmailRuntimePolicy,
} from '@/services/integrations/censusEmailRuntimePolicy';

describe('censusEmailRuntimePolicy', () => {
  it('uses default endpoint when none is provided', () => {
    const policy = resolveCensusEmailRuntimePolicy({
      isDevelopment: false,
    });

    expect(policy.endpoint).toBe(DEFAULT_CENSUS_EMAIL_ENDPOINT);
    expect(policy.allowDevelopmentEmailSend).toBe(false);
  });

  it('allows overriding endpoint from env', () => {
    const policy = resolveCensusEmailRuntimePolicy({
      isDevelopment: false,
      endpointRaw: 'http://localhost:8888/.netlify/functions/send-census-email',
    });

    expect(policy.endpoint).toBe('http://localhost:8888/.netlify/functions/send-census-email');
  });

  it('enables dev email send only with explicit opt-in', () => {
    const enabled = resolveCensusEmailRuntimePolicy({
      isDevelopment: true,
      allowDevEmailSendRaw: 'true',
    });
    const disabled = resolveCensusEmailRuntimePolicy({
      isDevelopment: true,
      allowDevEmailSendRaw: 'false',
    });
    const ignoredInProd = resolveCensusEmailRuntimePolicy({
      isDevelopment: false,
      allowDevEmailSendRaw: 'true',
    });

    expect(enabled.allowDevelopmentEmailSend).toBe(true);
    expect(disabled.allowDevelopmentEmailSend).toBe(false);
    expect(ignoredInProd.allowDevelopmentEmailSend).toBe(false);
  });

  it('returns human-friendly development disabled message', () => {
    const message = getDevelopmentSendDisabledMessage();
    expect(message).toContain('deshabilitado');
    expect(message).toContain('VITE_ALLOW_DEV_EMAIL_SEND=true');
  });
});
