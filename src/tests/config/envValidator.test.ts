import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/utils/loggerScope', () => ({
  createScopedLogger: () => ({ error: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('client environment validation', () => {
  it('allows runtime Firebase configuration in production and excludes unrelated keys', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    vi.stubEnv('VITE_LOCAL_AI_PROVIDER', undefined);
    vi.stubEnv('VITE_UNRELATED_SENTINEL', 'not-a-client-setting');
    const { validateClientEnv } = await import('@/config/envValidator');
    const result = validateClientEnv();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.env.VITE_FIREBASE_API_KEY).toBe('');
      expect(result.env).not.toHaveProperty('VITE_UNRELATED_SENTINEL');
    }
  });

  it('retains optional provider validation in production', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_LOCAL_AI_PROVIDER', 'unsupported');
    const { validateClientEnv } = await import('@/config/envValidator');
    expect(validateClientEnv()).toMatchObject({
      success: false,
      issues: [expect.stringContaining('VITE_LOCAL_AI_PROVIDER')],
    });
  });

  it('still reports missing Firebase configuration in development', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FIREBASE_APP_ID', '');
    vi.stubEnv('VITE_LOCAL_AI_PROVIDER', undefined);
    const { validateClientEnv } = await import('@/config/envValidator');
    expect(validateClientEnv()).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.stringContaining('VITE_FIREBASE_APP_ID')]),
    });
  });
});
