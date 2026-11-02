import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({
  saveErrorLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn().mockResolvedValue(true),
}));

import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import {
  buildOperationalTelemetryAlert,
  shouldAlertOperationalTelemetry,
} from '@/services/observability/operationalTelemetryIngestPolicy';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
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

  it('names an unhandled Firestore rejection by source, class and code', async () => {
    rejectUnhandled(
      Object.assign(new Error(PATIENT_TEXT), { name: 'FirebaseError', code: 'permission-denied' })
    );

    const body = await mailForLastError();
    expect(body).toContain('- errorSource: unhandled_rejection');
    expect(body).toContain('- errorName: FirebaseError');
    expect(body).toContain('- errorCode: permission-denied');
    expect(body).not.toContain('Juan');
  });

  it('names an uncaught error', async () => {
    window.dispatchEvent(
      new ErrorEvent('error', { message: PATIENT_TEXT, error: new TypeError(PATIENT_TEXT) })
    );

    const body = await mailForLastError();
    expect(body).toContain('- errorSource: uncaught_error');
    expect(body).toContain('- errorName: TypeError');
    expect(body).not.toContain('Juan');
  });

  it('names a screen that broke while rendering', async () => {
    const Broken = (): never => {
      throw new RangeError(PATIENT_TEXT);
    };
    const consoleSpies = suppressConsole(['error']);
    try {
      render(
        <GlobalErrorBoundary>
          <Broken />
        </GlobalErrorBoundary>
      );
    } finally {
      restoreConsole(consoleSpies);
    }

    const body = await mailForLastError();
    expect(body).toContain('- errorSource: render_crash');
    expect(body).toContain('- errorName: RangeError');
    expect(body).not.toContain('Juan');
  });

  it('reports an unknown error class without echoing its name', async () => {
    rejectUnhandled(Object.assign(new Error('x'), { name: 'JuanPerezError' }));

    const body = await mailForLastError();
    expect(body).toContain('- errorName: other_error');
    expect(body).not.toContain('Juan');
  });
});
