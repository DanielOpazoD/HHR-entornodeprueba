// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveAuthRedirectEnvironment } from '@/services/auth/authRedirectEnvironment';
import { buildAuthRedirectRuntimeSupport } from '@/services/auth/authRedirectSupportController';

const resolveAuthRedirectRuntimeSupport = (
  ...args: Parameters<typeof resolveAuthRedirectEnvironment>
) => buildAuthRedirectRuntimeSupport(resolveAuthRedirectEnvironment(...args));

describe('authRedirectRuntime', () => {
  it('disables redirect auth on localhost by default', () => {
    const support = resolveAuthRedirectRuntimeSupport(
      'localhost',
      false,
      'hospitalhangaroa.firebaseapp.com'
    );

    expect(support.canUseRedirectAuth).toBe(false);
    expect(support.supportLevel).toBe('disabled');
    expect(support.redirectDisabledReason).toMatch(/desactivado/i);
    expect(support.supportSummary).toMatch(/ventana normal de google/i);
  });

  it('allows redirect auth on non-localhost runtimes when authDomain exists', () => {
    const support = resolveAuthRedirectRuntimeSupport(
      'app.hhr.test',
      false,
      'hospitalhangaroa.firebaseapp.com'
    );

    expect(support.canUseRedirectAuth).toBe(true);
    expect(support.redirectDisabledReason).toBeNull();
    expect(support.recommendedFlowLabel).toBeTruthy();
  });

  it('exposes whether the authDomain is Firebase-hosted', () => {
    const support = resolveAuthRedirectRuntimeSupport(
      'app.hhr.test',
      false,
      'hospitalhangaroa.firebaseapp.com'
    );

    expect(typeof support.authDomain).toBe('string');
    expect(typeof support.usesFirebaseHostedAuthDomain).toBe('boolean');
  });
});
