// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { buildAuthRedirectRuntimeSupport } from '@/services/auth/authRedirectSupportController';

describe('authRedirectSupportController', () => {
  it('disables redirect on localhost when local redirect is not preferred', () => {
    const support = buildAuthRedirectRuntimeSupport({
      hostname: 'localhost',
      isLocalhostRuntime: true,
      preferRedirectOnLocalhost: false,
      firebaseAuthConfig: {
        authDomain: 'demo.firebaseapp.com',
        hasAuthDomain: true,
        usesFirebaseHostedAuthDomain: true,
        canAttemptRedirectAuth: true,
        redirectSupportLevel: 'ready',
        redirectBlockedReason: null,
        supportSummary: null,
        supportAction: null,
      },
    });

    expect(support.canUseRedirectAuth).toBe(false);
    expect(support.supportLevel).toBe('disabled');
    expect(support.recommendedFlowLabel).toContain('Ventana');
  });

  it('propagates firebase redirect support when auth config blocks redirect', () => {
    const support = buildAuthRedirectRuntimeSupport({
      hostname: 'app.hhr.test',
      isLocalhostRuntime: false,
      preferRedirectOnLocalhost: false,
      firebaseAuthConfig: {
        authDomain: 'demo.firebaseapp.com',
        hasAuthDomain: true,
        usesFirebaseHostedAuthDomain: true,
        canAttemptRedirectAuth: false,
        redirectSupportLevel: 'warning',
        redirectBlockedReason: 'blocked',
        supportSummary: 'summary',
        supportAction: 'action',
      },
    });

    expect(support.canUseRedirectAuth).toBe(false);
    expect(support.redirectDisabledReason).toBe('blocked');
    expect(support.supportSummary).toBe('summary');
  });
});
