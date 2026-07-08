import { describe, expect, it } from 'vitest';

import {
  getFirebaseStartupFailureMessage,
  getFirebaseStartupNotice,
  getFirebaseStartupWarningCopy,
  getMissingEnvWarningCopy,
} from '@/services/auth/firebaseStartupUiPolicy';

describe('firebaseStartupUiPolicy', () => {
  it('returns user-facing startup warning copy', () => {
    const copy = getFirebaseStartupWarningCopy();

    expect(copy.title).toContain('Configuración');
    expect(copy.summary).toContain('Firebase');
    expect(copy.steps.length).toBeGreaterThanOrEqual(2);
    expect(copy.footnote).toContain('podrían no estar disponibles');
  });

  it('returns a single startup failure message for fatal boot errors', () => {
    expect(getFirebaseStartupFailureMessage()).toContain('No se pudo iniciar');
  });

  it('adapts startup warning copy when diagnostics are provided', () => {
    const copy = getFirebaseStartupWarningCopy({
      issues: [
        {
          field: 'apiKey',
          severity: 'blocking',
          summary: 'Falta la clave principal de Firebase.',
          action: 'Configura VITE_FIREBASE_API_KEY.',
        },
      ],
      hasBlockingIssue: true,
      summary: 'La app no puede iniciar por configuración incompleta.',
      nextStep: 'Completa las variables faltantes.',
    });

    expect(copy.summary).toContain('no puede iniciar');
    expect(copy.steps[0]).toContain('VITE_FIREBASE_API_KEY');
  });

  describe('getMissingEnvWarningCopy', () => {
    it('lists every recognised missing Firebase env var in the summary', () => {
      const copy = getMissingEnvWarningCopy([
        'VITE_FIREBASE_API_KEY: Required',
        'VITE_FIREBASE_PROJECT_ID: Required',
      ]);

      expect(copy.title).toContain('variables de entorno');
      expect(copy.summary).toContain('VITE_FIREBASE_API_KEY');
      expect(copy.summary).toContain('VITE_FIREBASE_PROJECT_ID');
    });

    it('falls back to a generic phrase when no recognised Firebase vars are passed', () => {
      const copy = getMissingEnvWarningCopy(['SOMETHING_ELSE: Required']);

      expect(copy.summary).toContain('al menos una variable');
    });

    it('emits actionable steps targeted at local development', () => {
      const copy = getMissingEnvWarningCopy(['VITE_FIREBASE_API_KEY: Required']);

      expect(copy.steps[0]).toContain('cp .env.example');
      expect(copy.steps[1]).toContain('VITE_FIREBASE_*');
      expect(copy.steps[2]).toContain('npm run dev');
      expect(copy.footnote).toContain('producción');
    });

    it('deduplicates repeated env var names so the summary stays short', () => {
      const copy = getMissingEnvWarningCopy([
        'VITE_FIREBASE_API_KEY: Required',
        'VITE_FIREBASE_API_KEY: Required',
        'VITE_FIREBASE_API_KEY: Required',
      ]);

      const occurrences = copy.summary.match(/VITE_FIREBASE_API_KEY/g) ?? [];
      expect(occurrences.length).toBe(1);
    });
  });

  it('maps blocking and degraded startup diagnostics to shared notices', () => {
    expect(
      getFirebaseStartupNotice({
        issues: [],
        hasBlockingIssue: true,
        summary: 'Bloqueante',
        nextStep: 'Revisar variables',
      })
    ).toMatchObject({
      channel: 'error',
      state: 'blocked',
      actionRequired: true,
      message: 'Bloqueante',
    });

    expect(
      getFirebaseStartupNotice({
        issues: [],
        hasBlockingIssue: false,
        summary: 'Advertencia',
        nextStep: 'Revisar variables',
      })
    ).toMatchObject({
      channel: 'warning',
      state: 'degraded',
      actionRequired: false,
      message: 'Advertencia',
    });
  });
});
