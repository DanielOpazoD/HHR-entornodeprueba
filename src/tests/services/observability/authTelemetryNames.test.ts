import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';

const { dispatched, mockGetDynamicRoleForEmail } = vi.hoisted(() => ({
  dispatched: [] as OperationalTelemetryEvent[],
  mockGetDynamicRoleForEmail: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: async (event: OperationalTelemetryEvent) => {
    dispatched.push(event);
    return true;
  },
}));

vi.mock('@/services/auth/authRoleLookup', () => ({
  getDynamicRoleForEmail: (email: string) => mockGetDynamicRoleForEmail(email),
}));

vi.mock('@/services/auth/authRoleCache', () => ({
  clearRoleCacheForEmail: vi.fn(),
  getCachedRole: vi.fn().mockResolvedValue(null),
  saveRoleToCache: vi.fn().mockResolvedValue(undefined),
}));

import {
  installBootstrapRuntimeErrorListeners,
  recordBootstrapRuntimeError,
} from '@/app-shell/bootstrap/bootstrapRuntimeTelemetry';
import { resolveGeneralLoginAccessForEmail } from '@/services/auth/authPolicy';
import { parseOperationalTelemetryBody } from '@/services/observability/operationalTelemetryIngestPolicy';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

/** What the Netlify function receives and mails: the browser payload, sanitized again on ingest. */
const receivedByServer = (event: OperationalTelemetryEvent | undefined) => {
  const parsed = parseOperationalTelemetryBody(
    JSON.stringify({
      source: 'hhr_operational_telemetry',
      event: sanitizeOperationalTelemetryEvent(event ?? {}),
    })
  );
  if (!parsed.ok) throw new Error(`ingest rejected the event: ${parsed.reason}`);
  return parsed.event;
};

// On 2026-11-08 two auth alerts arrived as other_operation with no context and could not be
// diagnosed: one runtimeState blocked (03:28 UTC), one unauthorized (15:41 UTC).
describe('auth failures reach the alert mail by name', () => {
  beforeEach(() => {
    dispatched.length = 0;
    localStorage.clear();
    mockGetDynamicRoleForEmail.mockReset();
  });

  it('names a sign-in refused because the email has no role', async () => {
    mockGetDynamicRoleForEmail.mockResolvedValue(null);

    await expect(resolveGeneralLoginAccessForEmail('sintetico@example.test')).resolves.toEqual({
      allowed: false,
      resolution: 'unauthorized',
    });

    expect(receivedByServer(dispatched.at(-1))).toMatchObject({
      category: 'auth',
      operation: 'resolve_general_login_access',
      status: 'failed',
      runtimeState: 'unauthorized',
    });
  });

  it('names startup errors and unhandled rejections caught during bootstrap', () => {
    const target = new EventTarget();
    const detach = installBootstrapRuntimeErrorListeners(target);
    target.dispatchEvent(
      Object.assign(new Event('error'), {
        error: new Error('synthetic window failure'),
        filename: 'https://example.test/assets/index.js',
      })
    );
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('synthetic rejected promise'),
      })
    );
    detach();
    recordBootstrapRuntimeError(new Error('synthetic bootstrap crash'));

    expect(dispatched.map(event => receivedByServer(event))).toEqual([
      expect.objectContaining({ operation: 'bootstrap_window_error', runtimeState: 'blocked' }),
      expect.objectContaining({
        operation: 'bootstrap_unhandled_rejection',
        runtimeState: 'blocked',
      }),
      expect.objectContaining({ operation: 'bootstrap_runtime_failed', runtimeState: 'blocked' }),
    ]);
  });

  it('refuses an operation name outside the list at compile time', () => {
    const recordUnlisted = () =>
      recordOperationalTelemetry({
        category: 'auth',
        status: 'failed',
        // @ts-expect-error A new name must be added to OPERATIONAL_TELEMETRY_OPERATIONS.
        operation: 'synthetic_unlisted_operation',
      });
    expect(recordUnlisted).toBeTypeOf('function');
  });
});
