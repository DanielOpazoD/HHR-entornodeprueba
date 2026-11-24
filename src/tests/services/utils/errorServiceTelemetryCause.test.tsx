import { render } from '@testing-library/react';
import { ErrorBoundary } from 'react-error-boundary';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({
  saveErrorLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn().mockResolvedValue(true),
}));

import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import { reportCaughtRenderError } from '@/services/observability/renderCrashReporter';
import {
  buildOperationalTelemetryAlert,
  shouldAlertOperationalTelemetry,
} from '@/shared/observability/operationalTelemetryIngestPolicy';
import { sanitizeOperationalTelemetryEvent } from '@/shared/observability/operationalTelemetryPrivacy';
import { errorService } from '@/services/utils/errorService';
import { restoreConsole, suppressConsole } from '@/tests/utils/consoleTestUtils';

const PATIENT_TEXT = 'Paciente Juan Pérez 12.345.678-5';

const mailForLastError = async () => {
  await vi.waitFor(() => expect(dispatchOperationalTelemetryExternally).toHaveBeenCalled());
  const sent = vi.mocked(dispatchOperationalTelemetryExternally).mock.calls.at(-1)![0];
  const event = sanitizeOperationalTelemetryEvent(sent);
  expect(shouldAlertOperationalTelemetry(event)).toBe(true);
  return buildOperationalTelemetryAlert(event, 'HHR').body;
};

const rejectUnhandled = (reason: unknown) => {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
};

describe('an error-service alert says what failed without the message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Touch the singleton so its window handlers are installed.
    expect(errorService).toBeDefined();
  });

  it('names an unhandled Firestore rejection by source and class', async () => {
    rejectUnhandled(
      Object.assign(new Error(`Missing or insufficient permissions. ${PATIENT_TEXT}`), {
        name: 'FirebaseError',
      })
    );

    const body = await mailForLastError();
    expect(body).toContain('- auth_issue');
    expect(body).toContain('- errorSource: unhandled_rejection');
    expect(body).toContain('- errorName: FirebaseError');
    expect(body).not.toContain('Juan');
  });

  it('keeps the Firebase code of a logged Firebase failure', async () => {
    errorService.logFirebaseError({ code: 'permission-denied' }, 'saveRecord');

    const body = await mailForLastError();
    expect(body).toContain('- errorSource: logged');
    expect(body).toContain('- errorCode: permission-denied');
  });

  it('names an uncaught error', async () => {
    window.dispatchEvent(
      // Chrome prefixes the class to the message of an uncaught error.
      new ErrorEvent('error', {
        message: `Uncaught TypeError: ${PATIENT_TEXT}`,
        error: new TypeError(PATIENT_TEXT),
      })
    );

    const body = await mailForLastError();
    expect(body).toContain('- errorSource: uncaught_error');
    expect(body).toContain('- errorName: TypeError');
    expect(body).not.toContain('Juan');
  });

  it('names a screen that broke while rendering in GlobalErrorBoundary without duplicating alerts', async () => {
    const Broken = (): never => {
      throw new RangeError(PATIENT_TEXT);
    };
    const consoleSpies = suppressConsole(['error']);
    try {
      render(
        <GlobalErrorBoundary>
          <Broken />
        </GlobalErrorBoundary>,
        { onCaughtError: reportCaughtRenderError }
      );
    } finally {
      restoreConsole(consoleSpies);
    }

    const body = await mailForLastError();
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledTimes(1);
    expect(body).toContain('- errorSource: render_crash');
    expect(body).toContain('- errorName: RangeError');
    expect(body).not.toContain('Juan');
  });

  it('reports crashes caught by SectionErrorBoundary and react-error-boundary via onCaughtError', async () => {
    const BrokenSection = (): never => {
      throw new TypeError(PATIENT_TEXT);
    };
    const BrokenPanel = (): never => {
      throw new ReferenceError(PATIENT_TEXT);
    };
    const consoleSpies = suppressConsole(['error']);
    try {
      render(
        <GlobalErrorBoundary>
          <SectionErrorBoundary sectionName="Censo">
            <BrokenSection />
          </SectionErrorBoundary>
        </GlobalErrorBoundary>,
        { onCaughtError: reportCaughtRenderError }
      );
    } finally {
      restoreConsole(consoleSpies);
    }

    const sectionBody = await mailForLastError();
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledTimes(1);
    expect(sectionBody).toContain('- errorSource: render_crash');
    expect(sectionBody).toContain('- errorName: TypeError');
    expect(sectionBody).not.toContain('Juan');

    vi.clearAllMocks();
    const panelConsoleSpies = suppressConsole(['error']);
    try {
      render(
        <ErrorBoundary fallback={<div>fallback</div>}>
          <BrokenPanel />
        </ErrorBoundary>,
        { onCaughtError: reportCaughtRenderError }
      );
    } finally {
      restoreConsole(panelConsoleSpies);
    }

    const panelBody = await mailForLastError();
    expect(dispatchOperationalTelemetryExternally).toHaveBeenCalledTimes(1);
    expect(panelBody).toContain('- errorSource: render_crash');
    expect(panelBody).toContain('- errorName: ReferenceError');
    expect(panelBody).not.toContain('Juan');
  });

  it('ignores ChunkLoadError caught by an error boundary so stale deploys do not trigger alerts', async () => {
    const BrokenChunk = (): never => {
      const error = new Error('Failed to fetch dynamically imported module');
      error.name = 'ChunkLoadError';
      throw error;
    };
    const logErrorSpy = vi.spyOn(errorService, 'logError');
    const consoleSpies = suppressConsole(['error']);
    try {
      render(
        <SectionErrorBoundary sectionName="Ruta">
          <BrokenChunk />
        </SectionErrorBoundary>,
        { onCaughtError: reportCaughtRenderError }
      );
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      restoreConsole(consoleSpies);
    }

    expect(logErrorSpy).not.toHaveBeenCalled();
    expect(dispatchOperationalTelemetryExternally).not.toHaveBeenCalled();
    logErrorSpy.mockRestore();
  });

  it('reports an unknown error class without echoing its name', async () => {
    rejectUnhandled(Object.assign(new Error('x'), { name: 'JuanPerezError' }));

    const body = await mailForLastError();
    expect(body).toContain('- errorName: other_error');
    expect(body).not.toContain('Juan');
  });
});
