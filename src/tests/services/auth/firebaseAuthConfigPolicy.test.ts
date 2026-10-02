// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  getFirebaseAuthConfigStatus,
  getFirebaseRuntimeConfigDiagnostics,
} from '@/services/auth/firebaseAuthConfigPolicy';

describe('firebaseAuthConfigPolicy', () => {
  it('blocks redirect auth when authDomain is missing', () => {
    const status = getFirebaseAuthConfigStatus('');

    expect(status.canAttemptRedirectAuth).toBe(false);
    expect(status.redirectSupportLevel).toBe('disabled');
    expect(status.redirectBlockedReason).toContain('acceso alternativo');
    expect(status.supportSummary).toContain('dominio de autenticación');
    expect(status.supportAction).toContain('VITE_FIREBASE_AUTH_DOMAIN');
  });

  it('detects Firebase-hosted auth domains', () => {
    const status = getFirebaseAuthConfigStatus('hhr-pruebas.firebaseapp.com');

    expect(status.canAttemptRedirectAuth).toBe(true);
    expect(status.usesFirebaseHostedAuthDomain).toBe(true);
    expect(status.redirectSupportLevel).toBe('ready');
  });

  it('allows non-hosted auth domains but marks them as non-hosted', () => {
    const status = getFirebaseAuthConfigStatus('auth.hospital.cl');

    expect(status.canAttemptRedirectAuth).toBe(true);
    expect(status.usesFirebaseHostedAuthDomain).toBe(false);
    expect(status.redirectSupportLevel).toBe('warning');
    expect(status.supportSummary).toContain('no usa el hosting estándar');
    expect(status.supportAction).toContain('/__/auth/handler');
  });

  it('reports blocking Firebase runtime issues when core config is missing', () => {
    const diagnostics = getFirebaseRuntimeConfigDiagnostics({
      apiKey: '',
      projectId: '',
      appId: '',
      authDomain: '',
    });

    expect(diagnostics.hasBlockingIssue).toBe(true);
    expect(diagnostics.issues.some(issue => issue.field === 'apiKey')).toBe(true);
    expect(diagnostics.issues.some(issue => issue.field === 'projectId')).toBe(true);
    expect(diagnostics.issues.some(issue => issue.field === 'appId')).toBe(true);
    expect(diagnostics.summary).toContain('no puede iniciar');
  });
});
